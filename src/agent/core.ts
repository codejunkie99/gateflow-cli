/**
 * GateFlow Agent Core
 * Main agent orchestration using Vercel AI SDK
 *
 * AI SDK 6 Features:
 * - Uses createAgentBundle for tool configuration
 * - Supports needsApproval for tool approval workflow
 * - Integrates with PolicyEngine for path safety
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
    getEffectiveStepLimit,
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
    /**
     * Max characters to keep from partial continuation results.
     * Set to 0 to omit partial results from continuation context.
     */
    continuationPartialResultsMaxChars?: number;
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
    /** Cumulative tool calls across all segments */
    cumulativeToolCalls: number;
    /** Cumulative completed tasks across all segments */
    cumulativeCompletedTasks: number;
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
const DEFAULT_CONTINUATION_PARTIAL_MAX_CHARS = 2000;
const CONTINUATION_PARTIAL_MAX_CHARS_ENV = 'GATEFLOW_CONTINUATION_PARTIAL_MAX_CHARS';

function parseNonNegativeInt(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return undefined;
    }

    return parsed;
}

function resolveContinuationPartialResultsMaxChars(): number {
    return (
        parseNonNegativeInt(process.env[CONTINUATION_PARTIAL_MAX_CHARS_ENV])
        ?? DEFAULT_CONTINUATION_PARTIAL_MAX_CHARS
    );
}

function truncatePartialResults(partialResults: string, maxLength: number): string {
    if (maxLength <= 0) {
        return '';
    }

    if (partialResults.length <= maxLength) {
        return partialResults;
    }

    const marker = '\n...\n';
    if (maxLength <= marker.length + 1) {
        if (maxLength <= 3) {
            return partialResults.slice(-maxLength);
        }
        return '...' + partialResults.slice(-Math.max(0, maxLength - 3));
    }

    const available = maxLength - marker.length;
    let headLength = Math.min(500, Math.floor(available * 0.25));
    let tailLength = available - headLength;

    if (headLength <= 0) {
        headLength = 1;
        tailLength = available - headLength;
    }

    if (tailLength <= 0) {
        tailLength = 1;
        headLength = available - tailLength;
    }

    const head = partialResults.slice(0, headLength);
    const tail = partialResults.slice(-tailLength);
    return `${head}${marker}${tail}`;
}

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

        const continuationPartialResultsMaxChars =
            config?.continuationPartialResultsMaxChars
            ?? resolveContinuationPartialResultsMaxChars();

        this.config = {
            model: resolvedModelString,
            modelConfig: resolvedModelConfig,
            complexModel: config?.complexModel,
            complexModelConfig: config?.complexModelConfig,
            maxTokens: config?.maxTokens ?? 8192,
            temperature: config?.temperature ?? 0.7,
            maxToolCalls: config?.maxToolCalls ?? 25,
            systemPrompt: config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            continuationPartialResultsMaxChars
        };

        const existingContinuationHandler = toolContext.onContinuationCheckpoint;
        this.toolContext = {
            ...toolContext,
            onContinuationCheckpoint: (checkpoint) => {
                this.lastContinuationCheckpoint = {
                    completedTasks: checkpoint.completedTasks,
                    remainingTasks: checkpoint.remainingTasks,
                    partialResults: checkpoint.partialResults,
                    notes: checkpoint.notes,
                    segmentNumber: 0,
                    cumulativeToolCalls: 0,
                    cumulativeCompletedTasks: 0
                };
                existingContinuationHandler?.(checkpoint);
            }
        };
        this.memoryService = toolContext.memoryService;
        this.memoryManager = toolContext.memoryManager ?? toolContext.memoryService?.memory;
        this.executors = createToolExecutors(this.toolContext);
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
     * Wraps executors to emit tool_progress events for granular UI feedback.
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

                    // Extract file path for metadata (used by read_file, write_file, etc.)
                    const argsObj = args as Record<string, unknown> | null;
                    const filePath = argsObj?.path as string | undefined;

                    // Emit 'executing' state - tool execution is starting
                    // Note: 'started' is emitted from stream processing when tool-call is received
                    this.bus.emit({
                        type: 'tool_progress',
                        tool: name,
                        state: 'executing',
                        metadata: filePath ? { file: filePath } : undefined
                    });

                    try {
                        const result = await executor(args);

                        // Build metadata for completed state
                        const metadata: { file?: string; lineCount?: number } = {};
                        if (filePath) {
                            metadata.file = filePath;
                        }

                        // For read_file, extract line count from result
                        if (name === 'read_file' && result && typeof result === 'object') {
                            const readResult = result as { lines?: number };
                            if (typeof readResult.lines === 'number') {
                                metadata.lineCount = readResult.lines;
                            }
                        }

                        // Emit 'completed' state with metadata
                        this.bus.emit({
                            type: 'tool_progress',
                            tool: name,
                            state: 'completed',
                            metadata: Object.keys(metadata).length > 0 ? metadata : undefined
                        });

                        return result;
                    } catch (error) {
                        // Emit 'failed' state on error
                        this.bus.emit({
                            type: 'tool_progress',
                            tool: name,
                            state: 'failed',
                            metadata: filePath ? { file: filePath } : undefined
                        });
                        throw error;
                    }
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

        // Track completion state for finally block
        let fullResponse = '';
        let runSucceeded = false;
        let runError: unknown = null;

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

            const resolveMode = (): PromptMode => {
                const modeContext: DetectModeContext = {
                    hasErrors: this.session.hasErrors,
                    ...options?.modeContext
                };
                return callOptions?.mode ?? options?.mode ?? detectMode(userMessage, modeContext);
            };

            // Route to orchestrator immediately if multi-agent is needed
            // This happens BEFORE mode detection to prevent mode from blocking orchestration
            if (complexity.needsMultiAgent && this.orchestrator) {
                // Keep session mode up to date even for orchestrated requests.
                this.session.currentMode = resolveMode();

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
                // LIMITATION: Orchestrator only returns final text, not intermediate tool calls.
                // This means continuation (via request_continuation tool) is not supported for
                // multi-agent tasks - extractContinuationCheckpoint() won't find tool results.
                // TODO: To support continuation for orchestrated tasks, either:
                //   1. Have orchestrator populate session.messages with tool results, or
                //   2. Implement a separate continuation mechanism for orchestrated tasks
                const orchestratorResult = await this.orchestrator.executeWithPlan(userMessage);
                const trimmedResult = orchestratorResult.trim();
                // Guard against empty content which violates LLM API contracts
                if (trimmedResult) {
                    this.session.messages.push({
                        role: 'assistant',
                        content: orchestratorResult
                    });
                    fullResponse = orchestratorResult;
                } else {
                    const emptyResultMessage =
                        'Multi-agent run completed with no text output. Check file changes or logs for results.';
                    this.bus.emit({
                        type: 'status',
                        phase: 'thinking',
                        label: emptyResultMessage
                    });
                    this.session.messages.push({
                        role: 'assistant',
                        content: emptyResultMessage
                    });
                    fullResponse = emptyResultMessage;
                }
                // Set response and success flag - completion events emitted in finally
                runSucceeded = true;
            }

            // ========================================================================
            // Single-agent flow: Mode detection happens AFTER complexity check
            // Skip if orchestrator already handled the request
            // ========================================================================
            if (!runSucceeded) {

            // Detect mode for this query (can be overridden by call options)
            const mode = resolveMode();
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
                    // Set response and success flag - completion events emitted in finally
                    fullResponse = workflowOutcome.output;
                    runSucceeded = true;
                    break;
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

            // Skip single-agent flow if workflow already handled the request
            if (!runSucceeded) {
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

                    // Emit thinking_stream completion event when step finishes
                    // This marks the end of reasoning for this step
                    if (step.reasoning) {
                        this.bus.emit({
                            type: 'thinking_stream',
                            text: '',
                            isComplete: true
                        });
                    }
                },

                // AI SDK 6: onChunk callback for real-time reasoning/thinking stream
                // Emits thinking_stream events for Claude Code-like UI feedback
                onChunk: ({ chunk }) => {
                    if (chunk.type === 'reasoning-delta') {
                        // Emit reasoning text as it streams in
                        this.bus.emit({
                            type: 'thinking_stream',
                            text: chunk.text,
                            isComplete: false
                        });
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

                    case 'tool-call': {
                        // AI SDK 6: Emit tool call event from stream (uses 'input' not 'args')
                        this.bus.emit({
                            type: 'tool_call',
                            tool: part.toolName,
                            argsSummary: this.summarizeArgs(part.input),
                            args: part.input as Record<string, unknown>
                        });

                        // Emit tool_progress 'started' state when tool call is received
                        const toolInput = part.input as Record<string, unknown> | null;
                        const toolFilePath = toolInput?.path as string | undefined;
                        this.bus.emit({
                            type: 'tool_progress',
                            tool: part.toolName,
                            state: 'started',
                            metadata: toolFilePath ? { file: toolFilePath } : undefined
                        });

                        options?.onToolCall?.(part.toolName, part.input);
                        break;
                    }

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

            // Mark single-agent flow as successful
            runSucceeded = true;

            } // End: if (!runSucceeded) after workflow check
            } // End: if (!runSucceeded) after orchestrator check

        } catch (error) {
            // Save error for finally block - don't emit events here
            runError = error;
            runSucceeded = false;
        } finally {
            // Always emit completion events regardless of exit path
            this.bus.emit({ type: 'token_done' });

            // Emit agent lifecycle complete with token usage
            // AI SDK 6: Include extended usage details when available
            const extendedUsage = lastUsage?.extended;
            this.bus.emit({
                type: 'agent_complete',
                agentName: 'gateflow',
                success: runSucceeded,
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

            // Re-throw error if one occurred, or return response
            if (runError) {
                const errorMsg = runError instanceof Error ? runError.message : String(runError);
                this.bus.emit({
                    type: 'error',
                    message: errorMsg
                });
                throw runError;
            }
        }

        return fullResponse;
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
        const effectiveLimit = getEffectiveStepLimit(mode, this.config.maxToolCalls);
        const warningStep = Math.max(0, effectiveLimit - 5);
        const criticalStep = Math.max(0, effectiveLimit - 2);

        return combinePrepareSteps(
            // 0. Track step state for continuation guard
            ({ stepNumber }) => {
                this.toolContext.continuationState = {
                    currentStep: stepNumber + 1,
                    warningStep,
                    criticalStep,
                    stepLimit: effectiveLimit
                };
                return {};
            },

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
            // Use mode-effective limit so warnings align with actual stop condition
            continuationWarning({
                warningStep,
                criticalStep,
                stepLimit: effectiveLimit
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
            // NOTE: request_continuation is always included to support multi-segment execution
            switch (mode) {
                case 'lint_fix':
                    // For lint fix, prioritize lint and edit tools
                    if (stepNumber === 0) {
                        return { activeTools: ['lint_file', 'read_file', 'request_continuation'] };
                    }
                    return { activeTools: ['lint_file', 'read_file', 'edit_lines', 'search_replace', 'request_continuation'] };

                case 'testbench':
                    // For testbench, focus on read then write
                    if (stepNumber < 2) {
                        return { activeTools: ['read_file', 'find_module', 'list_files', 'request_continuation'] };
                    }
                    return { activeTools: ['write_file', 'read_file', 'run_simulation', 'request_continuation'] };

                case 'generate':
                    // For generation, analyze first then write
                    if (stepNumber < 2) {
                        return { activeTools: ['read_file', 'find_module', 'list_files', 'search_code', 'request_continuation'] };
                    }
                    return {}; // All tools available

                case 'debug':
                    // Debug mode - focus on analysis tools
                    return { activeTools: ['read_file', 'search_code', 'grep_context', 'tail_context', 'lint_file', 'request_continuation'] };

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
        // Clear checkpoints file (fire-and-forget)
        this.clearCheckpointsFile().catch(() => {});
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
    /** Message index at start of current segment (for scoped checkpoint extraction) */
    private segmentStartMessageIndex: number = 0;

    /**
     * Run the agent with automatic continuation support.
     * Wraps run() in a loop that handles continuation checkpoints,
     * allowing tasks to complete across multiple segments.
     *
     * Each segment gets a step budget determined by the agent's mode:
     * - Base limit is maxToolCalls (default 25)
     * - Mode multipliers apply (e.g., debug mode uses 1.5x)
     * - Actual per-segment steps = getEffectiveStepLimit(mode, maxToolCalls)
     *
     * When the agent calls request_continuation, a new segment starts
     * with a fresh step budget.
     *
     * Supports two modes:
     * - Fixed: Uses maxSegments (default 5) as hard limit
     * - Dynamic: Continues while progress is being made (tasks completing)
     *
     * Note: Total steps across all segments can exceed maxSegments * maxToolCalls
     * when mode multipliers are active.
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
        let cumulativeToolCalls = 0;
        let currentMessage = userMessage;
        let previousRemainingCount = Infinity;  // For progress tracking
        const completedTaskIds = new Set<string>(); // Track unique completed tasks across segments
        let cumulativeCompletedCount = 0;       // Track total completed across segments
        let lockedMode: PromptMode | undefined; // Preserve mode across continuation segments

        // Reset continuation tracking
        this.lastContinuationCheckpoint = null;

        while (segmentNumber < segmentLimit) {
            segmentNumber++;

            // One-time warning when dynamic mode starts
            if (isDynamic && segmentNumber === 1) {
                this.bus.emit({
                    type: 'status',
                    phase: 'thinking',
                    label: `Dynamic continuation enabled (up to ${segmentLimit} segments if making progress)`
                });
            }

            // Snapshot tool call count at segment start to compute delta later
            const segmentStartToolCalls = this.session.toolCallCount;

            // Reset continuation checkpoint at start of each segment to prevent
            // stale checkpoints from previous segments being returned
            this.lastContinuationCheckpoint = null;
            // Track message boundary for scoped checkpoint extraction
            this.segmentStartMessageIndex = this.session.messages.length;

            const statusLabel = isDynamic
                ? (segmentNumber > 1 ? `Continuing... (segment ${segmentNumber}, making progress)` : 'Processing...')
                : (segmentNumber > 1 ? `Continuing... (segment ${segmentNumber}/${segmentLimit})` : 'Processing...');

            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: statusLabel
            });

            // Run a segment with continuation stop condition added
            // Lock mode after first segment to prevent re-detection from generic continuation prompts
            const response = await this.run(currentMessage, {
                ...options,
                mode: lockedMode ?? options?.mode,  // Use locked mode once established
                runtimeOptions: {
                    ...options?.runtimeOptions,
                    stopConditions: [
                        ...(options?.runtimeOptions?.stopConditions ?? []),
                        continuationRequested()
                    ]
                }
            });

            // After first segment, lock the mode to prevent drift
            if (!lockedMode) {
                lockedMode = this.session.currentMode;
            }

            // Add delimiter between segments to prevent merged/ambiguous output
            if (segmentNumber > 1 && response.trim()) {
                accumulatedResponse += '\n\n';
            }
            accumulatedResponse += response;

            // Check for continuation checkpoint
            const checkpoint = this.extractContinuationCheckpoint();
            // Add only the delta (tool calls made in THIS segment), not the session total
            cumulativeToolCalls += this.session.toolCallCount - segmentStartToolCalls;

            if (!checkpoint || checkpoint.remainingTasks.length === 0) {
                // Task complete - no continuation requested or no remaining tasks
                break;
            }

            // Track cumulative completed tasks across all segments (for both modes)
            const newlyCompleted = checkpoint.completedTasks.filter(task => !completedTaskIds.has(task));
            for (const task of newlyCompleted) {
                completedTaskIds.add(task);
            }
            cumulativeCompletedCount = completedTaskIds.size;

            // Progress-based check for dynamic mode
            if (isDynamic) {
                const currentRemainingCount = checkpoint.remainingTasks.length;

                // Progress is made if: remaining decreased OR tasks were completed this segment
                // remainingDecreased also covers the "all done" case even if completedTasks is empty.
                const remainingDecreased = currentRemainingCount < previousRemainingCount;
                const tasksCompleted = newlyCompleted.length > 0;

                if (!remainingDecreased && !tasksCompleted) {
                    // No progress - remaining didn't decrease AND no tasks completed
                    this.bus.emit({
                        type: 'status',
                        phase: 'thinking',
                        label: `No progress detected (${currentRemainingCount} tasks remaining, 0 completed). Stopping.`
                    });
                    break;
                }

                previousRemainingCount = currentRemainingCount;
            }

            // Update checkpoint with segment info
            checkpoint.segmentNumber = segmentNumber;
            checkpoint.cumulativeToolCalls = cumulativeToolCalls;
            checkpoint.cumulativeCompletedTasks = cumulativeCompletedCount;

            // Emit continuation event
            this.bus.emit({
                type: 'status',
                phase: 'tool',
                label: `Segment ${segmentNumber} complete: ${checkpoint.completedTasks.length} tasks done, ${checkpoint.remainingTasks.length} remaining`
            });

            // Callback for progress tracking
            options?.onSegmentComplete?.(checkpoint);

            // Defensive: external callbacks could mutate the checkpoint
            if (checkpoint.remainingTasks.length === 0) {
                this.bus.emit({
                    type: 'status',
                    phase: 'thinking',
                    label: 'Continuation requested but remainingTasks is empty after callback. Stopping.'
                });
                break;
            }

            // Prune old messages to prevent unbounded growth
            await this.pruneSegmentMessages();

            // Build continuation prompt for next segment
            currentMessage = await this.buildContinuationPrompt(checkpoint, userMessage);
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
     * Safely coerce an unknown value to a string array.
     * Handles malformed LLM outputs gracefully:
     * - Arrays: filters to string elements only
     * - Strings: wraps in array
     * - null/undefined/other: returns empty array
     */
    private toStringArray(value: unknown): string[] {
        if (Array.isArray(value)) {
            return value.filter((item): item is string => typeof item === 'string');
        }
        if (typeof value === 'string' && value.trim() !== '') {
            return [value];
        }
        return [];
    }

    /**
     * Extract continuation checkpoint from the last tool result.
     * Looks for request_continuation tool output with _continuation marker.
     * Only searches messages from the current segment (since segmentStartMessageIndex).
     *
     * NOTE: This only works for direct agent execution. Orchestrated multi-agent tasks
     * don't populate session.messages with tool results, so continuation checkpoints
     * from worker agents won't be found. See executeWithPlan() for details.
     */
    private extractContinuationCheckpoint(): ContinuationCheckpoint | null {
        if (this.lastContinuationCheckpoint) {
            return this.lastContinuationCheckpoint;
        }

        // If summarization pruned messages during this segment, the saved index may be
        // out of bounds. Fall back to scanning all messages to ensure we find the checkpoint.
        const scanStartIndex = this.segmentStartMessageIndex < this.session.messages.length
            ? this.segmentStartMessageIndex
            : 0;

        // Search only current segment's messages for tool results from request_continuation
        for (let i = this.session.messages.length - 1; i >= scanStartIndex; i--) {
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
                            completedTasks: this.toStringArray(output.completedTasks),
                            remainingTasks: this.toStringArray(output.remainingTasks),
                            partialResults: typeof output.partialResults === 'string' ? output.partialResults : undefined,
                            notes: typeof output.notes === 'string' ? output.notes : undefined,
                            segmentNumber: 0,
                            cumulativeToolCalls: 0,
                            cumulativeCompletedTasks: 0
                        };
                        return this.lastContinuationCheckpoint;
                    }
                }
            }
        }

        return null;
    }

    // =========================================================================
    // Checkpoint File Storage
    // =========================================================================

    /**
     * Get path to checkpoints file for this session.
     */
    private getCheckpointsFilePath(): string {
        return path.join(this.toolContext.projectRoot, '.gateflow', 'checkpoints.jsonl');
    }

    /**
     * Save a checkpoint to the JSONL file.
     * Appends to existing file (one checkpoint per line).
     */
    private async saveCheckpointToFile(checkpoint: ContinuationCheckpoint): Promise<void> {
        const filePath = this.getCheckpointsFilePath();
        const dir = path.dirname(filePath);

        try {
            await fs.mkdir(dir, { recursive: true });
            await fs.appendFile(filePath, JSON.stringify(checkpoint) + '\n', 'utf-8');
        } catch {
            // Non-critical - pruning will fall back to regex if file unavailable
        }
    }

    /**
     * Load checkpoints from the JSONL file.
     * Returns empty array if file doesn't exist or is corrupted.
     * Limits to last 100 checkpoints to prevent unbounded memory growth.
     */
    private async loadCheckpointsFromFile(): Promise<ContinuationCheckpoint[]> {
        const filePath = this.getCheckpointsFilePath();

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            // Limit to last 100 checkpoints to prevent unbounded memory growth
            const recentLines = lines.slice(-100);
            return recentLines.map(line => JSON.parse(line) as ContinuationCheckpoint);
        } catch {
            return [];
        }
    }

    /**
     * Clear checkpoints file (called when starting new conversation).
     */
    private async clearCheckpointsFile(): Promise<void> {
        try {
            await fs.unlink(this.getCheckpointsFilePath());
        } catch {
            // File may not exist
        }
    }

    /**
     * Build continuation prompt for the next segment.
     * Adds context summary to session, saves checkpoint to file, and returns focused continuation message.
     */
    private async buildContinuationPrompt(
        checkpoint: ContinuationCheckpoint,
        _originalMessage: string
    ): Promise<string> {
        // Save checkpoint to file for later consolidation (avoids regex parsing)
        await this.saveCheckpointToFile(checkpoint);

        // Add continuation context as system message
        // NOTE: Format must match regex fallback in pruneSegmentMessages() for consolidation
        const contextSummary = [
            `[Continuation - Segment ${checkpoint.segmentNumber}]`,
            `Completed: ${checkpoint.completedTasks.join(', ')}`,  // Parsed by /Completed:\s*([^\n]+)/
            `Remaining: ${checkpoint.remainingTasks.join(', ')}`   // Parsed by /Remaining:\s*([^\n]+)/
        ];

        if (checkpoint.notes) {
            contextSummary.push(`Notes: ${checkpoint.notes}`);
        }

        // Include partial results so agent can continue from intermediate work
        if (checkpoint.partialResults) {
            const maxLength = this.config.continuationPartialResultsMaxChars ?? DEFAULT_CONTINUATION_PARTIAL_MAX_CHARS;
            if (maxLength > 0) {
                const partial = truncatePartialResults(checkpoint.partialResults, maxLength);
                contextSummary.push(`Partial results from previous segment:\n${partial}`);
            }
        }

        this.session.messages.push({
            role: 'system',
            content: contextSummary.join('\n')
        });

        // Return focused continuation prompt
        return `Continue with the remaining tasks: ${checkpoint.remainingTasks.join(', ')}`;
    }

    /**
     * Prune session messages to prevent unbounded growth across continuation segments.
     * Keeps: first user message, non-continuation system messages, consolidated continuation context, and recent messages.
     * Uses stored checkpoints from filesystem for reliable consolidation (no regex parsing).
     * @param keepRecent - Number of recent messages to preserve (default: 10)
     */
    private async pruneSegmentMessages(keepRecent: number = 10): Promise<void> {
        const messages = this.session.messages;
        if (messages.length <= keepRecent + 5) {
            // Not enough messages to warrant pruning
            return;
        }

        // Load checkpoints from file for reliable consolidation
        const storedCheckpoints = await this.loadCheckpointsFromFile();

        // Separate continuation system messages from other system messages
        const continuationPrefix = '[Continuation -';
        const continuationMessages: Array<{ index: number; content: string }> = [];
        const otherSystemIndices: number[] = [];

        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'system') {
                const msgContent = messages[i].content;
                const content = typeof msgContent === 'string' ? msgContent : '';
                if (content.startsWith(continuationPrefix)) {
                    continuationMessages.push({ index: i, content });
                } else {
                    otherSystemIndices.push(i);
                }
            }
        }

        // Find indices to keep
        const keepIndices = new Set<number>();

        // Always keep the original user request (not context injection)
        // Find by content rather than numeric index since indices shift after each prune
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'user') {
                const msgContent = messages[i].content;
                const content = typeof msgContent === 'string' ? msgContent : '';
                if (!content.startsWith('[Context]:')) {
                    keepIndices.add(i);
                    break;
                }
            }
        }

        // Keep all non-continuation system messages
        for (const idx of otherSystemIndices) {
            keepIndices.add(idx);
        }

        // For continuation messages: keep only the most recent one
        // Use stored checkpoints for reliable consolidation (no regex parsing)
        if (continuationMessages.length > 0) {
            const lastContinuation = continuationMessages[continuationMessages.length - 1];

            if (continuationMessages.length > 1) {
                let mergedCompleted: string[] = [];
                let remainingTasks: string[] = [];
                let notes: string | undefined;

                if (storedCheckpoints.length > 0) {
                    // Consolidate: collect completed tasks from all stored checkpoints
                    const allCompletedTasks = storedCheckpoints.flatMap(cp => cp.completedTasks);
                    mergedCompleted = [...new Set(allCompletedTasks)];
                    const latestCheckpoint = storedCheckpoints[storedCheckpoints.length - 1];
                    remainingTasks = latestCheckpoint?.remainingTasks ?? [];
                    notes = latestCheckpoint?.notes;
                } else {
                    // Fallback: parse completed tasks from message content using regex
                    // NOTE: Regex must match format in buildContinuationPrompt()
                    const completedRegex = /Completed:\s*([^\n]+)/;
                    const remainingRegex = /Remaining:\s*([^\n]+)/;

                    for (const contMsg of continuationMessages) {
                        const completedMatch = contMsg.content.match(completedRegex);
                        if (completedMatch) {
                            const tasks = completedMatch[1].split(',').map(t => t.trim()).filter(Boolean);
                            mergedCompleted.push(...tasks);
                        }
                    }
                    mergedCompleted = [...new Set(mergedCompleted)];

                    // Get remaining from the last continuation
                    const lastRemainingMatch = lastContinuation.content.match(remainingRegex);
                    if (lastRemainingMatch) {
                        remainingTasks = lastRemainingMatch[1].split(',').map(t => t.trim()).filter(Boolean);
                    }
                }

                if (mergedCompleted.length > 0) {
                    // Extract segment number from last continuation for backward compatibility
                    const segmentMatch = lastContinuation.content.match(/\[Continuation - Segment (\d+)\]/);
                    const segmentLabel = segmentMatch
                        ? `[Continuation - Segment ${segmentMatch[1]}]`
                        : `[Continuation - Consolidated]`;

                    // Build consolidated continuation message
                    const consolidatedContent = [
                        segmentLabel,
                        `Completed: ${mergedCompleted.join(', ')}`,
                        `Remaining: ${remainingTasks.join(', ')}`
                    ];

                    if (notes) {
                        consolidatedContent.push(`Notes: ${notes}`);
                    }

                    messages[lastContinuation.index] = {
                        role: 'system',
                        content: consolidatedContent.join('\n')
                    };
                }
            }

            // Only keep the (now consolidated) last continuation message
            keepIndices.add(lastContinuation.index);
        }

        // Keep the most recent messages
        let startRecent = Math.max(0, messages.length - keepRecent);
        // Ensure we don't start on a tool message (which needs its parent assistant)
        while (startRecent > 0 && startRecent < messages.length && messages[startRecent].role === 'tool') {
            startRecent--;
        }
        for (let i = startRecent; i < messages.length; i++) {
            keepIndices.add(i);
        }

        // Build pruned array (use direct assignment to avoid call stack limit with spread)
        this.session.messages = messages.filter((_, i) => keepIndices.has(i));
    }
}
