/**
 * GateFlow Retry Logic
 * Retry with exponential backoff and jitter
 */

import { GateFlowError, isRetryableError } from '../error/types.js';
import { RetryableError, classifyError } from '../error/classes.js';

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
 * Get retry delay from a RetryableError if present
 */
export function getRetryDelayFromError(error: unknown, policy: RetryPolicy, attempt: number): number {
    if (error instanceof RetryableError && error.options?.retryAfter) {
        return error.options.retryAfter;
    }
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
