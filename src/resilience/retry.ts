/**
 * GateFlow Retry Logic
 * Retry with exponential backoff and jitter
 */

import { GateFlowError, isRetryableError } from '../error/types.js';
import { RetryableError, RateLimitError, classifyError } from '../error/classes.js';

// ============================================================================
// Retry Policy Types
// ============================================================================

export interface RetryPolicy {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    jitter: boolean;
    retryOn: (error: unknown) => boolean;
}

export interface RetryContext {
    attempt: number;
    totalAttempts: number;
    lastError?: Error;
    startTime: number;
    correlationId?: string;
}

export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: Error;
    attempts: number;
    totalDurationMs: number;
}

// ============================================================================
// Default Retry Policies
// ============================================================================

/**
 * Pre-configured retry policies for different operation types
 */
export const RETRY_POLICIES: Record<string, RetryPolicy> = {
    api: {
        maxAttempts: 3,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitter: true,
        retryOn: (error) => classifyError(error) === 'retryable',
    },
    file: {
        maxAttempts: 2,
        initialDelay: 500,
        maxDelay: 2000,
        backoffMultiplier: 1.5,
        jitter: false,
        retryOn: (error) => {
            if (error instanceof Error) {
                const msg = error.message.toLowerCase();
                return msg.includes('busy') || msg.includes('locked') || msg.includes('ebusy');
            }
            return false;
        },
    },
    network: {
        maxAttempts: 3,
        initialDelay: 2000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        jitter: true,
        retryOn: (error) => {
            if (error instanceof Error) {
                const msg = error.message.toLowerCase();
                return msg.includes('network') || msg.includes('connection') || msg.includes('timeout');
            }
            return false;
        },
    },
    none: {
        maxAttempts: 1,
        initialDelay: 0,
        maxDelay: 0,
        backoffMultiplier: 1,
        jitter: false,
        retryOn: () => false,
    },
};

// ============================================================================
// Backoff Calculation
// ============================================================================

/**
 * Calculate delay for exponential backoff
 */
export function calculateBackoff(
    attempt: number,
    policy: RetryPolicy
): number {
    // Exponential backoff: initialDelay * (multiplier ^ attempt)
    let delay = policy.initialDelay * Math.pow(policy.backoffMultiplier, attempt - 1);

    // Cap at maxDelay
    delay = Math.min(delay, policy.maxDelay);

    // Add jitter if enabled (0-50% of delay)
    if (policy.jitter) {
        const jitter = delay * 0.5 * Math.random();
        delay += jitter;
    }

    return Math.floor(delay);
}

/**
 * Parse Retry-After header value from an HTTP-date or seconds format
 * HTTP-date format: "Wed, 21 Oct 2015 07:28:00 GMT"
 * Seconds format: "120"
 * Returns milliseconds or undefined if parsing fails
 */
function parseRetryAfterValue(value: string | number | undefined): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    // If it's already a number, treat as seconds
    if (typeof value === 'number') {
        return value > 0 ? value * 1000 : undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    // Try to parse as numeric seconds first (accept leading zeros)
    if (/^\d+$/.test(trimmed)) {
        const numericValue = Number(trimmed);
        return numericValue > 0 ? numericValue * 1000 : undefined;
    }

    // Try to parse as HTTP-date
    const dateValue = Date.parse(trimmed);
    if (!isNaN(dateValue)) {
        const delayMs = dateValue - Date.now();
        return delayMs > 0 ? delayMs : undefined;
    }

    return undefined;
}

/**
 * Extract headers from an error object
 * Handles various SDK error formats (Anthropic, OpenRouter, etc.)
 */
function extractHeadersFromError(error: unknown): Record<string, string | number | undefined> | undefined {
    if (!error || typeof error !== 'object') {
        return undefined;
    }

    const errorObj = error as Record<string, unknown>;

    // Check for direct headers property (common in SDK errors)
    if (errorObj.headers && typeof errorObj.headers === 'object') {
        return errorObj.headers as Record<string, string | number | undefined>;
    }

    // Check for response.headers (fetch-style errors)
    if (errorObj.response && typeof errorObj.response === 'object') {
        const response = errorObj.response as Record<string, unknown>;
        if (response.headers && typeof response.headers === 'object') {
            // Handle Headers object (from fetch)
            const headers = response.headers;
            if (typeof (headers as Headers).get === 'function') {
                const retryAfter = (headers as Headers).get('retry-after');
                if (retryAfter) {
                    return { 'retry-after': retryAfter };
                }
            }
            return headers as Record<string, string | number | undefined>;
        }
    }

    // Check for error.error.headers (nested error format)
    if (errorObj.error && typeof errorObj.error === 'object') {
        const innerError = errorObj.error as Record<string, unknown>;
        if (innerError.headers && typeof innerError.headers === 'object') {
            return innerError.headers as Record<string, string | number | undefined>;
        }
    }

    return undefined;
}

/**
 * Parse Retry-After from raw API error responses
 * Checks retryAfter fields and Retry-After headers (seconds or HTTP-date)
 * Uses milliseconds for internal error types (RateLimitError/RetryableError)
 * Returns delay in milliseconds or undefined if not found
 */
export function parseRetryAfterFromError(error: unknown): number | undefined {
    if (!error) {
        return undefined;
    }

    if (error instanceof RetryableError && error.options?.retryAfter && error.options.retryAfter > 0) {
        return error.options.retryAfter;
    }

    if (error instanceof RateLimitError && error.retryAfter !== undefined && error.retryAfter > 0) {
        return error.retryAfter;
    }

    const errorObj = error as Record<string, unknown>;

    // Check for direct retryAfter property on error (some SDKs add this)
    const directRetryAfter = errorObj.retryAfter ?? errorObj.retry_after;
    const parsedDirect = parseRetryAfterValue(directRetryAfter as string | number | undefined);
    if (parsedDirect !== undefined) {
        return parsedDirect;
    }

    // Extract and check headers
    const headers = extractHeadersFromError(error);
    if (headers) {
        // Check various header name formats (case-insensitive matching)
        const retryAfterValue =
            headers['retry-after'] ??
            headers['Retry-After'] ??
            headers['RETRY-AFTER'] ??
            headers['x-retry-after'] ??
            headers['X-Retry-After'];

        if (retryAfterValue !== undefined) {
            return parseRetryAfterValue(retryAfterValue as string | number);
        }
    }

    return undefined;
}

/**
 * Apply jitter to a delay value
 * Adds 0-10% random jitter to help prevent thundering herd
 */
function applyJitter(delay: number, enabled: boolean): number {
    if (!enabled) {
        return delay;
    }
    // Add small jitter (0-10%) to Retry-After values to prevent thundering herd
    const jitter = delay * 0.1 * Math.random();
    return Math.floor(delay + jitter);
}

/**
 * Get retry delay from error if present, falling back to exponential backoff
 * Checks RetryableError, RateLimitError, and raw API error headers for Retry-After
 */
export function getRetryDelayFromError(error: unknown, policy: RetryPolicy, attempt: number): number {
    // Check RetryableError.options.retryAfter
    if (error instanceof RetryableError && error.options?.retryAfter) {
        return applyJitter(error.options.retryAfter, policy.jitter);
    }

    // Check RateLimitError.retryAfter
    if (error instanceof RateLimitError && error.retryAfter !== undefined && error.retryAfter > 0) {
        // RateLimitError.retryAfter is already in milliseconds (from getWaitTime())
        return applyJitter(error.retryAfter, policy.jitter);
    }

    // Try to parse Retry-After from raw API error
    const parsedRetryAfter = parseRetryAfterFromError(error);
    if (parsedRetryAfter !== undefined) {
        return applyJitter(parsedRetryAfter, policy.jitter);
    }

    // Fall back to exponential backoff calculation
    return calculateBackoff(attempt, policy);
}

// ============================================================================
// Retry Functions
// ============================================================================

/**
 * Execute an operation with retry logic
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy,
    callbacks?: {
        onRetry?: (context: RetryContext) => void;
        onSuccess?: (result: T, context: RetryContext) => void;
        onFailure?: (error: Error, context: RetryContext) => void;
    }
): Promise<T> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
        const context: RetryContext = {
            attempt,
            totalAttempts: policy.maxAttempts,
            lastError,
            startTime,
        };

        try {
            const result = await operation();
            callbacks?.onSuccess?.(result, context);
            return result;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            context.lastError = lastError;

            // Check if we should retry
            const shouldRetry = attempt < policy.maxAttempts && policy.retryOn(error);

            if (shouldRetry) {
                callbacks?.onRetry?.(context);
                const delay = getRetryDelayFromError(error, policy, attempt);
                await sleep(delay);
            } else {
                callbacks?.onFailure?.(lastError, context);
                throw lastError;
            }
        }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError ?? new Error('Retry failed');
}

/**
 * Execute an operation with retry and return detailed result
 */
export async function withRetryResult<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy
): Promise<RetryResult<T>> {
    const startTime = Date.now();
    let attempts = 0;

    try {
        const result = await withRetry(operation, policy, {
            onRetry: () => { attempts++; },
        });
        return {
            success: true,
            result,
            attempts: attempts + 1,
            totalDurationMs: Date.now() - startTime,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
            attempts: attempts + 1,
            totalDurationMs: Date.now() - startTime,
        };
    }
}

// ============================================================================
// Retry Policy Builder
// ============================================================================

export class RetryPolicyBuilder {
    private policy: RetryPolicy = { ...RETRY_POLICIES.api };

    /**
     * Set maximum retry attempts
     */
    maxAttempts(n: number): this {
        this.policy.maxAttempts = n;
        return this;
    }

    /**
     * Set initial delay in milliseconds
     */
    initialDelay(ms: number): this {
        this.policy.initialDelay = ms;
        return this;
    }

    /**
     * Set maximum delay in milliseconds
     */
    maxDelay(ms: number): this {
        this.policy.maxDelay = ms;
        return this;
    }

    /**
     * Set backoff multiplier
     */
    backoffMultiplier(multiplier: number): this {
        this.policy.backoffMultiplier = multiplier;
        return this;
    }

    /**
     * Enable or disable jitter
     */
    jitter(enabled: boolean): this {
        this.policy.jitter = enabled;
        return this;
    }

    /**
     * Set retry predicate
     */
    retryOn(predicate: (error: unknown) => boolean): this {
        this.policy.retryOn = predicate;
        return this;
    }

    /**
     * Only retry on specific error types
     */
    retryOnErrors(errorTypes: Array<new (...args: any[]) => Error>): this {
        this.policy.retryOn = (error) =>
            errorTypes.some((ErrorType) => error instanceof ErrorType);
        return this;
    }

    /**
     * Build the policy
     */
    build(): RetryPolicy {
        return { ...this.policy };
    }

    /**
     * Start with a preset policy
     */
    static from(preset: keyof typeof RETRY_POLICIES): RetryPolicyBuilder {
        const builder = new RetryPolicyBuilder();
        builder.policy = { ...RETRY_POLICIES[preset] };
        return builder;
    }
}

// ============================================================================
// Decorator-style Retry Wrapper
// ============================================================================

/**
 * Create a retryable version of a function
 */
export function retryable<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    policy: RetryPolicy
): (...args: TArgs) => Promise<TResult> {
    return (...args: TArgs) => withRetry(() => fn(...args), policy);
}

/**
 * Retry decorator factory for class methods
 */
export function Retry(policy: RetryPolicy) {
    return function <T extends (...args: any[]) => Promise<any>>(
        _target: object,
        _propertyKey: string,
        descriptor: TypedPropertyDescriptor<T>
    ): TypedPropertyDescriptor<T> {
        const originalMethod = descriptor.value!;

        descriptor.value = (function (this: any, ...args: Parameters<T>): ReturnType<T> {
            return withRetry(() => originalMethod.apply(this, args), policy) as ReturnType<T>;
        } as unknown) as T;

        return descriptor;
    };
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
