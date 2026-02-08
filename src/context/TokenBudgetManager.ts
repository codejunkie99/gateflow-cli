/**
 * TokenBudgetManager
 *
 * Accurate token counting and budget allocation for context window management.
 * Implements budget tracking across sections: system, history, tools, reserve.
 *
 * Uses @anthropic-ai/tokenizer when available, falls back to char/4 estimate.
 */

import type { EventBus } from '../events/bus.js';
import { estimateTokensSimple } from '../memory/token-estimator.js';

// ============================================================================
// Types
// ============================================================================

export interface TokenBudget {
    /** Total context window size for the model */
    contextWindow: number;
    /** Budget allocation by section */
    allocation: BudgetAllocation;
    /** Current usage by section */
    usage: BudgetUsage;
}

export interface BudgetAllocation {
    /** System prompt allocation (default 20%) */
    system: number;
    /** Conversation history allocation (default 40%) */
    history: number;
    /** Tool definitions and outputs allocation (default 20%) */
    tools: number;
    /** Response reserve allocation (default 20%) */
    reserve: number;
}

export interface BudgetUsage {
    system: number;
    history: number;
    tools: number;
    /** Cumulative tokens this session */
    cumulative: number;
    /** Tokens in current turn */
    currentTurn: number;
}

/**
 * Sections that track usage (excludes reserve which is only in allocation)
 */
export type UsageSection = 'system' | 'history' | 'tools';

export interface TokenCountResult {
    /** Token count */
    tokens: number;
    /** Whether accurate tokenizer was used */
    accurate: boolean;
    /** Processing time in ms */
    timeTaken: number;
}

export interface BudgetWarning {
    section: keyof BudgetAllocation;
    used: number;
    limit: number;
    severity: 'info' | 'warning' | 'critical';
    message: string;
}

export interface ModelConfig {
    name: string;
    contextWindow: number;
    /** Default allocations for this model */
    defaultAllocation?: Partial<BudgetAllocation>;
}

export interface TokenBudgetConfig {
    model?: string;
    customAllocation?: Partial<BudgetAllocation>;
}

// ============================================================================
// Model Context Window Configurations
// ============================================================================

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
    'claude-sonnet-4-20250514': { name: 'Claude Sonnet 4', contextWindow: 200000 },
    'claude-sonnet-4': { name: 'Claude Sonnet 4', contextWindow: 200000 },
    'claude-haiku-3.5': { name: 'Claude Haiku 3.5', contextWindow: 200000 },
    'claude-opus-4': { name: 'Claude Opus 4', contextWindow: 200000 },
    'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
    // Default fallback
    'default': { name: 'Default', contextWindow: 128000 }
};

// Default allocation percentages
const DEFAULT_ALLOCATION_PERCENTAGES = {
    system: 0.20,   // 20%
    history: 0.40,  // 40%
    tools: 0.20,    // 20%
    reserve: 0.20,  // 20%
};

// ============================================================================
// Tokenizer Interface
// ============================================================================

interface Tokenizer {
    countTokens(text: string): number;
}

// Lazy-loaded tokenizer instance
let tokenizerInstance: Tokenizer | null = null;
let tokenizerLoadAttempted = false;

/**
 * Attempt to load @anthropic-ai/tokenizer
 * Falls back to char/4 estimate if unavailable
 */
async function loadTokenizer(): Promise<Tokenizer | null> {
    if (tokenizerLoadAttempted) {
        return tokenizerInstance;
    }

    tokenizerLoadAttempted = true;

    try {
        // Dynamic import to avoid hard dependency
        // @ts-expect-error - Optional dependency, may not be installed
        const module = await import('@anthropic-ai/tokenizer');
        tokenizerInstance = {
            countTokens: (text: string) => module.countTokens(text)
        };
        return tokenizerInstance;
    } catch {
        // Tokenizer not installed, use fallback
        return null;
    }
}


// ============================================================================
// TokenBudgetManager Implementation
// ============================================================================

export class TokenBudgetManager {
    private bus: EventBus | null;
    private modelConfig: ModelConfig;
    private allocation: BudgetAllocation;
    private usage: BudgetUsage;
    private tokenizer: Tokenizer | null = null;
    private tokenizerLoaded = false;

    // Token count cache for repeated strings (system prompts, tool defs)
    private tokenCache: Map<string, number> = new Map();
    private cacheMaxSize = 100;

    constructor(bus: EventBus | null = null, config: TokenBudgetConfig = {}) {
        this.bus = bus;

        // Get model config
        const modelName = config.model ?? 'default';
        this.modelConfig = MODEL_CONFIGS[modelName] ?? MODEL_CONFIGS.default;

        // Calculate allocation based on context window
        const contextWindow = this.modelConfig.contextWindow;
        this.allocation = {
            system: Math.floor(contextWindow * (config.customAllocation?.system ?? DEFAULT_ALLOCATION_PERCENTAGES.system)),
            history: Math.floor(contextWindow * (config.customAllocation?.history ?? DEFAULT_ALLOCATION_PERCENTAGES.history)),
            tools: Math.floor(contextWindow * (config.customAllocation?.tools ?? DEFAULT_ALLOCATION_PERCENTAGES.tools)),
            reserve: Math.floor(contextWindow * (config.customAllocation?.reserve ?? DEFAULT_ALLOCATION_PERCENTAGES.reserve)),
        };

        // Initialize usage
        this.usage = {
            system: 0,
            history: 0,
            tools: 0,
            cumulative: 0,
            currentTurn: 0,
        };
    }

    // ========================================================================
    // Token Counting
    // ========================================================================

    /**
     * Count tokens in text
     * Uses @anthropic-ai/tokenizer if available, falls back to char/4
     */
    countTokens(text: string): TokenCountResult {
        const startTime = performance.now();

        // Check cache first
        const cached = this.tokenCache.get(text);
        if (cached !== undefined) {
            return {
                tokens: cached,
                accurate: this.tokenizer !== null,
                timeTaken: performance.now() - startTime
            };
        }

        let tokens: number;
        let accurate: boolean;

        if (this.tokenizer) {
            tokens = this.tokenizer.countTokens(text);
            accurate = true;
        } else {
            tokens = estimateTokensSimple(text);
            accurate = false;
        }

        // Cache the result (LRU eviction)
        if (this.tokenCache.size >= this.cacheMaxSize) {
            const firstKey = this.tokenCache.keys().next().value;
            if (firstKey) {
                this.tokenCache.delete(firstKey);
            }
        }
        this.tokenCache.set(text, tokens);

        return {
            tokens,
            accurate,
            timeTaken: performance.now() - startTime
        };
    }

    /**
     * Count tokens in a message array (AI SDK format)
     */
    countMessageTokens(messages: Array<{ role: string; content: string | unknown[] }>): TokenCountResult {
        const startTime = performance.now();
        let totalTokens = 0;

        for (const msg of messages) {
            // Handle string content
            if (typeof msg.content === 'string') {
                totalTokens += this.countTokens(msg.content).tokens;
            }
            // Handle array content (multi-part messages)
            else if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (typeof part === 'object' && part !== null) {
                        const p = part as Record<string, unknown>;
                        if (p.type === 'text' && typeof p.text === 'string') {
                            totalTokens += this.countTokens(p.text).tokens;
                        } else if (p.type === 'tool-call' || p.type === 'tool-result') {
                            // Estimate tool content
                            totalTokens += this.countTokens(JSON.stringify(p)).tokens;
                        }
                    }
                }
            }

            // Add overhead for role markers (~4 tokens per message)
            totalTokens += 4;
        }

        return {
            tokens: totalTokens,
            accurate: this.tokenizer !== null,
            timeTaken: performance.now() - startTime
        };
    }

    /**
     * Count tokens for tool definitions
     */
    countToolTokens(tools: Record<string, unknown>): TokenCountResult {
        const toolsJson = JSON.stringify(tools);
        return this.countTokens(toolsJson);
    }

    // ========================================================================
    // Budget Management
    // ========================================================================

    /**
     * Get current budget state
     */
    getBudget(): TokenBudget {
        return {
            contextWindow: this.modelConfig.contextWindow,
            allocation: { ...this.allocation },
            usage: { ...this.usage }
        };
    }

    /**
     * Record usage for a section
     */
    recordUsage(section: UsageSection, tokens: number): void {
        this.usage[section] = tokens;
        this.usage.cumulative += tokens;

        // Check for warnings
        this.checkAndEmitWarnings(section);
    }

    /**
     * Record a full turn's usage
     */
    recordTurn(input: number, output: number): void {
        this.usage.currentTurn = input + output;
        this.usage.cumulative += input + output;
    }

    /**
     * Check if section is within budget
     */
    isWithinBudget(section: UsageSection): boolean {
        return this.usage[section] <= this.allocation[section];
    }

    /**
     * Get available tokens for a section
     */
    getAvailable(section: UsageSection): number {
        return Math.max(0, this.allocation[section] - this.usage[section]);
    }

    /**
     * Get total available tokens (all sections minus reserve)
     */
    getTotalAvailable(): number {
        const used = this.usage.system + this.usage.history + this.usage.tools;
        const available = this.modelConfig.contextWindow - this.allocation.reserve;
        return Math.max(0, available - used);
    }

    /**
     * Check if compaction is needed
     * Returns true when history usage exceeds 80% of allocation
     */
    needsCompaction(): boolean {
        const historyUsage = this.usage.history / this.allocation.history;
        return historyUsage > 0.8;
    }

    /**
     * Get warnings for current state
     */
    getWarnings(): BudgetWarning[] {
        const warnings: BudgetWarning[] = [];

        const sections: UsageSection[] = ['system', 'history', 'tools'];

        for (const section of sections) {
            const used = this.usage[section];
            const limit = this.allocation[section];
            const ratio = used / limit;

            if (ratio >= 0.95) {
                warnings.push({
                    section,
                    used,
                    limit,
                    severity: 'critical',
                    message: `${section} budget at ${Math.round(ratio * 100)}% (${used}/${limit} tokens)`
                });
            } else if (ratio >= 0.8) {
                warnings.push({
                    section,
                    used,
                    limit,
                    severity: 'warning',
                    message: `${section} budget at ${Math.round(ratio * 100)}% (${used}/${limit} tokens)`
                });
            } else if (ratio >= 0.6) {
                warnings.push({
                    section,
                    used,
                    limit,
                    severity: 'info',
                    message: `${section} budget at ${Math.round(ratio * 100)}%`
                });
            }
        }

        return warnings;
    }

    // ========================================================================
    // Model Configuration
    // ========================================================================

    /**
     * Switch to a different model (adjusts context window)
     */
    setModel(model: string): void {
        this.modelConfig = MODEL_CONFIGS[model] ?? MODEL_CONFIGS.default;

        // Recalculate allocations
        const contextWindow = this.modelConfig.contextWindow;
        this.allocation = {
            system: Math.floor(contextWindow * DEFAULT_ALLOCATION_PERCENTAGES.system),
            history: Math.floor(contextWindow * DEFAULT_ALLOCATION_PERCENTAGES.history),
            tools: Math.floor(contextWindow * DEFAULT_ALLOCATION_PERCENTAGES.tools),
            reserve: Math.floor(contextWindow * DEFAULT_ALLOCATION_PERCENTAGES.reserve),
        };
    }

    /**
     * Update budget allocation
     */
    setAllocation(allocation: Partial<BudgetAllocation>): void {
        this.allocation = { ...this.allocation, ...allocation };
    }

    /**
     * Reset usage counters (new session)
     */
    reset(): void {
        this.usage = {
            system: 0,
            history: 0,
            tools: 0,
            cumulative: 0,
            currentTurn: 0,
        };
    }

    /**
     * Clear token cache
     */
    clearCache(): void {
        this.tokenCache.clear();
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    /**
     * Initialize tokenizer (call once at startup)
     */
    async initialize(): Promise<boolean> {
        if (this.tokenizerLoaded) {
            return this.tokenizer !== null;
        }

        this.tokenizer = await loadTokenizer();
        this.tokenizerLoaded = true;

        return this.tokenizer !== null;
    }

    /**
     * Check if accurate tokenizer is available
     */
    hasAccurateTokenizer(): boolean {
        return this.tokenizer !== null;
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private checkAndEmitWarnings(section: UsageSection): void {
        if (!this.bus) return;

        const used = this.usage[section];
        const limit = this.allocation[section];
        const ratio = used / limit;

        let severity: 'info' | 'warning' | 'critical' | null = null;

        if (ratio >= 0.95) {
            severity = 'critical';
        } else if (ratio >= 0.8) {
            severity = 'warning';
        }

        if (severity) {
            this.bus.emit({
                type: 'status',
                phase: 'thinking',
                label: `Context ${section}: ${Math.round(ratio * 100)}% used`
            });
        }
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalTokenBudgetManager: TokenBudgetManager | null = null;

/**
 * Get the global TokenBudgetManager instance
 */
export function getTokenBudgetManager(): TokenBudgetManager {
    if (!globalTokenBudgetManager) {
        globalTokenBudgetManager = new TokenBudgetManager();
    }
    return globalTokenBudgetManager;
}

/**
 * Create a new TokenBudgetManager for a specific model
 */
export function createTokenBudgetManager(
    bus: EventBus | null,
    config?: TokenBudgetConfig
): TokenBudgetManager {
    return new TokenBudgetManager(bus, config);
}

/**
 * Set the global TokenBudgetManager instance
 */
export function setGlobalTokenBudgetManager(manager: TokenBudgetManager): void {
    globalTokenBudgetManager = manager;
}
