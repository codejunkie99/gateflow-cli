/**
 * Shared Token Utilities
 *
 * Normalizes token field names across different AI providers.
 * AI SDK uses different naming conventions depending on the provider:
 * - Anthropic: inputTokens / outputTokens
 * - OpenAI: promptTokens / completionTokens
 * - Google/Gemini: promptTokenCount / candidatesTokenCount
 *
 * These helpers work with all conventions.
 */

/**
 * Token usage structure (handles all provider naming conventions).
 */
interface TokenUsage {
    // Anthropic style
    inputTokens?: number;
    outputTokens?: number;
    // OpenAI style
    promptTokens?: number;
    completionTokens?: number;
    // Google/Gemini style
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    // Aggregated (some providers include this)
    totalTokens?: number;
}

/**
 * Get input/prompt tokens from usage (handles all provider naming conventions).
 */
function getInputTokens(usage: TokenUsage | undefined | null): number {
    return usage?.inputTokens ?? usage?.promptTokens ?? usage?.promptTokenCount ?? 0;
}

/**
 * Get output/completion tokens from usage (handles all provider naming conventions).
 */
function getOutputTokens(usage: TokenUsage | undefined | null): number {
    return usage?.outputTokens ?? usage?.completionTokens ?? usage?.candidatesTokenCount ?? 0;
}

/**
 * Get total tokens from usage (calculates if not provided).
 */
function getTotalTokens(usage: TokenUsage | undefined | null): number {
    if (usage?.totalTokens !== undefined) {
        return usage.totalTokens;
    }
    if (usage?.totalTokenCount !== undefined) {
        return usage.totalTokenCount;
    }
    return getInputTokens(usage) + getOutputTokens(usage);
}

/**
 * Accumulate token usage across multiple steps.
 */
export function accumulateUsage(steps: Array<{ usage?: TokenUsage }>): { input: number; output: number; total: number } {
    return steps.reduce(
        (acc, step) => ({
            input: acc.input + getInputTokens(step.usage),
            output: acc.output + getOutputTokens(step.usage),
            total: acc.total + getTotalTokens(step.usage)
        }),
        { input: 0, output: 0, total: 0 }
    );
}
