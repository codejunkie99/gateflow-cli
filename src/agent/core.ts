/**
 * GateFlow Agent Core
 * Main agent orchestration using Vercel AI SDK
 *
 * AI SDK 6 Features:
 * - Uses createAgentBundle for tool configuration
 * - Supports needsApproval for tool approval workflow
 * - Integrates with PolicyEngine for path safety
 */

import { streamText, stepCountIs, type StepResult, type Tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import {
    createModel,
    parseModelString,
    generateStructured,
    getVariantProviderOptions,
    PROVIDERS,
    type ModelConfig,
    type ModelConfigWithVariant,
} from './model-provider.js';
import type { EventBus } from '../events/index.js';
import type { ToolContext } from './tools.js';
import { createToolExecutors, getToolSpecs as getToolDefinitions, TOOL_APPROVAL_CONFIG } from './tools.js';
import type { MemoryManager } from '../memory/store/manager.js';
import type { MemoryService } from '../memory/MemoryService.js';
import { getSystemPrompt, detectMode, type PromptMode, type DetectModeContext } from './prompts.js';
import { PromptBuilder } from './prompts/PromptBuilder.js';
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
import {
    stopWhenAny,
    continuationRequested,
    type StopCondition
} from './stop-conditions.js';
import type { RuntimeCallOptions } from '../types/agent-types.js';
import {
    classifyWorkflow,
    executeWorkflow,
    type WorkflowType,
    type WorkflowContext
} from './workflows/index.js';
import {
    combinePrepareSteps,
    contextWindowManager,
    dynamicModelSelector,
    budgetAwareExecution,
    continuationWarning,
    type PrepareStepFn,
    type StepSettings
} from './loop-control.js';
import { prefetchOpenRouterModels } from './model-provider-openrouter.js';
import { modelCapabilities } from './model-capabilities/index.js';
import { truncateToFit } from '../memory/token-estimator.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
    model: string;
    modelConfig?: ModelConfigWithVariant;
    /**
     * Optional model for complex tasks (high step count, errors, long context).
     * If not specified, the primary model is used for all tasks.
     *
     * @example "anthropic/claude-opus-4-5-20251101" for reasoning-heavy tasks
     */
    complexModel?: string;
    complexModelConfig?: ModelConfigWithVariant;
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
 * Extended usage tracking for AI SDK providers.
 * Captures provider-specific details beyond standard inputTokens/outputTokens.
 */
interface ExtendedUsageDetails {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    textTokens?: number;
    cachedTokens?: number;
    finishReason?: string;
    rawUsage?: unknown;
}

interface UsageWithExtensions {
    inputTokens?: number;
    outputTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number; textTokens?: number };
    cachedTokens?: number;
    raw?: unknown;
    extended?: ExtendedUsageDetails;
}

type WorkflowOutcome =
    | { status: 'applied'; output: string; workflow: WorkflowType }
    | { status: 'not_applicable'; reason: string }
    | { status: 'failed'; workflow: WorkflowType | 'unknown'; error: string };

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
    /** Runtime configuration overrides (per-request) */
    runtimeOptions?: RuntimeCallOptions;
}

// ============================================================================
// Continuation Types
// ============================================================================

/**
 * Checkpoint data from request_continuation tool.
 * Contains progress information for multi-segment execution.
 */
export interface ContinuationCheckpoint {
    /** Tasks completed in this segment */
    completedTasks: string[];
    /** Tasks remaining to be done */
    remainingTasks: string[];
    /** Partial output to preserve */
    partialResults?: string;
    /** Context notes for the next segment */
    notes?: string;
    /** Current segment number */
    segmentNumber: number;
    /** Cumulative steps across all segments */
    cumulativeSteps: number;
}

/**
 * Options for runWithContinuation method.
 * Extends RunOptions with continuation-specific configuration.
 */
export interface ContinuationOptions extends RunOptions {
    /** Maximum number of segments (default: 5, = 125 total steps). Ignored if dynamicSegments is true. */
    maxSegments?: number;
    /**
     * Enable progress-based dynamic segments.
     * When true, continues as long as progress is being made (tasks completing).
     * Stops when: no progress detected, task complete, or safety cap (20 segments) reached.
     */
    dynamicSegments?: boolean;
    /** Safety cap for dynamic segments (default: 20 = 500 steps max) */
    dynamicSegmentsCap?: number;
    /** Callback when a segment completes with continuation */
    onSegmentComplete?: (checkpoint: ContinuationCheckpoint) => void;
}

// ============================================================================
// Default System Prompt (fallback - actual prompts come from prompts.ts)
// ============================================================================

const DEFAULT_SYSTEM_PROMPT = getSystemPrompt('general');
const ARCHIVE_INSTRUCTIONS_TOKEN_BUDGET = 200;

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
        // Resolve model config from provided config or model string
        let resolvedModelConfig: ModelConfig | undefined = config?.modelConfig;
        let resolvedModelString = config?.model;

        if (resolvedModelConfig) {
            // If modelConfig is provided, derive the model string from it
            resolvedModelString = `${resolvedModelConfig.provider}/${resolvedModelConfig.model}`;
        } else if (resolvedModelString) {
            // If only model string is provided, parse it to get modelConfig
            resolvedModelConfig = parseModelString(resolvedModelString);
            resolvedModelString = `${resolvedModelConfig.provider}/${resolvedModelConfig.model}`;
        } else {
            // Neither provided - use default from PROVIDERS
            resolvedModelConfig = { provider: 'anthropic', model: PROVIDERS.anthropic.defaultModel };
            resolvedModelString = `${resolvedModelConfig.provider}/${resolvedModelConfig.model}`;
        }

        this.config = {
            model: resolvedModelString,
            modelConfig: resolvedModelConfig,
            complexModel: config?.complexModel,
            complexModelConfig: config?.complexModelConfig,
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

        // Initialize model capability cache for structured output routing
        modelCapabilities.initialize().catch(err => {
            if (process.env.VERBOSE) {
                console.warn('Failed to initialize model capability cache:', err);
            }
        });

        // Prefetch OpenRouter models in background for faster model switching
        prefetchOpenRouterModels().catch(err => {
            // Silently fail - this is just an optimization
            if (process.env.VERBOSE) {
                console.warn('⚠️  Failed to prefetch OpenRouter models:', err);
            }
        });
    }

    /**
     * Initialize orchestrator with all specialized agents
     */
    private initializeOrchestrator(): void {
        this.orchestrator = new Orchestrator(
            this.bus,
            this.toolContext.projectRoot,
            this.config.model,
            {
                indexer: this.toolContext.indexer,
                memoryService: this.toolContext.memoryService
            }
        );

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
                    const executor = this.executors[name];
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
                    modelConfig: this.config.modelConfig,
                    complexModel: this.config.complexModel,
                    complexModelConfig: this.config.complexModelConfig,
                    stepLimit: this.config.maxToolCalls,
                    autoApprove: this.toolContext.autoApprove,
                },
                this.toolContext
            );
        }
        return this.agentBundle;
    }

    /**
     * Set the model configuration for runtime switching.
     * Invalidates the agent bundle and orchestrator to force recreation with new model.
     */
    setModelConfig(config: ModelConfigWithVariant): void {
        this.config.modelConfig = config;
        // Build model string with optional variant suffix
        this.config.model = config.variant
            ? `${config.provider}/${config.model}:${config.variant}`
            : `${config.provider}/${config.model}`;
        this.agentBundle = null; // Force bundle recreation
        // Reinitialize orchestrator with new model
        this.initializeOrchestrator();
    }

    /**
     * Get the current model configuration.
     */
    getModelConfig(): ModelConfigWithVariant | undefined {
        return this.config.modelConfig;
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
                } catch (error) {
                    // If approval request fails, deny by default for safety
                    return { approved: false, reason: this.formatApprovalError(error) };
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
        } catch (error) {
            return { approved: false, reason: this.formatApprovalError(error) };
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
                    const instructions = truncateToFit(
                        archiveResult.historyRef.agentInstructions,
                        ARCHIVE_INSTRUCTIONS_TOKEN_BUDGET
                    );
                    this.session.messages.unshift({
                        role: 'system',
                        content: instructions
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
        let lastUsage: UsageWithExtensions | undefined;

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

            // Apply approval policy overrides from call options
            if (callOptions?.approvalPolicy) {
                // This would integrate with PolicyEngine to override auto-approve settings
                // For now, we track it for potential future use
            }

            // ========================================================================
            // Issue #11 Fix: Complexity detection BEFORE mode detection
            // This allows multi-agent orchestration to override mode-based routing
            // ========================================================================

            // AI SDK 6: Use generateStructured for complexity detection FIRST
            const effectiveModelConfig = this.config.modelConfig ?? parseModelString(this.config.model);
            const complexityVariantOptions = getVariantProviderOptions(
                effectiveModelConfig.provider,
                effectiveModelConfig.variant
            );
            const modelId = `${effectiveModelConfig.provider}/${effectiveModelConfig.model}`;
            const complexity = await generateStructured({
                model: createModel(effectiveModelConfig),
                modelId,
                schema: ComplexityDetectionSchema,
                prompt: `Does this request need multi-agent coordination?

Request: "${userMessage}"

Multi-agent is needed for:
- Creating multiple files (module + testbench)
- Complex refactoring across files
- Requests with explicit planning language
- Multi-step operations requiring different agents

Return needsMultiAgent: true only for genuinely complex requests.`,
                // Apply variant options for consistency
                ...complexityVariantOptions,
            });

            // Route to orchestrator immediately if multi-agent is needed
            // This happens BEFORE mode detection to prevent mode from blocking orchestration
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

            // ========================================================================
            // Single-agent flow: Mode detection happens AFTER complexity check
            // ========================================================================

            // Detect mode for this query (can be overridden by call options)
            const modeContext: DetectModeContext = {
                hasErrors: this.session.hasErrors,
                ...options?.modeContext
            };
            const mode = callOptions?.mode ?? options?.mode ?? detectMode(userMessage, modeContext);
            this.session.currentMode = mode;

            // Add thinking step at mode detection
            this.session.thinkingChain.addAnalysisStep(
                `Analyzing request in ${mode} mode`,
                { mode, userMessage },
                0.9
            );

            // Check if request matches a specialized workflow pattern
            const workflowOutcome = await this.tryWorkflowExecution(userMessage, mode);
            switch (workflowOutcome.status) {
                case 'applied':
                    return workflowOutcome.output;
                case 'failed': {
                    const workflowLabel = workflowOutcome.workflow === 'unknown'
                        ? 'workflow'
                        : workflowOutcome.workflow;
                    const errorMessage = `${workflowLabel} workflow failed: ${workflowOutcome.error}. ` +
                        'Falling back to standard agent.';
                    this.bus.emit({
                        type: 'error',
                        message: errorMessage
                    });
                    this.session.thinkingChain.addAnalysisStep(
                        `Workflow failed: ${workflowLabel}`,
                        { workflow: workflowOutcome.workflow, error: workflowOutcome.error },
                        0.3
                    );
                    break;
                }
                case 'not_applicable':
                    break;
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

                    // Use PromptBuilder to compose the system prompt with context
                    const promptBuilder = new PromptBuilder();
                    promptBuilder
                        .addRaw(bundle.instructions, 0)  // Base instructions without wrapping
                        .addWrappedSection('project_context', contextBlock);  // Wrapped context
                    systemPrompt = promptBuilder.build();

                    if (contextBlock.trim()) {
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

            // AI SDK 6: Apply runtime options overrides
            const runtime = options?.runtimeOptions;

            // Compute effective stop condition (combine bundle default with runtime overrides)
            let effectiveStopWhen: StopCondition = bundle.stopWhen;
            if (runtime?.stopConditions && runtime.stopConditions.length > 0) {
                // Combine runtime conditions with bundle default using OR logic
                effectiveStopWhen = stopWhenAny(
                    bundle.stopWhen,
                    ...runtime.stopConditions as StopCondition[]
                );
            }

            // AI SDK 6: Create prepareStep for dynamic control
            // Pass bundle to provide LanguageModel objects (not strings) to avoid AI Gateway fallback
            const prepareStep = this.createPrepareStep(mode, bundle);

            // AI SDK 6: Use bundle configuration with stopWhen and runtime overrides
            // Spread variantOptions to apply extended thinking, reasoning effort, etc.
            const result = streamText({
                model: bundle.model,
                system: systemPrompt,
                messages: this.session.messages,
                tools: bundle.tools,
                maxOutputTokens: runtime?.maxTokens ?? this.config.maxTokens,
                temperature: runtime?.temperature ?? this.config.temperature,
                abortSignal: runtime?.signal ?? options?.signal,
                stopWhen: effectiveStopWhen,  // AI SDK handles the loop automatically
                prepareStep: prepareStep,  // Dynamic step control (cast for AI SDK compatibility)
                // Apply variant options (extended thinking for Anthropic, reasoning effort for OpenAI, etc.)
                ...bundle.variantOptions,

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
                    // Cast to our extended type to access provider-specific properties
                    const usage = totalUsage as UsageWithExtensions | undefined;
                    lastUsage = usage;

                    // AI SDK 6: Extended usage tracking
                    // Store detailed token breakdown for cost optimization and debugging
                    if (usage) {
                        // Store extended usage details for agent_complete event
                        usage.extended = {
                            inputTokens: usage.inputTokens,
                            outputTokens: usage.outputTokens,
                            // Extended usage details (when available from provider)
                            reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
                            textTokens: usage.outputTokenDetails?.textTokens,
                            cachedTokens: usage.cachedTokens,
                            finishReason: finishReason,
                            // Raw provider usage for detailed analysis
                            rawUsage: usage.raw
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
                        const errorMsg = part.error instanceof Error
                            ? part.error.message
                            : String(part.error);
                        this.bus.emit({
                            type: 'error',
                            message: `Stream error: ${errorMsg}`
                        });
                        break;
                    }

                    // Handle tool errors (AI SDK v6)
                    case 'tool-error': {
                        const errorMsg = part.error instanceof Error
                            ? part.error.message
                            : String(part.error);
                        this.bus.emit({
                            type: 'error',
                            message: `Tool ${part.toolName} failed: ${errorMsg}`
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

            // AI SDK 6: Persist all step messages to session to maintain context
            // This prevents state loss of intermediate tool interactions
            const steps = await finalResult.steps;
            if (steps && steps.length > 0) {
                for (const step of steps) {
                    // Capture intermediate text responses (defensive: preserve text from non-final steps)
                    if (step.text && step.text.trim() && (!step.toolCalls || step.toolCalls.length === 0)) {
                        this.session.messages.push({
                            role: 'assistant',
                            content: step.text
                        });
                    }

                    // Add assistant message with tool calls if present
                    if (step.toolCalls && step.toolCalls.length > 0) {
                        this.session.messages.push({
                            role: 'assistant',
                            content: step.toolCalls.map(tc => ({
                                type: 'tool-call' as const,
                                toolCallId: tc.toolCallId,
                                toolName: tc.toolName,
                                input: tc.input  // AI SDK 6 uses 'input' not 'args'
                            }))
                        });
                    }

                    // Add tool results (defensive: check separately from toolCalls)
                    if (step.toolResults && step.toolResults.length > 0) {
                        for (const tr of step.toolResults) {
                            this.session.messages.push({
                                role: 'tool',
                                content: [{
                                    type: 'tool-result' as const,
                                    toolCallId: tr.toolCallId,
                                    toolName: tr.toolName,
                                    output: tr.output  // AI SDK 6 uses 'output' not 'result'
                                }]
                            });
                        }
                    }
                }

                this.session.toolCallCount += steps.flatMap(step => step.toolCalls ?? []).length;
            }

            // Add final text response if present
            if (textContent && textContent.trim()) {
                fullResponse = textContent;
                this.session.messages.push({
                    role: 'assistant',
                    content: textContent
                });
            }

            this.bus.emit({ type: 'token_done' });

            // Emit agent lifecycle complete with token usage
            // AI SDK 6: Include extended usage details when available
            const extendedUsage = lastUsage?.extended;
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
    // Workflow Pattern Execution
    // ========================================================================

    /**
     * Try to execute the request using a specialized workflow pattern.
     * Returns an outcome indicating whether a workflow was applied, skipped, or failed.
     *
     * Workflow patterns provide structured execution for specific task types:
     * - lint_fix: Iterative error fixing
     * - module_generation: Generate with quality checks
     * - testbench: Generate comprehensive testbenches
     * - code_review: Multi-perspective review
     */
    private async tryWorkflowExecution(
        userMessage: string,
        mode: PromptMode
    ): Promise<WorkflowOutcome> {
        // Only try workflows for specific modes that benefit from structured patterns
        const workflowModes: PromptMode[] = ['lint_fix', 'generate', 'testbench', 'edit'];
        if (!workflowModes.includes(mode)) {
            return { status: 'not_applicable', reason: 'mode_not_supported' };
        }

        let selectedWorkflow: WorkflowType | 'unknown' = 'unknown';

        try {
            // Classify the request to see if a workflow pattern fits
            const selection = await classifyWorkflow(
                userMessage,
                {
                    hasLintErrors: this.session.hasErrors,
                    hasCode: true
                },
                this.config.model
            );
            selectedWorkflow = selection.workflow;

            // Only use workflow if confidence is high enough
            if (selection.confidence < 0.7) {
                return { status: 'not_applicable', reason: 'low_confidence' };
            }

            // Skip simple_generation - let the normal agent handle it
            if (selection.workflow === 'simple_generation') {
                return { status: 'not_applicable', reason: 'simple_generation' };
            }

            this.session.thinkingChain.addCoordinationStep(
                `Using ${selection.workflow} workflow pattern`,
                { workflow: selection.workflow, confidence: selection.confidence },
                selection.confidence
            );

            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: `Executing ${selection.workflow} workflow...`
            });

            // Build workflow context from tool context
            const workflowContext: WorkflowContext = {
                model: this.config.model,
                lintFunction: this.toolContext.verilator
                    ? async (code: string) => {
                        // Write to temp file, lint, return errors
                        const tempPath = `${this.toolContext.projectRoot}/.gateflow/temp_lint.sv`;
                        await this.toolContext.fileTools.writeFile(tempPath, code);
                        const result = await this.toolContext.verilator!.lint(tempPath);
                        return {
                            errors: result.errors.map(e => `${e.file}:${e.line}: ${e.message}`),
                            warnings: result.warnings.map(w => `${w.file}:${w.line}: ${w.message}`)
                        };
                    }
                    : undefined,
                readFile: async (path: string) => {
                    const result = await this.toolContext.fileTools.readFile(path);
                    if (!result.content) {
                        throw new Error(`Failed to read file: ${path}`);
                    }
                    return result.content;
                },
                writeFile: async (path: string, content: string) => {
                    await this.toolContext.fileTools.writeFile(path, content);
                }
            };

            const result = await executeWorkflow(userMessage, selection, workflowContext);

            // Emit completion
            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: result.success
                    ? `Workflow completed${result.iterations ? ` in ${result.iterations} iterations` : ''}`
                    : 'Workflow completed with issues'
            });

            // Add result to session
            this.session.messages.push({
                role: 'assistant',
                content: result.output
            });

            return { status: 'applied', output: result.output, workflow: selection.workflow };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { status: 'failed', workflow: selectedWorkflow, error: errorMessage };
        }
    }

    // ========================================================================
    // PrepareStep Configuration
    // ========================================================================

    /**
     * Create a prepareStep function for dynamic step control.
     * Configures context management, model selection, and tool availability per step.
     *
     * @param mode - The prompt mode for mode-specific tool restrictions
     * @param bundle - The agent bundle containing LanguageModel objects (required to avoid AI Gateway fallback)
     */
    private createPrepareStep(mode: PromptMode, bundle: AgentBundle): PrepareStepFn {
        return combinePrepareSteps(
            // 1. Context window management - trim old messages to stay within limits
            contextWindowManager({
                maxMessages: 40,
                keepSystem: true,
                keepRecent: 15
            }),

            // 2. Dynamic model selection based on complexity
            // IMPORTANT: Pass LanguageModel objects (bundle.model), NOT strings
            // Passing strings causes AI SDK to fall back to AI Gateway
            dynamicModelSelector({
                defaultModel: bundle.model,
                // Use complex model if configured, otherwise fall back to default
                complexModel: bundle.complexModel ?? bundle.model,
                complexityThreshold: 5
            }),

            // 3. Budget-aware execution
            budgetAwareExecution({
                maxInputTokens: 80000,
                maxOutputTokens: 16000,
                onBudgetExceeded: 'summarize'
            }),

            // 4. Continuation warnings - alert agent as it approaches step limit
            continuationWarning({
                warningStep: 20,
                criticalStep: 23,
                stepLimit: this.config.maxToolCalls
            }),

            // 5. Mode-specific tool control
            this.createModeSpecificPrepareStep(mode)
        );
    }

    /**
     * Create mode-specific prepareStep logic.
     */
    private createModeSpecificPrepareStep(mode: PromptMode): PrepareStepFn {
        return ({ stepNumber, steps }) => {
            // Mode-specific tool restrictions
            switch (mode) {
                case 'lint_fix':
                    // For lint fix, prioritize lint and edit tools
                    if (stepNumber === 0) {
                        return { activeTools: ['lint_file', 'read_file'] };
                    }
                    return { activeTools: ['lint_file', 'read_file', 'edit_lines', 'search_replace'] };

                case 'testbench':
                    // For testbench, focus on read then write
                    if (stepNumber < 2) {
                        return { activeTools: ['read_file', 'find_module', 'list_files'] };
                    }
                    return { activeTools: ['write_file', 'read_file', 'run_simulation'] };

                case 'generate':
                    // For generation, analyze first then write
                    if (stepNumber < 2) {
                        return { activeTools: ['read_file', 'find_module', 'list_files', 'search_code'] };
                    }
                    return {}; // All tools available

                case 'debug':
                    // Debug mode - focus on analysis tools
                    return { activeTools: ['read_file', 'search_code', 'grep_context', 'tail_context', 'lint_file'] };

                default:
                    // General mode - no restrictions
                    return {};
            }
        };
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

    private formatApprovalError(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        if (lower.includes('timed out') || lower.includes('timeout')) {
            return 'Approval request timed out';
        }
        return message || 'Approval request failed';
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

    // ========================================================================
    // Continuation System
    // ========================================================================

    /** Last continuation checkpoint from request_continuation tool */
    private lastContinuationCheckpoint: ContinuationCheckpoint | null = null;

    /**
     * Run the agent with automatic continuation support.
     * Wraps run() in a loop that handles continuation checkpoints,
     * allowing tasks to complete across multiple segments.
     *
     * Each segment gets up to maxToolCalls steps. When the agent calls
     * request_continuation, a new segment starts with fresh step budget.
     *
     * Supports two modes:
     * - Fixed: Uses maxSegments (default 5) as hard limit
     * - Dynamic: Continues while progress is being made (tasks completing)
     *
     * @param userMessage - The user's request
     * @param options - Continuation options including maxSegments or dynamicSegments
     * @returns Combined response from all segments
     */
    async runWithContinuation(
        userMessage: string,
        options?: ContinuationOptions
    ): Promise<string> {
        const isDynamic = options?.dynamicSegments ?? false;
        const segmentLimit = isDynamic
            ? (options?.dynamicSegmentsCap ?? 20)  // Safety cap for dynamic mode
            : (options?.maxSegments ?? 5);         // Fixed limit

        let accumulatedResponse = '';
        let segmentNumber = 0;
        let cumulativeSteps = 0;
        let currentMessage = userMessage;
        let previousRemainingCount = Infinity;  // For progress tracking

        // Reset continuation tracking
        this.lastContinuationCheckpoint = null;

        while (segmentNumber < segmentLimit) {
            segmentNumber++;

            // Reset continuation checkpoint at start of each segment to prevent
            // stale checkpoints from previous segments being returned
            this.lastContinuationCheckpoint = null;

            const statusLabel = isDynamic
                ? (segmentNumber > 1 ? `Continuing... (segment ${segmentNumber}, making progress)` : 'Processing...')
                : (segmentNumber > 1 ? `Continuing... (segment ${segmentNumber}/${segmentLimit})` : 'Processing...');

            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: statusLabel
            });

            // Run a segment with continuation stop condition added
            const response = await this.run(currentMessage, {
                ...options,
                runtimeOptions: {
                    ...options?.runtimeOptions,
                    stopConditions: [
                        ...(options?.runtimeOptions?.stopConditions ?? []),
                        continuationRequested()
                    ]
                }
            });

            accumulatedResponse += response;

            // Check for continuation checkpoint
            const checkpoint = this.extractContinuationCheckpoint();
            cumulativeSteps += this.session.toolCallCount;

            if (!checkpoint || checkpoint.remainingTasks.length === 0) {
                // Task complete - no continuation requested or no remaining tasks
                break;
            }

            // Progress-based check for dynamic mode
            if (isDynamic) {
                const currentRemainingCount = checkpoint.remainingTasks.length;

                if (currentRemainingCount >= previousRemainingCount) {
                    // No progress - remaining tasks same or increased
                    this.bus.emit({
                        type: 'status',
                        phase: 'thinking',
                        label: `No progress detected (${currentRemainingCount} tasks remaining). Stopping.`
                    });
                    break;
                }

                previousRemainingCount = currentRemainingCount;
            }

            // Update checkpoint with segment info
            checkpoint.segmentNumber = segmentNumber;
            checkpoint.cumulativeSteps = cumulativeSteps;

            // Emit continuation event
            this.bus.emit({
                type: 'status',
                phase: 'tool',
                label: `Segment ${segmentNumber} complete: ${checkpoint.completedTasks.length} tasks done, ${checkpoint.remainingTasks.length} remaining`
            });

            // Callback for progress tracking
            options?.onSegmentComplete?.(checkpoint);

            // Build continuation prompt for next segment
            currentMessage = this.buildContinuationPrompt(checkpoint, userMessage);
        }

        // Final status
        if (segmentNumber >= segmentLimit) {
            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: isDynamic
                    ? `Reached safety cap (${segmentLimit} segments). Partial completion.`
                    : `Reached maximum segments (${segmentLimit}). Partial completion.`
            });
        }

        return accumulatedResponse;
    }

    /**
     * Extract continuation checkpoint from the last tool result.
     * Looks for request_continuation tool output with _continuation marker.
     */
    private extractContinuationCheckpoint(): ContinuationCheckpoint | null {
        // Search recent messages for tool results from request_continuation
        for (let i = this.session.messages.length - 1; i >= 0; i--) {
            const msg = this.session.messages[i];
            if (msg.role !== 'tool') continue;

            // Tool messages have content array with tool-result items
            const content = msg.content;
            if (!Array.isArray(content)) continue;

            for (const item of content) {
                if (typeof item !== 'object' || item === null) continue;
                const toolResult = item as { type?: string; toolName?: string; output?: unknown };

                if (toolResult.type === 'tool-result' &&
                    toolResult.toolName === 'request_continuation') {

                    const output = toolResult.output as Record<string, unknown> | null;
                    if (output && output._continuation === true) {
                        this.lastContinuationCheckpoint = {
                            completedTasks: (output.completedTasks as string[]) ?? [],
                            remainingTasks: (output.remainingTasks as string[]) ?? [],
                            partialResults: output.partialResults as string | undefined,
                            notes: output.notes as string | undefined,
                            segmentNumber: 0,
                            cumulativeSteps: 0
                        };
                        return this.lastContinuationCheckpoint;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Build continuation prompt for the next segment.
     * Adds context summary to session and returns focused continuation message.
     */
    private buildContinuationPrompt(
        checkpoint: ContinuationCheckpoint,
        _originalMessage: string
    ): string {
        // Add continuation context as system message
        const contextSummary = [
            `[Continuation - Segment ${checkpoint.segmentNumber + 1}]`,
            `Completed: ${checkpoint.completedTasks.join(', ')}`,
            `Remaining: ${checkpoint.remainingTasks.join(', ')}`
        ];

        if (checkpoint.notes) {
            contextSummary.push(`Notes: ${checkpoint.notes}`);
        }

        this.session.messages.push({
            role: 'system',
            content: contextSummary.join('\n')
        });

        // Return focused continuation prompt
        return `Continue with the remaining tasks: ${checkpoint.remainingTasks.join(', ')}`;
    }
}
