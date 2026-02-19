/**
 * Memory Module Utilities
 *
 * Re-exports token estimation from token-estimator.ts for backward compatibility.
 */

import {
    estimateTokensSimple,
    estimateTokens as estimateTokensDetailed,
    type TokenEstimate,
    type TokenConfig,
    type TokenBreakdown,
    type ContentType
} from './token-estimator.js';

// Re-export types
;

// Re-export detailed function
;

/**
 * Estimate token count for a text string.
 * Uses content-aware estimation with HDL-specific optimizations.
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
    return estimateTokensSimple(text);
}
