/**
 * GateFlow Agent Core
 * Main agent orchestration using Vercel AI SDK
 *
 * AI SDK 6 Features:
 * - Uses createAgentBundle for tool configuration
 * - Supports needsApproval for tool approval workflow
 * - Integrates with PolicyEngine for path safety
 */

import { streamText, generateObject, stepCountIs, type StepResult, type Tool, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { EventBus } from '../events/index.js';
import type { ToolContext } from './tools.js';
import { createToolExecutors, getToolSpecs as getToolDefinitions, TOOL_APPROVAL_CONFIG } from './tools.js';
import type { MemoryManager } from '../memory/store/manager.js';
import type { MemoryService } from '../memory/MemoryService.js';
import { getSystemPrompt, detectMode, type PromptMode, type DetectModeContext } from './prompts.js';
import { ThinkingChain } from './reasoning/ThinkingChain.js';
import { Orchestrator } from './orchestrator/Orchestrator.js';
import { ComplexityDetectionSchema } from '../types/agent-shared.js';
import {
    createUnderstandingAgent,
    createCodeGenAgent,
    createTestbenchAgent,
    createDebugAgent,
    createRefactoringAgent
} from './workers/index.js';
import {
    createAgentBundle,
    toolNeedsApproval,
    shouldAutoApprovePath,
    type AgentBundle
} from './agent-factory.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
    model: string;
    maxTokens: number;
    temperature: number;
    maxToolCalls: number;
    systemPrompt: string;
}

export interface AgentSession {
    messages: ModelMessage[];
    turnCount: number;
    toolCallCount: number;
    startTime: number;
    currentMode: PromptMode;
    hasErrors: boolean; // Tracks if we've seen lint errors this session
    thinkingChain: ThinkingChain; // NEW: Thinking visibility
}

/**
 * AI SDK 6: Type-safe call options for context injection
 */
export interface AgentCallOptions {
    /** Session ID for memory/context management */
    sessionId?: string;
    /** User ID for personalization */
    userId?: string;
    /** Override the auto-detected mode */
    mode?: PromptMode;
    /** Memory context configuration */
    memoryContext?: {
        includeArchives?: boolean;
        maxContextTokens?: number;
    };
    /** Approval policy overrides */
    approvalPolicy?: {
        autoApprove?: boolean;
        requireConfirmation?: string[]; // tool names
    };
}

export interface RunOptions {
    onToolCall?: (name: string, args: unknown) => void;
    onToolResult?: (name: string, result: unknown) => void;
    signal?: AbortSignal;
    /** Override the auto-detected mode */
    mode?: PromptMode;
    /** Context for mode detection */
    modeContext?: DetectModeContext;
    /** AI SDK 6: Type-safe call options for context injection */
    callOptions?: AgentCallOptions;
}

// ============================================================================
// Default System Prompt (fallback - actual prompts come from prompts.ts)
// ============================================================================

const DEFAULT_SYSTEM_PROMPT = getSystemPrompt('general');

// ============================================================================
// Agent Class
// ============================================================================

export class GateFlowAgent {
    private config: AgentConfig;
    private session: AgentSession;
    private toolContext: ToolContext;
    private tools: Record<string, Tool>;
    private executors: ReturnType<typeof createToolExecutors>;
    private orchestrator: Orchestrator | null = null;
    private memoryService?: MemoryService;
    private memoryManager?: MemoryManager;
    /** AI SDK 6: Agent bundle with approval-aware tools */
    private agentBundle: AgentBundle | null = null;

    constructor(
        private bus: EventBus,
        toolContext: ToolContext,
        config?: Partial<AgentConfig>
    ) {
        this.config = {
            model: config?.model ?? 'claude-sonnet-4-20250514',
            maxTokens: config?.maxTokens ?? 8192,
            temperature: config?.temperature ?? 0.7,
            maxToolCalls: config?.maxToolCalls ?? 25,
            systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
        };

        this.toolContext = toolContext;
        this.memoryService = toolContext.memoryService;
        this.memoryManager = toolContext.memoryManager ?? toolContext.memoryService?.memory;
        this.executors = createToolExecutors(toolContext);
        this.tools = this.buildTools();
        this.session = this.createSession();

        // Initialize thinking chain (always visible per plan)
        this.session.thinkingChain = new ThinkingChain(bus, { showByDefault: true });

        // Initialize orchestrator with worker agents
        this.initializeOrchestrator();
    }

    /**
     * Initialize orchestrator with all specialized agents
     */
    private initializeOrchestrator(): void {
        this.orchestrator = new Orchestrator(this.bus, this.toolContext.projectRoot, this.config.model);

        // Register all worker agents
        // Note: Planning is handled by Orchestrator.executeWithPlan(), not as a worker agent
        this.orchestrator.registerWorker('understanding', createUnderstandingAgent(this.tools));
        this.orchestrator.registerWorker('codegen', createCodeGenAgent(this.tools));
        this.orchestrator.registerWorker('testbench', createTestbenchAgent(this.tools));
        this.orchestrator.registerWorker('debug', createDebugAgent(this.tools));
        this.orchestrator.registerWorker('refactoring', createRefactoringAgent(this.tools));
    }

    // ========================================================================
    // Build AI SDK Tools
    // ========================================================================

    /**
     * Build tools using the agent factory.
     * Tools are configured with needsApproval metadata from TOOL_APPROVAL_CONFIG.
     */
    private buildTools(): Record<string, Tool> {
        const specs = getToolDefinitions();
        const tools: Record<string, Tool> = {};

        for (const [name, spec] of Object.entries(specs)) {
            tools[name] = {
                description: spec.description,
                inputSchema: spec.parameters, // tools.ts uses 'parameters' which maps to inputSchema
                execute: async (args: unknown) => {
                    const executor = (this.executors as any)[name];
                    if (!executor) {
                        throw new Error(`Unknown tool: ${name}`);
                    }
                    return executor(args);
                }
            };
        }

        return tools;
    }

    /**
     * Get or create the agent bundle for the current mode.
     * AI SDK 6: The bundle contains tools configured with needsApproval.
     */
    private getAgentBundle(mode: PromptMode): AgentBundle {
        // Create new bundle if mode changed or not initialized
        if (!this.agentBundle || this.agentBundle.mode !== mode) {
            this.agentBundle = createAgentBundle(
                {
                    mode,
                    model: this.config.model,
                    maxSteps: this.config.maxToolCalls,
                    autoApprove: this.toolContext.autoApprove,
                },
                this.toolContext
            );
        }
        return this.agentBundle;
    }

    /**
     * Check if a tool call requires approval.
     * AI SDK 6: Uses TOOL_APPROVAL_CONFIG and PolicyEngine.
     *
     * Note: For tools not in the PolicyEngine's ToolName union,
     * we fall back to TOOL_APPROVAL_CONFIG only.
     */
    private async checkToolApproval(
        toolName: string,
        args: Record<string, unknown>
    ): Promise<{ approved: boolean; reason?: string }> {
        // Check if tool needs approval based on config
        if (!toolNeedsApproval(toolName, this.toolContext.autoApprove)) {
            return { approved: true };
        }

        // Auto-approve SystemVerilog files for write operations
        if (['write_file', 'edit_lines', 'search_replace'].includes(toolName)) {
            const filePath = args.path as string | undefined;
            if (filePath && shouldAutoApprovePath(filePath)) {
                return { approved: true };
            }
        }

        // Check PolicyEngine for path safety (for known tool names)
        // PolicyEngine has a specific set of ToolNames - check if this tool is known
        const knownPolicyTools = [
            'read_file', 'list_files', 'search_code', 'lint_file',
            'write_file', 'edit_lines', 'search_replace', 'find_module'
        ];

        if (knownPolicyTools.includes(toolName)) {
            const policyDecision = this.toolContext.policy.checkTool(
                toolName as 'write_file' | 'edit_lines' | 'search_replace' | 'read_file' | 'list_files' | 'search_code' | 'lint_file' | 'find_module',
                args
            );
            if (!policyDecision.allowed) {
                return { approved: false, reason: policyDecision.reason };
            }

            // Request human approval via EventBus if policy requires it
            if (policyDecision.requiresApproval) {
                try {
                    const summary = this.summarizeArgs(args);
                    const response = await this.bus.requestApproval(
                        `Tool: ${toolName}`,
                        summary,
                        { timeout: 60000 }
                    );
                    const approved = response.approved;
                    return { approved, reason: approved ? 'User approved' : 'User denied' };
                } catch {
                    // If approval request fails, deny by default for safety
                    return { approved: false, reason: 'Approval request failed' };
                }
            }
        }

        // For other tools that need approval per config, request approval
        try {
            const summary = this.summarizeArgs(args);
            const response = await this.bus.requestApproval(
                `Tool: ${toolName}`,
                summary,
                { timeout: 60000 }
            );
            return { approved: response.approved, reason: response.approved ? 'User approved' : 'User denied' };
        } catch {
            return { approved: false, reason: 'Approval request failed' };
        }
    }

    // ========================================================================
    // Run Agent
    // ========================================================================

    /**
     * Run the agent with a user message
     */
    async run(
        userMessage: string,
        options?: RunOptions
    ): Promise<string> {
        // Validate input
        if (!userMessage || !userMessage.trim()) {
            throw new Error('Message cannot be empty');
        }

        this.session.turnCount++;
        this.session.messages.push({
            role: 'user',
            content: userMessage.trim()
        });

        // Check for context archiving (Dynamic Context Discovery)
        if (this.memoryManager) {
            // Include assistant messages in check by getting full history
            const allMessages = this.session.messages.map(m => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            }));

            const archiveResult = await this.memoryManager.triggerSummarization(
                this.toolContext.sessionId || 'default',
                allMessages
            );

            if (archiveResult.triggered) {
                // Replace session messages with remaining + summary context
                // Convert remaining messages back to ModelMessage format
                this.session.messages = archiveResult.remainingMessages.map(m => ({
                    role: m.role as 'user' | 'assistant' | 'system',
                    content: m.content
                }));

                // Add history reference as a system-like context at the start
                if (archiveResult.historyRef) {
                    this.session.messages.unshift({
                        role: 'system',
                        content: archiveResult.historyRef.agentInstructions
                    });
                }
            }
        }

        // Emit agent lifecycle start
        this.bus.emit({
            type: 'agent_start',
            agentName: 'gateflow',
            task: userMessage.slice(0, 100)
        });
        const agentStartTime = Date.now();

        // Track token usage for agent_complete
        let lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;

        try {
            // Emit status immediately so spinner shows during processing
            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: 'Thinking...'
            });

            // AI SDK 6: Apply call options if provided
            const callOptions = options?.callOptions;
            if (callOptions?.sessionId && this.toolContext.sessionId !== callOptions.sessionId) {
                this.toolContext.sessionId = callOptions.sessionId;
            }

            // Detect mode for this query (can be overridden by call options)
            const modeContext: DetectModeContext = {
                hasErrors: this.session.hasErrors,
                ...options?.modeContext
            };
            const mode = callOptions?.mode ?? options?.mode ?? detectMode(userMessage, modeContext);
            this.session.currentMode = mode;

            // Apply approval policy overrides from call options
            if (callOptions?.approvalPolicy) {
                // This would integrate with PolicyEngine to override auto-approve settings
                // For now, we track it for potential future use
            }

            // Add thinking step at mode detection
            this.session.thinkingChain.addAnalysisStep(
                `Analyzing request in ${mode} mode`,
                { mode, userMessage },
                0.9
            );

            // AI SDK 6: Use generateObject for complexity detection
            const { object: complexity } = await generateObject({
                model: anthropic(this.config.model) as any,
                schema: ComplexityDetectionSchema,
                prompt: `Does this request need multi-agent coordination?

Request: "${userMessage}"

Multi-agent is needed for:
- Creating multiple files (module + testbench)
- Complex refactoring across files
- Requests with explicit planning language
- Multi-step operations requiring different agents

Return needsMultiAgent: true only for genuinely complex requests.`
            });

            if (complexity.needsMultiAgent && this.orchestrator) {
                this.session.thinkingChain.addCoordinationStep(
                    'Using multi-agent orchestrator',
                    { reasoning: complexity.reasoning },
                    0.9
                );

                // Update spinner for multi-agent mode
                this.bus.emit({
                    type: 'status',
                    phase: 'thinking',
                    label: 'Planning multi-agent execution...'
                });

                // Use orchestrator for complex requests
                return this.orchestrator.executeWithPlan(userMessage);
            }

            // Simple requests: continue with single-agent flow
            // AI SDK 6: Get agent bundle with approval-aware tools
            const bundle = this.getAgentBundle(mode);

            // Inject context from MemoryService (token-budgeted project + knowledge context)
            let systemPrompt = bundle.instructions;
            if (this.memoryService) {
                const contextInjection = this.memoryService.getContextForAI({
                    query: userMessage  // Use user message as context hint for relevance filtering
                });

                if (contextInjection.totalTokens > 0) {
                    const contextBlock = this.memoryService.getContextString({
                        query: userMessage
                    });

                    if (contextBlock.trim()) {
                        systemPrompt = `${bundle.instructions}

<project_context>
${contextBlock}
</project_context>`;

                        this.bus.emit({
                            type: 'status',
                            phase: 'thinking',
                            label: `Injected ${contextInjection.totalTokens} tokens of context`
                        });
                    }
                }
            }

            // Update spinner with detected mode
            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: `[${mode}] Generating response...`
            });

            // AI SDK 6: Use bundle configuration with stopWhen
            const result = streamText({
                model: bundle.model as any,
                system: systemPrompt,
                messages: this.session.messages,
                tools: bundle.tools,
                maxOutputTokens: this.config.maxTokens,
                temperature: this.config.temperature,
                abortSignal: options?.signal,
                stopWhen: bundle.stopWhen,  // AI SDK handles the loop automatically

                // Thinking visibility via onStepFinish
                // Note: Tool call/result events are emitted from the stream loop for real-time updates
                // We only handle thinking chain and error tracking here to avoid duplicate events
                onStepFinish: (step: StepResult<any>) => {
                    this.session.thinkingChain.onStepFinish(step);

                    // Track lint errors for mode detection (from tool results)
                    if (step.toolResults) {
                        for (const toolResult of step.toolResults) {
                            if (toolResult.toolName === 'lint_file') {
                                const output = toolResult.output as { errors?: unknown[] } | null;
                                if (output?.errors && Array.isArray(output.errors) && output.errors.length > 0) {
                                    this.session.hasErrors = true;
                                }
                            }
                        }
                    }
                },

                // Error callback for stream errors (AI SDK v6)
                onError: ({ error }) => {
                    this.bus.emit({
                        type: 'error',
                        message: error instanceof Error ? error.message : String(error)
                    });
                },

                // Abort callback for cleanup (AI SDK v6)
                onAbort: ({ steps }) => {
                    this.bus.emit({
                        type: 'status',
                        phase: 'thinking',
                        label: `Aborted after ${steps.length} steps`
                    });
                },

                // Finish callback for token tracking (AI SDK v6)
                // Enhanced with extended usage tracking
                // Note: Tool approval is handled in tool executors via PolicyEngine (see tools.ts)
                onFinish: ({ totalUsage, finishReason }) => {
                    lastUsage = totalUsage;

                    // AI SDK 6: Extended usage tracking
                    // Store detailed token breakdown for cost optimization and debugging
                    if (totalUsage) {
                        // Store extended usage details for agent_complete event
                        (lastUsage as any).extended = {
                            inputTokens: totalUsage.inputTokens,
                            outputTokens: totalUsage.outputTokens,
                            // Extended usage details (when available from provider)
                            reasoningTokens: (totalUsage as any).outputTokenDetails?.reasoningTokens,
                            textTokens: (totalUsage as any).outputTokenDetails?.textTokens,
                            cachedTokens: (totalUsage as any).cachedTokens,
                            finishReason: finishReason,
                            // Raw provider usage for detailed analysis
                            rawUsage: (totalUsage as any).raw
                        };
                    }
                }
            });

            let fullResponse = '';

            // Process the stream for all event types (AI SDK 6)
            for await (const part of result.fullStream) {
                if (options?.signal?.aborted) {
                    throw new Error('Aborted');
                }

                switch (part.type) {
                    case 'text-delta':
                        fullResponse += part.text;
                        this.bus.emit({
                            type: 'token',
                            text: part.text
                        });
                        break;

                    case 'tool-call':
                        // AI SDK 6: Emit tool call event from stream (uses 'input' not 'args')
                        this.bus.emit({
                            type: 'tool_call',
                            tool: part.toolName,
                            argsSummary: this.summarizeArgs(part.input),
                            args: part.input as Record<string, unknown>
                        });
                        options?.onToolCall?.(part.toolName, part.input);
                        break;

                    case 'tool-result':
                        // AI SDK 6: Emit tool result event from stream (uses 'output' not 'result')
                        const streamHasError = part.output && typeof part.output === 'object' &&
                            part.output !== null && 'error' in part.output;
                        this.bus.emit({
                            type: 'tool_result',
                            tool: part.toolName,
                            ok: !streamHasError,
                            summary: this.summarizeResult(part.output),
                            result: part.output
                        });
                        options?.onToolResult?.(part.toolName, part.output);

                        // Track lint errors for mode detection
                        if (part.toolName === 'lint_file') {
                            const lintResult = part.output as { errors?: unknown[] } | null;
                            if (lintResult?.errors && Array.isArray(lintResult.errors) && lintResult.errors.length > 0) {
                                this.session.hasErrors = true;
                            }
                        }
                        break;

                    // Handle error stream parts (AI SDK v6)
                    case 'error': {
                        const errorMsg = (part as any).error instanceof Error
                            ? (part as any).error.message
                            : String((part as any).error);
                        this.bus.emit({
                            type: 'error',
                            message: `Stream error: ${errorMsg}`
                        });
                        break;
                    }

                    // Handle tool errors (AI SDK v6)
                    case 'tool-error': {
                        const toolError = part as any;
                        const errorMsg = toolError.error instanceof Error
                            ? toolError.error.message
                            : String(toolError.error);
                        this.bus.emit({
                            type: 'error',
                            message: `Tool ${toolError.toolName} failed: ${errorMsg}`
                        });
                        break;
                    }

                    // Handle abort (AI SDK v6)
                    case 'abort':
                        this.bus.emit({
                            type: 'status',
                            phase: 'thinking',
                            label: 'Stream aborted'
                        });
                        break;
                }
            }

            // Get final result
            const finalResult = await result;
            const textContent = await finalResult.text;

            if (textContent && textContent.trim()) {
                fullResponse = textContent;
                this.session.messages.push({
                    role: 'assistant',
                    content: textContent
                });
            }

            // Update tool call count from final result
            const steps = await finalResult.steps;
            if (steps) {
                this.session.toolCallCount += steps.length;
            }

            this.bus.emit({ type: 'token_done' });

            // Emit agent lifecycle complete with token usage
            // AI SDK 6: Include extended usage details when available
            const extendedUsage = (lastUsage as any)?.extended;
            this.bus.emit({
                type: 'agent_complete',
                agentName: 'gateflow',
                success: true,
                durationMs: Date.now() - agentStartTime,
                inputTokens: lastUsage?.inputTokens,
                outputTokens: lastUsage?.outputTokens,
                // Extended usage details (AI SDK 6)
                reasoningTokens: extendedUsage?.reasoningTokens,
                textTokens: extendedUsage?.textTokens,
                cachedTokens: extendedUsage?.cachedTokens,
                finishReason: extendedUsage?.finishReason,
                rawUsage: extendedUsage?.rawUsage
            });

            return fullResponse;

        } catch (error) {
            // Emit error event
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'error',
                message: errorMsg
            });

            // Emit agent_complete with failure
            this.bus.emit({
                type: 'agent_complete',
                agentName: 'gateflow',
                success: false,
                durationMs: Date.now() - agentStartTime
            });

            throw error;
        }
    }

    // ========================================================================
    // Stream Processing
    // ========================================================================
    // NOTE: This method was removed - stream processing is now handled
    // directly in the run() method using AI SDK 6's onStepFinish callback
    // and fullStream iteration. This ensures compatibility with AI SDK 6.

    // ========================================================================
    // Helpers
    // ========================================================================

    private summarizeArgs(args: unknown): string {
        if (!args || typeof args !== 'object') return '';

        const obj = args as Record<string, unknown>;

        // Common patterns
        if ('path' in obj) return String(obj.path);
        if ('directory' in obj) return String(obj.directory);
        if ('name' in obj) return String(obj.name);
        if ('module' in obj) return String(obj.module);
        if ('pattern' in obj) return String(obj.pattern);
        if ('top' in obj) return String(obj.top);

        return Object.keys(obj).slice(0, 2).join(', ');
    }

    private summarizeResult(result: unknown): string {
        if (!result || typeof result !== 'object') return String(result);

        const obj = result as Record<string, unknown>;

        if ('error' in obj) return `Error: ${obj.error}`;
        // FIX E: Show stderr or meaningful error for simulation failures
        if ('success' in obj && obj.success === false) {
            if ('stderr' in obj && obj.stderr) {
                const stderr = String(obj.stderr).trim();
                // Show first line of stderr if present
                const firstLine = stderr.split('\n')[0];
                return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
            }
            return 'Failed';
        }
        if ('count' in obj) return `${obj.count} items`;
        if ('lines' in obj) return `${obj.lines} lines`;
        if ('replacements' in obj) return `${obj.replacements} replacements`;
        if ('totalMatches' in obj) return `${obj.totalMatches} matches`;
        if ('errors' in obj && Array.isArray(obj.errors)) {
            return obj.errors.length === 0 ? 'Success' : `${obj.errors.length} errors`;
        }

        return 'Done';
    }

    // ========================================================================
    // Session Management
    // ========================================================================

    private createSession(): AgentSession {
        return {
            messages: [],
            turnCount: 0,
            toolCallCount: 0,
            startTime: Date.now(),
            currentMode: 'general',
            hasErrors: false,
            thinkingChain: new ThinkingChain(this.bus, { showByDefault: true }) // Will be replaced in constructor
        };
    }

    /**
     * Reset the session (clear history)
     */
    resetSession(): void {
        this.session = this.createSession();
    }

    /**
     * Get current session stats
     */
    getSessionStats(): {
        turnCount: number;
        toolCallCount: number;
        messageCount: number;
        durationMs: number;
    } {
        return {
            turnCount: this.session.turnCount,
            toolCallCount: this.session.toolCallCount,
            messageCount: this.session.messages.length,
            durationMs: Date.now() - this.session.startTime
        };
    }

    /**
     * Add context to the session
     */
    addContext(content: string): void {
        if (!content || !content.trim()) return;

        this.session.messages.push({
            role: 'user',
            content: `[Context]: ${content.trim()}`
        });
    }

    /**
     * Get conversation history
     */
    getHistory(): ModelMessage[] {
        return [...this.session.messages];
    }
}

