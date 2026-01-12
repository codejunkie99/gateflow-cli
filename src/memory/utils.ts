/**
 * Memory Module Utilities
 */

/**
 * Estimate token count for a text string.
 * Uses a heuristic based on whitespace-separated words with a multiplier.
 *
 * This is more accurate than simple length/4 for:
 * - Code with many symbols (SV, VHDL)
 * - Long identifiers
 * - Short function names
 *
 * For exact counts, use a proper tokenizer (e.g., tiktoken).
 *
 * @param text The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;

    // Count whitespace-separated tokens
    const words = text.split(/\s+/).filter(w => w.length > 0);

    // Apply multiplier: average word produces ~1.3 tokens
    // (accounts for punctuation, special chars being separate tokens)
    const wordBasedEstimate = Math.ceil(words.length * 1.3);

    // Also use character-based as a cap (some long words split into multiple tokens)
    const charBasedEstimate = Math.ceil(text.length / 4);

    // Return the higher estimate to be conservative (avoid exceeding budget)
    return Math.max(wordBasedEstimate, charBasedEstimate);
}
