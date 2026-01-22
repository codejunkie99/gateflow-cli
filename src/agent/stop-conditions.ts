/**
 * Enhanced Stop Conditions for AI SDK 6
 *
 * Provides flexible stop condition builders beyond simple step counting.
 * These can be composed using stopWhenAny/stopWhenAll for complex stopping logic.
 *
 * @example
 * // Stop when either step limit OR lint passes
 * stopWhen: stopWhenAny(
 *     maxSteps(25),
 *     lintPasses()
 * )
 */

import { stepCountIs } from 'ai';
import { getCostPerMillion } from './model-provider-openrouter.js';
import { accumulateUsage } from './token-helpers.js';
import type { PromptMode } from './prompts.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Context passed to stop condition functions by AI SDK 6.
 * Uses a flexible structure that works with AI SDK's actual types.
 *
 * Note: AI SDK 6 uses `steps` array where each step has:
 * - toolCalls: array with toolName and tool-specific properties
 * - toolResults: array with toolName and result (output) properties
 *
 * We use `any` for flexibility with AI SDK's generic types.
 */
export interface StopConditionContext {
    /** Steps executed so far */
    steps?: Array<{
        toolCalls?: Array<{
            toolName: string;
            [key: string]: unknown;
        }>;
        toolResults?: Array<{
            toolName: string;
            result?: unknown;
            output?: unknown; // AI SDK may use 'output' instead of 'result'
            [key: string]: unknown;
        }>;
        [key: string]: unknown;
    }>;
    /** Token usage statistics (AI SDK uses different field names per provider) */
    usage?: {
        // OpenAI/Anthropic style
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        // Alternative naming (some providers)
        inputTokens?: number;
        outputTokens?: number;
        [key: string]: unknown;
    };
    /** Whether the model has finished generating */
    finishReason?: string;
    /** Allow additional properties */
    [key: string]: unknown;
}

/**
 * Stop condition function type.
 * Returns true when the agent loop should stop.
 * Uses 'any' for AI SDK compatibility.
 */
export type StopCondition = (context: any) => boolean;

// ============================================================================
// Composition Functions
// ============================================================================

/**
 * Combine multiple stop conditions with OR logic.
 * Stops when ANY condition returns true.
 *
 * @param conditions - Stop conditions to combine
 * @returns Combined stop condition
 *
 * @example
 * stopWhenAny(
 *     maxSteps(25),
 *     tokenBudgetExhausted(100000),
 *     lintPasses()
 * )
 */
export function stopWhenAny(...conditions: StopCondition[]): StopCondition {
    return (context: StopConditionContext) =>
        conditions.some(condition => condition(context));
}

/**
 * Combine multiple stop conditions with AND logic.
 * Stops only when ALL conditions return true.
 *
 * @param conditions - Stop conditions to combine
 * @returns Combined stop condition
 *
 * @example
 * // Stop only when both step limit reached AND no pending tool calls
 * stopWhenAll(
 *     maxSteps(10),
 *     noToolCallsPending()
 * )
 */
export function stopWhenAll(...conditions: StopCondition[]): StopCondition {
    return (context: StopConditionContext) =>
        conditions.every(condition => condition(context));
}

// ============================================================================
// Context Extraction Helpers
// ============================================================================

/**
 * Tool result with normalized field access.
 */
interface ToolResult {
    toolName: string;
    /** Result value (AI SDK uses 'output' or 'result' depending on version) */
    value: unknown;
}

/**
 * Tool call with normalized field access.
 */
interface ToolCall {
    toolName: string;
}

/**
 * Extract all tool results from context steps.
 * Handles AI SDK's varying field names ('output' vs 'result').
 */
function getAllToolResults(context: any): ToolResult[] {
    const steps = context.steps ?? [];
    return steps.flatMap((step: any) =>
        (step.toolResults ?? []).map((r: any) => ({
            toolName: r.toolName as string,
            value: r.output ?? r.result
        }))
    );
}

/**
 * Extract all tool calls from context steps.
 */
function getAllToolCalls(context: any): ToolCall[] {
    const steps = context.steps ?? [];
    return steps.flatMap((step: any) =>
        (step.toolCalls ?? []).map((c: any) => ({
            toolName: c.toolName as string
        }))
    );
}

/**
 * Get the most recent result for a specific tool.
 */
function getLastToolResult(context: any, toolName: string): ToolResult | undefined {
    const results = getAllToolResults(context).filter(r => r.toolName === toolName);
    return results.at(-1);
}

// ============================================================================
// Step-Based Conditions
// ============================================================================

/**
 * Stop when step count reaches a limit.
 * This is our own implementation that avoids type casting with AI SDK's stepCountIs.
 *
 * @param maxSteps - Maximum number of steps before stopping
 * @returns Stop condition
 *
 * @example
 * stopWhen: maxSteps(25)
 */
export function maxSteps(limit: number): StopCondition {
    return (context: StopConditionContext) => (context.steps?.length ?? 0) >= limit;
}

// ============================================================================
// Token-Based Conditions
// ============================================================================

/**
 * Stop when total token usage exceeds a budget.
 * Accumulates usage across all steps.
 *
 * @param maxTokens - Maximum total tokens (prompt + completion)
 * @returns Stop condition
 *
 * @example
 * stopWhen: tokenBudgetExhausted(100000)
 */
export function tokenBudgetExhausted(maxTokens: number): StopCondition {
    return (context: any) => {
        const steps = context.steps ?? [];
        const usage = accumulateUsage(steps);
        return usage.total >= maxTokens;
    };
}

/**
 * Stop when completion/output tokens exceed a limit.
 * Accumulates usage across all steps.
 * Useful for controlling response length.
 *
 * @param maxTokens - Maximum completion tokens
 * @returns Stop condition
 */
export function completionTokensExceeded(maxTokens: number): StopCondition {
    return (context: any) => {
        const steps = context.steps ?? [];
        const usage = accumulateUsage(steps);
        return usage.output >= maxTokens;
    };
}

/**
 * Stop when input/prompt tokens exceed a limit.
 * Accumulates usage across all steps.
 * Useful for controlling context size.
 *
 * @param maxTokens - Maximum input tokens
 * @returns Stop condition
 */
export function inputTokensExceeded(maxTokens: number): StopCondition {
    return (context: any) => {
        const steps = context.steps ?? [];
        const usage = accumulateUsage(steps);
        return usage.input >= maxTokens;
    };
}

// ============================================================================
// Tool Result Conditions
// ============================================================================

/**
 * Stop when a specific tool result matches a predicate.
 * Checks all tool results across all steps.
 *
 * @param toolName - Name of the tool to check
 * @param predicate - Function to test the tool result
 * @returns Stop condition
 *
 * @example
 * // Stop when lint returns no errors
 * toolResultMatches('lint_file', (result) =>
 *     result?.errorCount === 0
 * )
 */
export function toolResultMatches(
    toolName: string,
    predicate: (result: unknown) => boolean
): StopCondition {
    return (context: any) => {
        const lastResult = getLastToolResult(context, toolName);
        return lastResult ? predicate(lastResult.value) : false;
    };
}

/**
 * Stop when ANY tool result matches a predicate.
 * Checks all tool results across all steps regardless of tool name.
 *
 * @param predicate - Function to test each tool result
 * @returns Stop condition
 */
export function anyToolResultMatches(
    predicate: (toolName: string, result: unknown) => boolean
): StopCondition {
    return (context: any) => {
        const allResults = getAllToolResults(context);
        return allResults.some(r => predicate(r.toolName, r.value));
    };
}

/**
 * Stop when a specific tool has been called N times.
 *
 * @param toolName - Name of the tool to count
 * @param maxCalls - Maximum number of calls
 * @returns Stop condition
 */
export function toolCallCountExceeded(toolName: string, maxCalls: number): StopCondition {
    return (context: any) => {
        const calls = getAllToolCalls(context).filter(c => c.toolName === toolName);
        return calls.length >= maxCalls;
    };
}

// ============================================================================
// Domain-Specific Conditions (GateFlow)
// ============================================================================

/**
 * Stop when lint_file tool returns with zero errors.
 * Designed for lint-fix workflows.
 *
 * @returns Stop condition
 *
 * @example
 * // In lint_fix mode
 * stopWhen: stopWhenAny(
 *     maxSteps(25),
 *     lintPasses()
 * )
 */
export function lintPasses(): StopCondition {
    return toolResultMatches('lint_file', (result: unknown) => {
        if (typeof result !== 'object' || result === null) {
            return false;
        }
        const r = result as Record<string, unknown>;
        return r.errorCount === 0 && (r.warningCount === 0 || r.warningCount === undefined);
    });
}

/**
 * Stop when simulation succeeds (run_simulation returns success).
 *
 * @returns Stop condition
 */
export function simulationPasses(): StopCondition {
    return toolResultMatches('run_simulation', (result: unknown) => {
        if (typeof result !== 'object' || result === null) {
            return false;
        }
        const r = result as Record<string, unknown>;
        return r.success === true || r.passed === true;
    });
}

/**
 * Stop when file has been written successfully.
 *
 * @param targetPath - Optional specific file path to check
 * @returns Stop condition
 */
export function fileWritten(targetPath?: string): StopCondition {
    return toolResultMatches('write_file', (result: unknown) => {
        if (typeof result !== 'object' || result === null) {
            return false;
        }
        const r = result as Record<string, unknown>;
        if (targetPath && r.path !== targetPath) {
            return false;
        }
        return r.success === true;
    });
}

// ============================================================================
// Utility Conditions
// ============================================================================

/**
 * Never stop (always returns false).
 * Useful as a default when composing conditions.
 */
export function neverStop(): StopCondition {
    return () => false;
}

/**
 * Always stop (always returns true).
 * Useful for testing or immediate termination.
 */
export function alwaysStop(): StopCondition {
    return () => true;
}

/**
 * Stop after a delay (approximate, based on step timing).
 * Note: This is a soft limit based on checking at each step.
 *
 * @param ms - Maximum duration in milliseconds
 * @param startTime - Start time (defaults to now)
 * @returns Stop condition
 */
export function durationExceeded(ms: number, startTime: number = Date.now()): StopCondition {
    return () => Date.now() - startTime >= ms;
}

// ============================================================================
// Cost-Based Conditions
// ============================================================================

/**
 * Stop when budget is exceeded (tokens or cost).
 *
 * Cost is calculated using per-million pricing. If modelId is provided,
 * pricing is fetched from OpenRouter's model data. Otherwise, falls back
 * to manual pricing or defaults.
 *
 * @example
 * // Auto-fetch pricing from OpenRouter for the model
 * budgetExceeded({
 *   modelId: 'anthropic/claude-sonnet-4',
 *   maxCost: 0.50
 * })
 *
 * @example
 * // Manual pricing override
 * budgetExceeded({
 *   maxCost: 0.50,
 *   inputCostPerMillion: 3,
 *   outputCostPerMillion: 15
 * })
 *
 * @example
 * // Simple token limit (no cost calculation)
 * budgetExceeded({ maxTotalTokens: 100000 })
 */
export function budgetExceeded(config: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxTotalTokens?: number;
    maxCost?: number;
    /** Model ID to auto-fetch pricing from OpenRouter */
    modelId?: string;
    /** Cost per 1 million input tokens - overrides modelId lookup */
    inputCostPerMillion?: number;
    /** Cost per 1 million output tokens - overrides modelId lookup */
    outputCostPerMillion?: number;
}): StopCondition {
    const {
        maxInputTokens = Infinity,
        maxOutputTokens = Infinity,
        maxTotalTokens = Infinity,
        maxCost = Infinity,
        modelId,
    } = config;

    // Get pricing: manual override > model lookup > defaults
    let inputCostPerMillion = config.inputCostPerMillion;
    let outputCostPerMillion = config.outputCostPerMillion;

    if (inputCostPerMillion === undefined || outputCostPerMillion === undefined) {
        if (modelId) {
            const modelPricing = getCostPerMillion(modelId);
            if (modelPricing) {
                inputCostPerMillion = inputCostPerMillion ?? modelPricing.input;
                outputCostPerMillion = outputCostPerMillion ?? modelPricing.output;
            }
        }
        // Final fallback: Claude Sonnet 4 pricing
        inputCostPerMillion = inputCostPerMillion ?? 3;
        outputCostPerMillion = outputCostPerMillion ?? 15;
    }

    // Capture final values for closure
    const finalInputCost = inputCostPerMillion;
    const finalOutputCost = outputCostPerMillion;

    return (context: any) => {
        const steps = context.steps ?? [];
        const usage = accumulateUsage(steps);

        // Cost calculation: tokens * ($/million) / 1,000,000
        const cost = (usage.input * finalInputCost + usage.output * finalOutputCost) / 1_000_000;

        return (
            usage.input >= maxInputTokens ||
            usage.output >= maxOutputTokens ||
            usage.total >= maxTotalTokens ||
            cost >= maxCost
        );
    };
}

/**
 * Convenience function: stop when cost exceeds budget for a specific model.
 * Automatically fetches pricing from OpenRouter.
 *
 * @param modelId - Model ID (e.g., 'anthropic/claude-sonnet-4')
 * @param maxCost - Maximum cost in USD
 * @returns Stop condition
 *
 * @example
 * stopWhen: budgetExceededForModel('anthropic/claude-haiku-3-5', 0.10)
 */
export function budgetExceededForModel(modelId: string, maxCost: number): StopCondition {
    return budgetExceeded({ modelId, maxCost });
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Configuration for mode-based stop conditions.
 */
export interface ModeStopConfig {
    /** Agent execution mode */
    mode: PromptMode;
    /** Maximum steps before forced stop (default: 25) */
    stepLimit?: number;
}

/**
 * Internal configuration for a specific mode's stop behavior.
 */
interface ModeStopBehavior {
    /** Step multiplier (1 = normal, 1.2 = 20% more steps) */
    stepMultiplier?: number;
    /** Success condition that can end the loop early */
    successCondition?: () => StopCondition;
}

/**
 * Unified registry of mode-specific stop behaviors.
 * Each mode can optionally specify:
 * - stepMultiplier: Adjust the base step limit
 * - successCondition: Early termination when task succeeds
 */
const MODE_BEHAVIORS: Partial<Record<PromptMode, ModeStopBehavior>> = {
    lint_fix: {
        successCondition: lintPasses,
    },
    testbench: {
        successCondition: simulationPasses,
    },
    debug: {
        stepMultiplier: 1.2, // 20% more steps for debugging
    },
};

/**
 * Create a stop condition for a specific mode.
 * Combines step limit with mode-specific success conditions.
 *
 * @param config - Mode and step limit configuration
 * @returns Composite stop condition
 *
 * @example
 * // Basic usage
 * stopWhen: createModeStopCondition({ mode: 'lint_fix' })
 *
 * @example
 * // With custom step limit
 * stopWhen: createModeStopCondition({ mode: 'debug', stepLimit: 40 })
 */
export function createModeStopCondition(config: ModeStopConfig): StopCondition;
/**
 * @deprecated Use object config: createModeStopCondition({ mode, stepLimit })
 */
export function createModeStopCondition(mode: string, stepLimit?: number): StopCondition;
export function createModeStopCondition(
    configOrMode: ModeStopConfig | string,
    legacyStepLimit?: number
): StopCondition {
    // Handle both signatures for backwards compatibility
    const config: ModeStopConfig = typeof configOrMode === 'string'
        ? { mode: configOrMode as PromptMode, stepLimit: legacyStepLimit }
        : configOrMode;

    const { mode, stepLimit: baseLimit = 25 } = config;

    // Get mode-specific behavior (if any)
    const behavior = MODE_BEHAVIORS[mode];

    // Apply mode-specific step multiplier
    const multiplier = behavior?.stepMultiplier ?? 1;
    const effectiveLimit = Math.ceil(baseLimit * multiplier);

    const stepCondition = maxSteps(effectiveLimit);

    // Combine with success condition if defined
    if (behavior?.successCondition) {
        return stopWhenAny(stepCondition, behavior.successCondition());
    }

    return stepCondition;
}

// Re-export stepCountIs for backwards compatibility (prefer maxSteps for type safety)
export { stepCountIs };
