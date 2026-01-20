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

export const DEFAULT_AGENT_RESILIENCE: AgentResilienceConfig = {
    agentTimeout: 120000,
    maxRetries: 3,
    initialRetryDelay: 2000,
    maxRetryDelay: 30000,
};

export const AGENT_TIMEOUTS: Record<string, number> = {
    understanding: 90000,
    codegen: 120000,
    testbench: 120000,
    debug: 150000,
    refactoring: 120000,
};

export type AgentErrorType = 'transient' | 'permanent' | 'timeout' | 'circuit_open' | 'rate_limited';

export interface AgentErrorClassification {
    type: AgentErrorType;
    retryAfterMs?: number;
}

/**
 * Classify an agent error and extract retry-after information if available
 */
export function classifyAgentError(error: unknown): AgentErrorType {
    return classifyAgentErrorWithRetryAfter(error).type;
}

/**
 * Classify an agent error with full details including retry-after
 */
export function classifyAgentErrorWithRetryAfter(error: unknown): AgentErrorClassification {
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
    const errorObj = error as Record<string, unknown>;
    if (errorObj.status === 429 || errorObj.statusCode === 429) {
        return { type: 'rate_limited', retryAfterMs };
    }

    return { type: 'transient', retryAfterMs };
}

export function isRetryableAgentError(error: unknown): boolean {
    const type = classifyAgentError(error);
    return type === 'transient' || type === 'timeout' || type === 'rate_limited';
}

export class AgentResilienceLayer {
    private circuitBreakers: Map<string, CircuitBreaker> = new Map();
    private config: AgentResilienceConfig;

    constructor(
        private bus: EventBus,
        config?: Partial<AgentResilienceConfig>
    ) {
        this.config = { ...DEFAULT_AGENT_RESILIENCE, ...config };
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
        abortSignal?: AbortSignal
    ): Promise<T> {
        const breaker = this.getCircuitBreaker(agentName);
        const timeoutMs = AGENT_TIMEOUTS[agentName] ?? this.config.agentTimeout;

        const retryPolicy = RetryPolicyBuilder.from('api')
            .maxAttempts(this.config.maxRetries)
            .initialDelay(this.config.initialRetryDelay)
            .maxDelay(this.config.maxRetryDelay)
            .retryOn((error) => !abortSignal?.aborted && isRetryableAgentError(error))
            .build();

        return breaker.execute(async () => {
            return withRetry(
                () =>
                    withAbortableTimeout(
                        (signal) => operation(signal),
                        timeoutMs,
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

                        let statusLabel: string;
                        if (classification?.type === 'rate_limited') {
                            // More informative message for rate limit errors
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

    getHealthStatus(): Record<string, { state: string; failureRate: number }> {
        const status: Record<string, { state: string; failureRate: number }> = {};
        for (const [name, breaker] of this.circuitBreakers) {
            const stats = breaker.getStats();
            status[name] = {
                state: stats.state,
                failureRate: stats.failureRate,
            };
        }
        return status;
    }

    resetAll(): void {
        for (const breaker of this.circuitBreakers.values()) {
            breaker.reset();
        }
    }
}
