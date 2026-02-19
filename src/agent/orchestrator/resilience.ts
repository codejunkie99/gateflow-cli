/**
 * Agent resilience layer
 * Circuit breaker + retry + timeout for multi-agent execution
 */

import { withAbortableTimeout } from '../../resilience/timeout.js';
import {
    RetryPolicyBuilder,
    getRetryDelayFromError,
    parseRetryAfterFromError,
    withRetry,
} from '../../resilience/retry.js';
import { CircuitBreaker, CircuitOpenError } from '../../resilience/circuit-breaker.js';
import type { EventBus } from '../../events/index.js';
import { metrics } from '../../observability/metrics.js';

export interface AgentResilienceConfig {
    agentTimeout: number;
    maxRetries: number;
    initialRetryDelay: number;
    maxRetryDelay: number;
}

const DEFAULT_AGENT_RESILIENCE: AgentResilienceConfig = {
    agentTimeout: 120000,
    maxRetries: 3,
    initialRetryDelay: 2000,
    maxRetryDelay: 30000,
};

const AGENT_TIMEOUTS: Record<string, number> = {
    understanding: 90000,
    codegen: 120000,
    testbench: 120000,
    debug: 150000,
    refactoring: 120000,
};

type AgentErrorType = 'transient' | 'permanent' | 'timeout' | 'circuit_open' | 'rate_limited';

interface AgentErrorClassification {
    type: AgentErrorType;
    retryAfterMs?: number;
}

/**
 * Classify an agent error with full details including retry-after
 */
function classifyAgentErrorWithRetryAfter(error: unknown): AgentErrorClassification {
    if (error instanceof CircuitOpenError) {
        return { type: 'circuit_open' };
    }

    // Check for rate limit errors with Retry-After
    const retryAfterMs = parseRetryAfterFromError(error);

    if (error instanceof Error) {
        if (error.name === 'AbortError') {
            return { type: 'permanent' };
        }

        const msg = error.message.toLowerCase();

        if (msg.includes('timeout') || msg.includes('timed out')) {
            return { type: 'timeout', retryAfterMs };
        }

        // Detect rate limit errors explicitly
        if (
            msg.includes('rate limit') ||
            msg.includes('429') ||
            msg.includes('overloaded') ||
            msg.includes('529')
        ) {
            return { type: 'rate_limited', retryAfterMs };
        }

        // Other transient errors (connection, network issues)
        if (
            msg.includes('connection') ||
            msg.includes('network') ||
            msg.includes('econnreset') ||
            msg.includes('socket')
        ) {
            return { type: 'transient', retryAfterMs };
        }

        if (
            msg.includes('invalid') ||
            msg.includes('authentication') ||
            msg.includes('unauthorized') ||
            msg.includes('permission') ||
            msg.includes('forbidden') ||
            msg.includes('not found') ||
            msg.includes('user denied')
        ) {
            return { type: 'permanent' };
        }
    }

    // Check if error has status code indicating rate limit
    // Guard against null/undefined errors before property access
    if (error != null && typeof error === 'object') {
        const errorObj = error as Record<string, unknown>;
        if (errorObj.status === 429 || errorObj.statusCode === 429) {
            return { type: 'rate_limited', retryAfterMs };
        }
    }

    return { type: 'transient', retryAfterMs };
}

function isRetryableAgentError(error: unknown): boolean {
    const { type } = classifyAgentErrorWithRetryAfter(error);
    return type === 'transient' || type === 'timeout' || type === 'rate_limited';
}

export class AgentResilienceLayer {
    private circuitBreakers: Map<string, CircuitBreaker> = new Map();
    private rateLimitedUntil: Map<string, number> = new Map(); // model → timestamp
    private config: AgentResilienceConfig;

    constructor(
        private bus: EventBus,
        config?: Partial<AgentResilienceConfig>
    ) {
        this.config = { ...DEFAULT_AGENT_RESILIENCE, ...config };
    }

    /**
     * Check if a model is currently rate limited and wait if necessary.
     * Returns the wait time in ms (0 if not rate limited).
     */
    private async waitForRateLimit(modelId: string, timeoutMs: number, abortSignal?: AbortSignal): Promise<number> {
        const until = this.rateLimitedUntil.get(modelId);
        if (!until) return 0;

        const waitTime = until - Date.now();
        if (waitTime <= 0) {
            // Only delete if value hasn't been updated by another agent
            if (this.rateLimitedUntil.get(modelId) === until) {
                this.rateLimitedUntil.delete(modelId);
            }
            return 0;
        }

        // Check if already aborted
        if (abortSignal?.aborted) return waitTime;

        this.bus.emit({
            type: 'status',
            phase: 'thinking',
            label: `Model ${modelId} rate limited, waiting ${Math.ceil(waitTime / 1000)}s...`,
        });

        // Wait with abort support, respecting agent timeout
        try {
            await withAbortableTimeout(
                (signal) => new Promise<void>(resolve => {
                    const timeout = setTimeout(() => {
                        signal.removeEventListener('abort', onAbort);
                        resolve();
                    }, waitTime);
                    const onAbort = () => {
                        clearTimeout(timeout);
                        resolve();
                    };
                    signal.addEventListener('abort', onAbort, { once: true });
                }),
                timeoutMs,
                `rate_limit_wait_${modelId}`,
                abortSignal
            );

            // Only delete if value hasn't been updated by another agent during wait
            if (this.rateLimitedUntil.get(modelId) === until) {
                this.rateLimitedUntil.delete(modelId);
            }
        } catch (err) {
            throw err;
        }
        return waitTime;
    }

    /**
     * Record a rate limit for a model so other agents can respect it.
     */
    private recordRateLimit(modelId: string, retryAfterMs: number): void {
        const until = Date.now() + retryAfterMs;
        const existing = this.rateLimitedUntil.get(modelId);
        // Only update if new limit is further in the future
        if (!existing || until > existing) {
            this.rateLimitedUntil.set(modelId, until);
        }
    }

    private getCircuitBreaker(agentName: string): CircuitBreaker {
        let breaker = this.circuitBreakers.get(agentName);
        if (!breaker) {
            breaker = new CircuitBreaker(`agent_${agentName}`, {
                failureThreshold: 3,
                successThreshold: 2,
                timeout: 60000,
                volumeThreshold: 5,
                onTrip: (name) => {
                    metrics.circuitBreakerTrips.inc({ name });
                    this.bus.emit({
                        type: 'status',
                        phase: 'thinking',
                        label: `Circuit breaker tripped for ${name}`,
                    });
                },
            });
            this.circuitBreakers.set(agentName, breaker);
        }
        return breaker;
    }

    async executeWithResilience<T>(
        agentName: string,
        taskId: string,
        operation: (signal: AbortSignal) => Promise<T>,
        abortSignal?: AbortSignal,
        modelId?: string
    ): Promise<T> {
        const breaker = this.getCircuitBreaker(agentName);
        const totalTimeoutMs = AGENT_TIMEOUTS[agentName] ?? this.config.agentTimeout;

        // Wait for any existing rate limit on this model before proceeding
        // Track time spent waiting to subtract from operation timeout budget
        let waitedMs = 0;
        if (modelId) {
            waitedMs = await this.waitForRateLimit(modelId, totalTimeoutMs, abortSignal);
        }

        // Subtract wait time from total budget, ensuring minimum 10s for operation
        const operationTimeoutMs = Math.max(10000, totalTimeoutMs - waitedMs);

        const retryPolicy = RetryPolicyBuilder.from('api')
            .maxAttempts(this.config.maxRetries)
            .initialDelay(this.config.initialRetryDelay)
            .maxDelay(this.config.maxRetryDelay)
            .retryOn((error) => !abortSignal?.aborted && isRetryableAgentError(error))
            .timeBudget(operationTimeoutMs)  // Abort retries if insufficient time remains
            .build();

        return breaker.execute(async () => {
            return withRetry(
                () =>
                    withAbortableTimeout(
                        (signal) => operation(signal),
                        operationTimeoutMs,
                        `agent_${agentName}_${taskId}`,
                        abortSignal
                    ),
                retryPolicy,
                {
                    onRetry: (context) => {
                        const delay = context.lastError
                            ? getRetryDelayFromError(context.lastError, retryPolicy, context.attempt)
                            : retryPolicy.initialDelay;

                        // Check if this is a rate limit error with Retry-After
                        const classification = context.lastError
                            ? classifyAgentErrorWithRetryAfter(context.lastError)
                            : undefined;

                        // Record rate limit so other agents using the same model will wait
                        if (modelId && classification?.type === 'rate_limited' && classification.retryAfterMs) {
                            this.recordRateLimit(modelId, classification.retryAfterMs);
                        }

                        let statusLabel: string;
                        if (classification?.type === 'rate_limited') {
                            const waitSecs = Math.ceil(delay / 1000);
                            statusLabel = `Rate limited, waiting ${waitSecs}s before retry ${context.attempt + 1}/${retryPolicy.maxAttempts}`;
                        } else {
                            statusLabel = `Retrying ${agentName} (attempt ${context.attempt + 1}/${retryPolicy.maxAttempts}) in ${delay}ms...`;
                        }

                        this.bus.emit({
                            type: 'status',
                            phase: 'thinking',
                            label: statusLabel,
                        });
                    },
                }
            );
        });
    }
}
