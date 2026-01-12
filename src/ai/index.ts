/**
 * GateFlow AI Module
 * AI API resilience and management
 */

// Rate Limiter
export {
    type RateLimitConfig,
    type RateLimiterStats,
    MODEL_RATE_LIMITS,
    RateLimiter,
    createRateLimiter,
    getModelRateLimits,
    estimateTokens,
    estimateMessageTokens,
    getGlobalRateLimiter,
    setGlobalRateLimiter,
    resetGlobalRateLimiter,
} from './rate-limiter.js';

// Fallback
export {
    type FallbackChain,
    type FallbackConditions,
    type FallbackAttempt,
    type FallbackStats,
    DEFAULT_FALLBACK_CHAIN,
    AGGRESSIVE_FALLBACK_CHAIN,
    FallbackManager,
    withFallback,
    createFallbackManager,
    getGlobalFallbackManager,
    setGlobalFallbackManager,
    resetGlobalFallbackManager,
} from './fallback.js';
