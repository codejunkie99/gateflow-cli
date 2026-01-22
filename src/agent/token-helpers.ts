/**
 * Shared Token Utilities
 *
 * Normalizes token field names across different AI providers.
 * AI SDK uses different naming conventions depending on the provider:
 * - Anthropic: inputTokens / outputTokens
 * - OpenAI: promptTokens / completionTokens
 *
 * These helpers work with both conventions.
 */

/**
 * Token usage structure (handles both naming conventions).
 */
export interface TokenUsage {
    // Anthropic style
    inputTokens?: number;
    outputTokens?: number;
    // OpenAI style
    promptTokens?: number;
    completionTokens?: number;
    // Aggregated (some providers include this)
    totalTokens?: number;
}

/**
 * Get input/prompt tokens from usage (handles both naming conventions).
 */
export function getInputTokens(usage: TokenUsage | undefined | null): number {
    return usage?.inputTokens ?? usage?.promptTokens ?? 0;
}

/**
 * Get output/completion tokens from usage (handles both naming conventions).
 */
export function getOutputTokens(usage: TokenUsage | undefined | null): number {
    return usage?.outputTokens ?? usage?.completionTokens ?? 0;
}

/**
 * Get total tokens from usage (calculates if not provided).
 */
export function getTotalTokens(usage: TokenUsage | undefined | null): number {
    if (usage?.totalTokens !== undefined) {
        return usage.totalTokens;
    }
    return getInputTokens(usage) + getOutputTokens(usage);
}

/**
 * Accumulate token usage across multiple steps.
 */
export function accumulateUsage(steps: Array<{ usage?: TokenUsage }>): { input: number; output: number; total: number } {
    const result = steps.reduce(
        (acc, step) => ({
            input: acc.input + getInputTokens(step.usage),
            output: acc.output + getOutputTokens(step.usage)
        }),
        { input: 0, output: 0 }
    );
    return { ...result, total: result.input + result.output };
}
