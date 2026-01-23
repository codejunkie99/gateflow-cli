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
import { type StopCondition } from './stop-conditions.js';

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
        // Normalize tool result access: AI SDK v6 uses 'output', older versions use 'result'
        const hadErrors = steps.some((step: any) =>
            step.toolResults?.some((r: any) => {
                const result = 'output' in r ? r.output : r.result;
                return typeof result === 'object' && result !== null && 'error' in result;
            })
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
 * Budget configuration for prepareStep handlers.
 */
export interface BudgetConfig {
    maxInputTokens: number;
    maxOutputTokens: number;
    onBudgetExceeded: 'stop' | 'summarize' | 'trim';
}

/**
 * Create a prepareStep that tracks and enforces a token budget.
 *
 * **WARNING**: 'stop' mode is a no-op by design - it returns empty settings
 * and relies on a separate stopWhen condition to actually terminate the loop.
 * Use 'trim' or 'summarize' for self-contained budget handling.
 *
 * For 'stop' mode, prefer `createBudgetController()` which returns both the
 * prepareStep function and the matching stopWhen condition.
 *
 * @example
 * // WRONG: 'stop' mode won't actually stop anything
 * prepareStep: budgetAwareExecution({
 *   maxInputTokens: 50000,
 *   maxOutputTokens: 10000,
 *   onBudgetExceeded: 'stop'  // ⚠️ No-op without matching stopWhen!
 * })
 *
 * @example
 * // CORRECT: Use createBudgetController() for 'stop' mode
 * const budget = createBudgetController({
 *   maxInputTokens: 50000,
 *   maxOutputTokens: 10000
 * });
 * const agent = new ToolLoopAgent({
 *   prepareStep: budget.prepareStep,
 *   stopWhen: stopWhenAny(maxSteps(25), budget.stopWhen)
 * });
 *
 * @example
 * // Also correct: 'trim' mode is self-contained
 * prepareStep: budgetAwareExecution({
 *   maxInputTokens: 50000,
 *   maxOutputTokens: 10000,
 *   onBudgetExceeded: 'trim'  // ✓ Works without extra stopWhen
 * })
 */
export function budgetAwareExecution(config: BudgetConfig): PrepareStepFn {
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
 * Budget controller configuration.
 */
export interface BudgetControllerConfig {
    /** Maximum input tokens before stopping */
    maxInputTokens: number;
    /** Maximum output tokens before stopping */
    maxOutputTokens: number;
}

/**
 * Budget controller return type - bundles prepareStep and stopWhen together.
 */
export interface BudgetController {
    /** PrepareStep function (currently a no-op, reserved for future budget-aware features) */
    prepareStep: PrepareStepFn;
    /** StopWhen condition that stops when budget is exceeded */
    stopWhen: StopCondition;
}

/**
 * Create a budget controller that bundles prepareStep and stopWhen together.
 *
 * This is the recommended way to implement budget-based stopping. Unlike
 * `budgetAwareExecution({ onBudgetExceeded: 'stop' })`, this function returns
 * both the prepareStep function AND the matching stopWhen condition, making
 * it impossible to forget one without the other.
 *
 * @example
 * import { createBudgetController } from './loop-control.js';
 * import { maxSteps, stopWhenAny } from './stop-conditions.js';
 *
 * const budget = createBudgetController({
 *   maxInputTokens: 50000,
 *   maxOutputTokens: 10000
 * });
 *
 * const agent = new ToolLoopAgent({
 *   prepareStep: budget.prepareStep,
 *   stopWhen: stopWhenAny(maxSteps(25), budget.stopWhen)
 * });
 */
export function createBudgetController(config: BudgetControllerConfig): BudgetController {
    const { maxInputTokens, maxOutputTokens } = config;

    // PrepareStep is a no-op for 'stop' mode - all logic is in stopWhen
    const prepareStep: PrepareStepFn = () => ({});

    // StopWhen checks accumulated usage across all steps
    const stopWhen: StopCondition = (context: any) => {
        const steps = context.steps ?? [];
        const usage = accumulateUsage(steps as Array<{ usage?: any }>);
        return usage.input >= maxInputTokens || usage.output >= maxOutputTokens;
    };

    return { prepareStep, stopWhen };
}

/**
 * Combine multiple prepareStep functions.
 * Later functions override earlier ones for conflicting keys,
 * EXCEPT for 'system' which is concatenated to preserve all injected prompts.
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
        const systemParts: string[] = [];

        for (const fn of fns) {
            const result = await fn(context);
            // Collect system prompts separately for concatenation
            if (result.system) {
                systemParts.push(result.system);
            }
            // Spread other properties (override behavior)
            const { system: _system, ...rest } = result;
            settings = { ...settings, ...rest };
        }

        // Concatenate all system prompts if any were provided
        if (systemParts.length > 0) {
            settings.system = systemParts.join('');
        }

        return settings;
    };
}

// ============================================================================
// Continuation System
// ============================================================================

/**
 * Configuration for continuation warning injection.
 * All step values are 1-indexed (human-readable step counts).
 */
export interface ContinuationWarningConfig {
    /** Step number to start showing warning, 1-indexed (default: 20) */
    warningStep?: number;
    /** Step number to show critical warning, 1-indexed (default: 23) */
    criticalStep?: number;
    /** Total step limit for reference in messages, 1-indexed (default: 25) */
    stepLimit?: number;
}

/**
 * Injects continuation warnings into the system prompt as the agent approaches step limits.
 * Warns at warningStep (default 20), escalates to critical at criticalStep (default 23).
 *
 * This prepareStep function appends to the system prompt to remind the agent
 * to call `request_continuation` before hitting the hard limit.
 *
 * @param config - Warning configuration
 * @returns PrepareStep function that injects warnings
 *
 * @example
 * prepareStep: combinePrepareSteps(
 *     contextWindowManager({ maxMessages: 40 }),
 *     continuationWarning({ warningStep: 20, criticalStep: 23 })
 * )
 */
export function continuationWarning(config: ContinuationWarningConfig = {}): PrepareStepFn {
    const stepLimit = config.stepLimit ?? 25;
    const warningStep = config.warningStep ?? stepLimit - 5;
    const criticalStep = config.criticalStep ?? stepLimit - 2;

    return ({ stepNumber }) => {
        // stepNumber is 0-indexed (AI SDK convention), but warningStep/criticalStep/stepLimit
        // are 1-indexed (human-readable step counts). Convert for correct comparison and display.
        const currentStep = stepNumber + 1;  // 1-indexed for display and threshold comparison
        const remaining = Math.max(0, stepLimit - currentStep);  // Steps remaining after this one

        if (currentStep >= criticalStep) {
            // Special message when at or past the limit
            if (remaining === 0) {
                return {
                    system: `\n\n**CRITICAL**: Step limit reached (${currentStep}/${stepLimit}). ` +
                        `You MUST use the request_continuation tool IMMEDIATELY to checkpoint your progress. ` +
                        `Include completedTasks (what you've done), remainingTasks (what's left), and notes (key context).`
                };
            }
            return {
                system: `\n\n**CRITICAL**: You have ${remaining} step${remaining !== 1 ? 's' : ''} remaining. ` +
                    `You MUST use the request_continuation tool NOW to checkpoint your progress. ` +
                    `Include completedTasks (what you've done), remainingTasks (what's left), and notes (key context).`
            };
        }

        if (currentStep >= warningStep) {
            return {
                system: `\n\n**WARNING**: Approaching step limit (${currentStep}/${stepLimit}, ${remaining} remaining). ` +
                    `If you have more work to do, use the request_continuation tool to checkpoint progress before reaching the limit.`
            };
        }

        return {};
    };
}

// Re-export stepCountIs for convenience
export { stepCountIs };
