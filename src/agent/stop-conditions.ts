/**
 * Enhanced Stop Conditions for AI SDK 6
 *
 * Provides flexible stop condition builders beyond simple step counting.
 * These can be composed using stopWhenAny/stopWhenAll for complex stopping logic.
 *
 * @example
 * // Stop when either step limit OR lint passes
 * stopWhen: stopWhenAny(
 *     stepCountIs(25),
 *     lintPasses()
 * )
 */

import { stepCountIs } from 'ai';

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
    /** Token usage statistics */
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
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
 *     stepCountIs(25),
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
 *     stepCountIs(10),
 *     noToolCallsPending()
 * )
 */
export function stopWhenAll(...conditions: StopCondition[]): StopCondition {
    return (context: StopConditionContext) =>
        conditions.every(condition => condition(context));
}

// ============================================================================
// Token-Based Conditions
// ============================================================================

/**
 * Stop when total token usage exceeds a budget.
 *
 * @param maxTokens - Maximum total tokens (prompt + completion)
 * @returns Stop condition
 *
 * @example
 * stopWhen: tokenBudgetExhausted(100000)
 */
export function tokenBudgetExhausted(maxTokens: number): StopCondition {
    return (context: StopConditionContext) =>
        (context.usage?.totalTokens ?? 0) >= maxTokens;
}

/**
 * Stop when completion tokens exceed a limit.
 * Useful for controlling response length.
 *
 * @param maxTokens - Maximum completion tokens
 * @returns Stop condition
 */
export function completionTokensExceeded(maxTokens: number): StopCondition {
    return (context: StopConditionContext) =>
        (context.usage?.completionTokens ?? 0) >= maxTokens;
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
        const allResults = context.steps
            ?.flatMap((step: any) => step.toolResults ?? [])
            ?.filter((r: any) => r.toolName === toolName);

        if (!allResults || allResults.length === 0) {
            return false;
        }

        // Check the most recent result - AI SDK may use 'output' or 'result'
        const lastResult = allResults.at(-1);
        const resultValue = lastResult?.output ?? lastResult?.result;
        return lastResult ? predicate(resultValue) : false;
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
        const allResults = context.steps?.flatMap((step: any) => step.toolResults ?? []);
        return allResults?.some((r: any) => {
            const resultValue = r?.output ?? r?.result;
            return predicate(r.toolName, resultValue);
        }) ?? false;
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
        const callCount = context.steps
            ?.flatMap((step: any) => step.toolCalls ?? [])
            ?.filter((c: any) => c.toolName === toolName)
            ?.length ?? 0;

        return callCount >= maxCalls;
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
 *     stepCountIs(25),
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
// Factory Functions
// ============================================================================

/**
 * Create a stop condition for a specific mode.
 * Returns sensible defaults based on the agent's execution mode.
 *
 * @param mode - Agent execution mode
 * @param stepLimit - Maximum steps (default: 25)
 * @returns Appropriate stop condition
 */
export function createModeStopCondition(
    mode: string,
    stepLimit: number = 25
): StopCondition {
    const baseCondition = stepCountIs(stepLimit) as unknown as StopCondition;

    switch (mode) {
        case 'lint_fix':
            return stopWhenAny(baseCondition, lintPasses());

        case 'testbench':
            return stopWhenAny(baseCondition, simulationPasses());

        case 'generate':
        case 'edit':
            // For generation modes, just use step limit
            return baseCondition;

        case 'debug':
            // Debug mode might need more steps
            return stepCountIs(Math.max(stepLimit, 30)) as unknown as StopCondition;

        default:
            return baseCondition;
    }
}

// Re-export stepCountIs for convenience
export { stepCountIs };
