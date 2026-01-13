/**
 * Content-Aware Token Estimator for SV/VHDL Knowledge Items
 *
 * Provides more accurate token estimation than simple length/4 heuristics by:
 * - Detecting content type (code vs text)
 * - Accounting for HDL-specific symbol density
 * - Including safety margins for budget enforcement
 */

// ============================================================================
// Types
// ============================================================================

export interface TokenConfig {
    /** Multiplier for natural language text (default: 1.3) */
    textMultiplier: number;
    /** Multiplier for HDL code (default: 1.7) */
    codeMultiplier: number;
    /** Additional penalty for symbol density (default: 0.05) */
    symbolPenalty: number;
    /** Safety margin multiplier (default: 1.1 = 10% buffer) */
    safetyMargin: number;
    /** Minimum characters per token (default: 3) */
    minPerToken: number;
    /** Maximum characters per token (default: 5) */
    maxPerToken: number;
}

export interface TokenBreakdown {
    /** Token estimate based on word count */
    wordBased: number;
    /** Token estimate based on character count */
    charBased: number;
    /** Additional tokens for symbol density */
    symbolAdjustment: number;
    /** Tokens added for safety margin */
    safetyMargin: number;
    /** Final total estimate */
    total: number;
}

export interface TokenEstimate {
    /** Final token count estimate */
    tokens: number;
    /** Breakdown of how estimate was calculated */
    breakdown: TokenBreakdown;
}

export type ContentType = 'code' | 'text' | 'mixed';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_TOKEN_CONFIG: TokenConfig = {
    textMultiplier: 1.3,
    codeMultiplier: 1.7,     // Higher for HDL due to symbol density
    symbolPenalty: 0.05,     // 5% extra for dense symbols
    safetyMargin: 1.1,       // 10% buffer for safety
    minPerToken: 3,
    maxPerToken: 5
};

// HDL code indicators for content type detection
const HDL_CODE_PATTERNS = [
    // SystemVerilog patterns
    /\b(always_ff|always_comb|always_latch)\s*[@#]/,
    /\b(module|interface|package|class)\s+\w+/i,
    /\b(input|output|inout|logic|reg|wire)\s+/i,
    /\[\d+:\d+\]/,                              // Bit vectors [7:0]
    /\b(assign|initial|final)\b/,
    /\b(posedge|negedge)\b/,
    /`(define|include|ifdef|endif)/,            // Preprocessor

    // VHDL patterns
    /\b(architecture|entity|component)\s+\w+/i,
    /\b(process|begin|end)\b/i,
    /\b(signal|variable|constant)\s+\w+\s*:/i,
    /\b(std_logic|std_logic_vector|unsigned|signed)\b/i,
    /\b(downto|to)\b/i,
    /:=/,                                       // VHDL assignment
    /<=(?!\s*=)/,                               // Signal assignment (not <=)

    // Common HDL patterns
    /\b(clk|clock|reset|rst|rst_n|data|valid|ready)\b/i,
    /\b(state|next_state|current_state)\b/i
];

// Symbol pattern for counting punctuation/operators
const SYMBOL_PATTERN = /[{}()\[\]<>.,;:!@#$%^&*+=\-_|\\/?'"` ~]/g;

// ============================================================================
// Content Type Detection
// ============================================================================

/**
 * Detect whether text is code, natural language, or mixed
 */
export function detectContentType(text: string): ContentType {
    if (!text || text.length === 0) return 'text';

    // Count how many HDL patterns match
    const matchCount = HDL_CODE_PATTERNS.filter(pattern => pattern.test(text)).length;
    const matchRatio = matchCount / HDL_CODE_PATTERNS.length;

    // Thresholds for classification
    if (matchRatio > 0.3) return 'code';
    if (matchRatio > 0.1) return 'mixed';
    return 'text';
}

/**
 * Count symbol characters in text
 */
function countSymbols(text: string): number {
    const matches = text.match(SYMBOL_PATTERN);
    return matches ? matches.length : 0;
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count with detailed breakdown
 *
 * @param text Text to estimate tokens for
 * @param config Optional configuration overrides
 * @returns Token estimate with breakdown
 */
export function estimateTokens(
    text: string,
    config: Partial<TokenConfig> = {}
): TokenEstimate {
    const cfg = { ...DEFAULT_TOKEN_CONFIG, ...config };

    // Handle empty input
    if (!text || text.length === 0) {
        return {
            tokens: 0,
            breakdown: {
                wordBased: 0,
                charBased: 0,
                symbolAdjustment: 0,
                safetyMargin: 0,
                total: 0
            }
        };
    }

    // Detect content type
    const contentType = detectContentType(text);

    // Method 1: Word-based estimation
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordBased = Math.ceil(words.length * cfg.textMultiplier);

    // Method 2: Character-based estimation
    const charBased = Math.ceil(text.length / 4);

    // Method 3: Symbol density adjustment (HDL-specific)
    const symbolCount = countSymbols(text);
    const symbolRatio = text.length > 0 ? symbolCount / text.length : 0;
    const symbolAdjustment = Math.ceil(text.length * symbolRatio * cfg.symbolPenalty);

    // Choose base estimate based on content type
    let base: number;
    if (contentType === 'code') {
        // For code: use higher of word-based and adjusted char-based
        // Code tends to have more symbols that become separate tokens
        base = Math.max(wordBased, Math.ceil(charBased * 0.8));
    } else if (contentType === 'mixed') {
        // For mixed: blend both methods
        base = Math.ceil((wordBased + charBased) / 2);
    } else {
        // For text: standard approach
        base = Math.max(wordBased, charBased);
    }

    // Add symbol adjustment
    const adjusted = base + symbolAdjustment;

    // Apply safety margin
    const safetyAmount = Math.ceil(adjusted * (cfg.safetyMargin - 1));
    const total = adjusted + safetyAmount;

    return {
        tokens: total,
        breakdown: {
            wordBased,
            charBased,
            symbolAdjustment,
            safetyMargin: safetyAmount,
            total
        }
    };
}

/**
 * Simple token estimation matching original utils.ts signature
 * For backward compatibility
 *
 * @param text Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokensSimple(text: string): number {
    return estimateTokens(text).tokens;
}

/**
 * Estimate tokens for multiple text blocks
 *
 * @param texts Array of text blocks
 * @param config Optional configuration
 * @returns Total token estimate
 */
export function estimateTokensTotal(
    texts: string[],
    config: Partial<TokenConfig> = {}
): number {
    return texts.reduce((sum, text) => sum + estimateTokens(text, config).tokens, 0);
}

/**
 * Check if content fits within a token budget
 *
 * @param text Text to check
 * @param budget Maximum allowed tokens
 * @param config Optional configuration
 * @returns True if content fits within budget
 */
export function fitsInBudget(
    text: string,
    budget: number,
    config: Partial<TokenConfig> = {}
): boolean {
    return estimateTokens(text, config).tokens <= budget;
}

/**
 * Truncate text to fit within a token budget
 *
 * @param text Text to truncate
 * @param budget Maximum allowed tokens
 * @param config Optional configuration
 * @returns Truncated text with ellipsis
 */
export function truncateToFit(
    text: string,
    budget: number,
    config: Partial<TokenConfig> = {}
): string {
    // Validate budget
    if (budget <= 0) {
        return '';
    }

    if (fitsInBudget(text, budget, config)) {
        return text;
    }

    // Binary search for truncation point
    let low = 0;
    let high = text.length;
    const suffix = '\n... [truncated]';
    const suffixTokens = estimateTokens(suffix, config).tokens;
    const effectiveBudget = budget - suffixTokens;

    // Handle edge case where suffix alone exceeds budget
    if (effectiveBudget <= 0) {
        return suffix;
    }

    // Binary search with 1-character precision for accurate budget enforcement
    while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        const testText = text.slice(0, mid);
        if (estimateTokens(testText, config).tokens <= effectiveBudget) {
            low = mid;
        } else {
            high = mid;
        }
    }

    // Find a clean break point (newline or space) searching backward
    let breakPoint = low;
    for (let i = low; i > Math.max(0, low - 100); i--) {
        if (text[i] === '\n' || text[i] === ' ') {
            breakPoint = i;
            break;
        }
    }

    // Final validation: ensure break point still fits within budget
    // (searching backward should always be safe, but validate for robustness)
    if (estimateTokens(text.slice(0, breakPoint), config).tokens > effectiveBudget) {
        breakPoint = low;
    }

    return text.slice(0, breakPoint) + suffix;
}
