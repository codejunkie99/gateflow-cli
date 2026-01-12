/**
 * GateFlow Rate Limiter
 * Prevents API rate limit errors with proactive throttling
 */

import { RateLimitError } from '../error/classes.js';
import { Semaphore } from '../concurrency/mutex.js';

// ============================================================================
// Rate Limit Configuration
// ============================================================================

export interface RateLimitConfig {
    /** Requests per minute */
    requestsPerMinute: number;
    /** Tokens per minute (estimated) */
    tokensPerMinute: number;
    /** Maximum concurrent requests */
    concurrentRequests: number;
}

export interface RateLimiterStats {
    requestsInWindow: number;
    tokensInWindow: number;
    activeRequests: number;
    windowStartTime: number;
    isLimited: boolean;
    waitTimeMs: number;
}

// ============================================================================
// Model Rate Limits
// ============================================================================

/**
 * Known rate limits by model
 * These are conservative estimates - actual limits may vary
 */
export const MODEL_RATE_LIMITS: Record<string, RateLimitConfig> = {
    'claude-sonnet-4-20250514': {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        concurrentRequests: 5,
    },
    'claude-sonnet-4': {
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
        concurrentRequests: 5,
    },
    'claude-haiku-3.5-sonnet-20241022': {
        requestsPerMinute: 100,
        tokensPerMinute: 200000,
        concurrentRequests: 10,
    },
    'claude-haiku-3.5': {
        requestsPerMinute: 100,
        tokensPerMinute: 200000,
        concurrentRequests: 10,
    },
    // Default for unknown models
    default: {
        requestsPerMinute: 50,
        tokensPerMinute: 80000,
        concurrentRequests: 5,
    },
};

// ============================================================================
// Rate Limiter Implementation
// ============================================================================

export class RateLimiter {
    private requestTimestamps: number[] = [];
    private tokenCounts: Array<{ timestamp: number; tokens: number }> = [];
    private concurrencySemaphore: Semaphore;
    private config: RateLimitConfig;
    private windowMs: number = 60000; // 1 minute window

    constructor(config: RateLimitConfig) {
        this.config = config;
        this.concurrencySemaphore = new Semaphore(config.concurrentRequests);
    }

    /**
     * Acquire permission to make a request
     * @param estimatedTokens Estimated tokens for this request
     * @throws RateLimitError if rate limited
     */
    async acquire(estimatedTokens: number = 0): Promise<void> {
        // Clean up old entries
        this.cleanup();

        // Check rate limits
        const waitTime = this.calculateWaitTime(estimatedTokens);
        if (waitTime > 0) {
            // Wait if needed
            await this.sleep(waitTime);
            this.cleanup(); // Clean up again after waiting
        }

        // Check again after potential wait
        if (this.isLimited(estimatedTokens)) {
            throw new RateLimitError(
                'Rate limit would be exceeded',
                this.calculateWaitTime(estimatedTokens)
            );
        }

        // Acquire concurrency permit
        await this.concurrencySemaphore.acquire();

        // Record this request
        const now = Date.now();
        this.requestTimestamps.push(now);
        if (estimatedTokens > 0) {
            this.tokenCounts.push({ timestamp: now, tokens: estimatedTokens });
        }
    }

    /**
     * Release concurrency permit after request completes
     */
    release(): void {
        this.concurrencySemaphore.release();
    }

    /**
     * Execute a request with rate limiting
     */
    async withRateLimit<T>(
        operation: () => Promise<T>,
        estimatedTokens: number = 0
    ): Promise<T> {
        await this.acquire(estimatedTokens);
        try {
            return await operation();
        } finally {
            this.release();
        }
    }

    /**
     * Check if currently rate limited
     */
    isLimited(estimatedTokens: number = 0): boolean {
        this.cleanup();

        const requestsInWindow = this.requestTimestamps.length;
        const tokensInWindow = this.getTokensInWindow();

        return (
            requestsInWindow >= this.config.requestsPerMinute ||
            tokensInWindow + estimatedTokens > this.config.tokensPerMinute
        );
    }

    /**
     * Calculate wait time until rate limit clears
     */
    calculateWaitTime(estimatedTokens: number = 0): number {
        this.cleanup();

        const now = Date.now();
        const windowStart = now - this.windowMs;

        // Check requests per minute
        if (this.requestTimestamps.length >= this.config.requestsPerMinute) {
            const oldestRequest = this.requestTimestamps[0];
            const waitForRequests = oldestRequest + this.windowMs - now;
            if (waitForRequests > 0) {
                return waitForRequests;
            }
        }

        // Check tokens per minute
        const tokensInWindow = this.getTokensInWindow();
        if (tokensInWindow + estimatedTokens > this.config.tokensPerMinute) {
            // Find the oldest token entry to wait for
            const oldestToken = this.tokenCounts.find(t => t.timestamp >= windowStart);
            if (oldestToken) {
                const waitForTokens = oldestToken.timestamp + this.windowMs - now;
                if (waitForTokens > 0) {
                    return waitForTokens;
                }
            }
        }

        return 0;
    }

    /**
     * Get wait time (alias for calculateWaitTime)
     */
    getWaitTime(): number {
        return this.calculateWaitTime();
    }

    /**
     * Get current statistics
     */
    getStats(): RateLimiterStats {
        this.cleanup();

        return {
            requestsInWindow: this.requestTimestamps.length,
            tokensInWindow: this.getTokensInWindow(),
            activeRequests: this.config.concurrentRequests - this.concurrencySemaphore.availablePermits(),
            windowStartTime: Date.now() - this.windowMs,
            isLimited: this.isLimited(),
            waitTimeMs: this.calculateWaitTime(),
        };
    }

    /**
     * Reset the rate limiter
     */
    reset(): void {
        this.requestTimestamps = [];
        this.tokenCounts = [];
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<RateLimitConfig>): void {
        this.config = { ...this.config, ...config };
        if (config.concurrentRequests !== undefined) {
            this.concurrencySemaphore = new Semaphore(config.concurrentRequests);
        }
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private cleanup(): void {
        const windowStart = Date.now() - this.windowMs;
        this.requestTimestamps = this.requestTimestamps.filter(t => t >= windowStart);
        this.tokenCounts = this.tokenCounts.filter(t => t.timestamp >= windowStart);
    }

    private getTokensInWindow(): number {
        return this.tokenCounts.reduce((sum, t) => sum + t.tokens, 0);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// Rate Limiter Factory
// ============================================================================

/**
 * Create a rate limiter for a specific model
 */
export function createRateLimiter(model: string): RateLimiter {
    const config = MODEL_RATE_LIMITS[model] ?? MODEL_RATE_LIMITS.default;
    return new RateLimiter(config);
}

/**
 * Get rate limit config for a model
 */
export function getModelRateLimits(model: string): RateLimitConfig {
    return MODEL_RATE_LIMITS[model] ?? MODEL_RATE_LIMITS.default;
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count from text (rough approximation)
 * Uses ~4 characters per token as a rough estimate for Claude
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a message array
 */
export function estimateMessageTokens(messages: Array<{ content: string }>): number {
    return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
}

// ============================================================================
// Global Rate Limiter Instance
// ============================================================================

let globalRateLimiter: RateLimiter | null = null;

/**
 * Get the global rate limiter (creates with default config if not exists)
 */
export function getGlobalRateLimiter(): RateLimiter {
    if (!globalRateLimiter) {
        globalRateLimiter = new RateLimiter(MODEL_RATE_LIMITS.default);
    }
    return globalRateLimiter;
}

/**
 * Set the global rate limiter
 */
export function setGlobalRateLimiter(limiter: RateLimiter): void {
    globalRateLimiter = limiter;
}

/**
 * Reset the global rate limiter
 */
export function resetGlobalRateLimiter(): void {
    if (globalRateLimiter) {
        globalRateLimiter.reset();
    }
}
