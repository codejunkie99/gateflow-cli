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
import { accumulateUsage } from './token-helpers.js';

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
 * Note: 'stop' mode returns empty settings and relies on a separate stopWhen
 * condition (e.g., tokenBudgetExceeded) to actually terminate the loop.
 * Use 'trim' or 'summarize' for self-contained budget handling.
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
        const usage = accumulateUsage(steps as Array<{ usage?: any }>);

        const inputExceeded = usage.input > maxInputTokens;
        const outputExceeded = usage.output > maxOutputTokens;

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
 * Combine multiple prepareStep functions.
 * Later functions override earlier ones for conflicting keys.
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
        }

        return settings;
    };
}

// Re-export stepCountIs for convenience
export { stepCountIs };
