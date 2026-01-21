/**
 * Loop Control for AI SDK 6
 *
 * Implements prepareStep and stopWhen patterns for dynamic agent control:
 * - Dynamic model selection based on step complexity
 * - Tool availability per phase
 * - Context management (message trimming)
 * - Budget-aware execution
 *
 * @see https://sdk.vercel.ai/docs/agents/loop-control
 */

import { stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import type { StopCondition } from './stop-conditions.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Step context passed to prepareStep
 * Compatible with AI SDK's PrepareStepFunction options
 * Uses 'any' for steps to accept AI SDK's StepResult type
 */
export interface StepContext {
    /** Current model configuration (LanguageModel from AI SDK) */
    model: unknown;
    /** Current step number (0-indexed) */
    stepNumber: number;
    /** All previous steps with their results (AI SDK StepResult[]) */
    steps: readonly any[];
    /** Messages to be sent to the model */
    messages: readonly any[];
    /** Experimental context (AI SDK internal) */
    experimental_context?: unknown;
}

/**
 * Helper type for extracting step info (for user convenience)
 */
export interface StepInfo {
    /** Text generated in this step */
    text?: string;
    /** Tool calls made in this step */
    toolCalls?: ToolCallInfo[];
    /** Tool results from this step */
    toolResults?: ToolResultInfo[];
    /** Token usage for this step */
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
}

export interface ToolCallInfo {
    toolName: string;
    args?: unknown;
}

export interface ToolResultInfo {
    toolName: string;
    result?: unknown;
    output?: unknown;
}

/**
 * Message type (compatible with AI SDK's ModelMessage)
 */
export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | unknown;
    [key: string]: unknown;
}

/**
 * Settings that can be modified by prepareStep
 * Compatible with AI SDK's PrepareStepResult
 */
export interface StepSettings {
    /** Model to use for this step */
    model?: LanguageModel;
    /** Active tools for this step */
    activeTools?: string[];
    /** Tool choice mode */
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string };
    /** Messages to send */
    messages?: ModelMessage[];
    /** System prompt override */
    system?: string;
    /** Experimental context (AI SDK internal) */
    experimental_context?: unknown;
}

/**
 * PrepareStep function type
 */
export type PrepareStepFn = (context: StepContext) => Promise<StepSettings> | StepSettings;

/**
 * Phase configuration for phased execution.
 * Use LanguageModel objects for model overrides to avoid AI Gateway fallback.
 */
export interface Phase {
    /** Phase name */
    name: string;
    /** Step range [start, end) */
    steps: [number, number];
    /** Tools available in this phase */
    tools: string[];
    /** Whether tools are required */
    toolChoice?: 'auto' | 'required';
    /** Model to use (optional override) - must be LanguageModel object, NOT string */
    model?: LanguageModel;
}

// ============================================================================
// Built-in PrepareStep Implementations
// ============================================================================

/**
 * Create a prepareStep that manages context window by trimming old messages.
 *
 * @example
 * const agent = new ToolLoopAgent({
 *   prepareStep: contextWindowManager({ maxMessages: 20, keepSystem: true })
 * });
 */
export function contextWindowManager(config: {
    maxMessages: number;
    keepSystem?: boolean;
    keepRecent?: number;
}): PrepareStepFn {
    const { maxMessages, keepSystem = true, keepRecent = 10 } = config;

    return ({ messages }) => {
        if (messages.length <= maxMessages) {
            return {};
        }

        const msgArray = [...messages];
        const systemMessages = keepSystem
            ? msgArray.filter(m => m.role === 'system')
            : [];
        const nonSystemMessages = msgArray.filter(m => m.role !== 'system');
        const recentMessages = nonSystemMessages.slice(-keepRecent);

        return {
            messages: [...systemMessages, ...recentMessages]
        };
    };
}

/**
 * Configuration for dynamic model selection.
 * Accepts LanguageModel objects to avoid AI Gateway fallback.
 */
export interface DynamicModelSelectorConfig {
    /** Default model to use for simple tasks */
    defaultModel: LanguageModel;
    /** Model to use for complex tasks (errors, long context) */
    complexModel: LanguageModel;
    /** Step threshold for switching to complex model (default: 5) */
    complexityThreshold?: number;
    /** Message count threshold for complexity (default: 15) */
    messageThreshold?: number;
}

/**
 * Create a prepareStep that switches models based on complexity.
 *
 * IMPORTANT: Pass LanguageModel objects, NOT strings!
 * Passing strings causes AI SDK to fall back to AI Gateway.
 *
 * @example
 * import { createModel, parseModelString } from './model-provider.js';
 *
 * const defaultModel = createModel(parseModelString('anthropic/claude-sonnet-4-5-20250929'));
 * const complexModel = createModel(parseModelString('anthropic/claude-opus-4-5-20251101'));
 *
 * const agent = new ToolLoopAgent({
 *   prepareStep: dynamicModelSelector({
 *     defaultModel,
 *     complexModel,
 *     complexityThreshold: 5
 *   })
 * });
 */
export function dynamicModelSelector(config: DynamicModelSelectorConfig): PrepareStepFn {
    const {
        defaultModel,
        complexModel,
        complexityThreshold = 5,
        messageThreshold = 15
    } = config;

    return ({ stepNumber, steps, messages }) => {
        // Check complexity conditions
        const isComplex = stepNumber > complexityThreshold || messages.length > messageThreshold;

        // Check if previous steps had errors
        const hadErrors = steps.some((step: any) =>
            step.toolResults?.some((r: any) =>
                typeof r.result === 'object' && r.result !== null && 'error' in r.result
            )
        );

        if (isComplex || hadErrors) {
            return { model: complexModel };
        }

        return { model: defaultModel };
    };
}

/**
 * Create a prepareStep that executes in phases with different tool sets.
 *
 * Phase.model is now properly typed as LanguageModel (not string), so it's
 * safe to include in the return value without triggering AI Gateway fallback.
 *
 * @example
 * import { createModel, parseModelString } from './model-provider.js';
 *
 * const researchModel = createModel(parseModelString('anthropic/claude-haiku-4-5'));
 * const outputModel = createModel(parseModelString('anthropic/claude-sonnet-4-5'));
 *
 * const agent = new ToolLoopAgent({
 *   prepareStep: phasedExecution([
 *     { name: 'research', steps: [0, 3], tools: ['search', 'read_file'], model: researchModel },
 *     { name: 'analysis', steps: [3, 6], tools: ['analyze', 'lint'] },
 *     { name: 'output', steps: [6, 10], tools: ['write_file'], toolChoice: 'required', model: outputModel }
 *   ])
 * });
 */
export function phasedExecution(phases: Phase[]): PrepareStepFn {
    return ({ stepNumber }) => {
        const currentPhase = phases.find(
            phase => stepNumber >= phase.steps[0] && stepNumber < phase.steps[1]
        );

        if (!currentPhase) {
            // Past all phases, allow all tools
            return {};
        }

        const result: StepSettings = {
            activeTools: currentPhase.tools,
            toolChoice: currentPhase.toolChoice ?? 'auto',
        };

        // Safe to include model since Phase.model is now typed as LanguageModel, not string
        if (currentPhase.model) {
            result.model = currentPhase.model;
        }

        return result;
    };
}

/**
 * Create a prepareStep that tracks and enforces a token budget.
 *
 * @example
 * const agent = new ToolLoopAgent({
 *   prepareStep: budgetAwareExecution({
 *     maxInputTokens: 50000,
 *     maxOutputTokens: 10000,
 *     onBudgetExceeded: 'summarize'
 *   })
 * });
 */
export function budgetAwareExecution(config: {
    maxInputTokens: number;
    maxOutputTokens: number;
    onBudgetExceeded: 'stop' | 'summarize' | 'trim';
}): PrepareStepFn {
    const { maxInputTokens, maxOutputTokens, onBudgetExceeded } = config;

    return ({ steps, messages }) => {
        // Calculate total usage
        const totalUsage = steps.reduce(
            (acc, step) => ({
                input: acc.input + (step.usage?.inputTokens ?? 0),
                output: acc.output + (step.usage?.outputTokens ?? 0)
            }),
            { input: 0, output: 0 }
        );

        const inputExceeded = totalUsage.input > maxInputTokens;
        const outputExceeded = totalUsage.output > maxOutputTokens;

        if (!inputExceeded && !outputExceeded) {
            return {};
        }

        switch (onBudgetExceeded) {
            case 'stop':
                // Return empty to let stopWhen handle it
                return {};

            case 'trim':
                // Keep only recent messages
                const msgArr = [...messages];
                const systemMsgs = msgArr.filter(m => m.role === 'system');
                const recentMsgs = msgArr.filter(m => m.role !== 'system').slice(-5);
                return { messages: [...systemMsgs, ...recentMsgs] };

            case 'summarize':
                // Add instruction to summarize via system prompt
                return {
                    system: '\n\nIMPORTANT: Token budget is running low. Please summarize your findings and conclude.'
                };

            default:
                return {};
        }
    };
}

/**
 * Create a prepareStep that forces specific tools at specific steps.
 *
 * @example
 * const agent = new ToolLoopAgent({
 *   prepareStep: forcedToolSequence([
 *     { step: 0, tool: 'search' },
 *     { step: 3, tool: 'analyze' },
 *     { step: 6, tool: 'summarize' }
 *   ])
 * });
 */
export function forcedToolSequence(
    sequence: Array<{ step: number; tool: string }>
): PrepareStepFn {
    return ({ stepNumber }) => {
        const forced = sequence.find(s => s.step === stepNumber);

        if (forced) {
            return {
                toolChoice: { type: 'tool', toolName: forced.tool }
            };
        }

        return {};
    };
}

/**
 * Combine multiple prepareStep functions.
 *
 * @example
 * const agent = new ToolLoopAgent({
 *   prepareStep: combinePrepareSteps(
 *     contextWindowManager({ maxMessages: 20 }),
 *     dynamicModelSelector({ defaultModel: '...', complexModel: '...' }),
 *     phasedExecution([...])
 *   )
 * });
 */
export function combinePrepareSteps(...fns: PrepareStepFn[]): PrepareStepFn {
    return async (context) => {
        let settings: StepSettings = {};

        for (const fn of fns) {
            const result = await fn(context);
            settings = { ...settings, ...result };

            // Special handling for messages - use the most recent one
            if (result.messages) {
                settings.messages = result.messages;
            }
        }

        return settings;
    };
}

// ============================================================================
// Custom Stop Conditions
// ============================================================================

/**
 * Stop when budget is exceeded.
 */
export function budgetExceeded(config: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxTotalTokens?: number;
    maxCost?: number;
    inputCostPer1k?: number;
    outputCostPer1k?: number;
}): StopCondition {
    const {
        maxInputTokens = Infinity,
        maxOutputTokens = Infinity,
        maxTotalTokens = Infinity,
        maxCost = Infinity,
        inputCostPer1k = 0.003,
        outputCostPer1k = 0.015
    } = config;

    return (context: any) => {
        const steps = context.steps ?? [];
        const totalUsage = steps.reduce(
            (acc: any, step: any) => ({
                input: acc.input + (step.usage?.inputTokens ?? 0),
                output: acc.output + (step.usage?.outputTokens ?? 0)
            }),
            { input: 0, output: 0 }
        );

        const totalTokens = totalUsage.input + totalUsage.output;
        const cost = (totalUsage.input * inputCostPer1k + totalUsage.output * outputCostPer1k) / 1000;

        return (
            totalUsage.input >= maxInputTokens ||
            totalUsage.output >= maxOutputTokens ||
            totalTokens >= maxTotalTokens ||
            cost >= maxCost
        );
    };
}

/**
 * Stop when a specific text pattern is found in any step's output.
 */
export function hasTextPattern(pattern: string | RegExp): StopCondition {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    return (context: any) => {
        const steps = context.steps ?? [];
        return steps.some((step: any) => step.text && regex.test(step.text));
    };
}

/**
 * Stop when a tool returns a specific result.
 */
export function toolReturned(
    toolName: string,
    predicate: (result: unknown) => boolean
): StopCondition {
    return (context: any) => {
        const steps = context.steps ?? [];
        for (const step of steps) {
            for (const result of step.toolResults ?? []) {
                if (result.toolName === toolName && predicate(result.result ?? result.output)) {
                    return true;
                }
            }
        }
        return false;
    };
}

/**
 * Stop when the 'done' tool is called (for forced tool calling pattern).
 */
export function doneToolCalled(): StopCondition {
    return (context: any) => {
        const steps = context.steps ?? [];
        const lastStep = steps[steps.length - 1];
        return lastStep?.toolCalls?.some((c: any) => c.toolName === 'done') ?? false;
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a 'done' tool for forced tool calling pattern.
 * This tool has no execute function, so it stops the loop.
 */
export function createDoneTool() {
    return {
        description: 'Signal that you have finished your work and provide the final answer',
        inputSchema: {
            type: 'object' as const,
            properties: {
                answer: {
                    type: 'string',
                    description: 'The final answer or result'
                },
                summary: {
                    type: 'string',
                    description: 'Brief summary of what was accomplished'
                }
            },
            required: ['answer']
        }
        // No execute function - this stops the agent when called
    };
}

/**
 * Extract the final answer from a done tool call.
 */
export function extractDoneAnswer(steps: StepInfo[]): { answer: string; summary?: string } | null {
    for (const step of steps.reverse()) {
        for (const call of step.toolCalls ?? []) {
            if (call.toolName === 'done') {
                const args = call.args as { answer?: string; summary?: string };
                if (args?.answer) {
                    return { answer: args.answer, summary: args.summary };
                }
            }
        }
    }
    return null;
}

// Re-export stepCountIs for convenience
export { stepCountIs };
