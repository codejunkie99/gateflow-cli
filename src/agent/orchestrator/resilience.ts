/**
 * Agent resilience layer
 * Circuit breaker + retry + timeout for multi-agent execution
 */

import { withAbortableTimeout } from '../../resilience/timeout.js';
import {
    RetryPolicyBuilder,
    getRetryDelayFromError,
    withRetry,
} from '../../resilience/retry.js';
import { CircuitBreaker, CircuitOpenError } from '../../resilience/circuit-breaker.js';
import type { EventBus } from '../../events/index.js';

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

export type AgentErrorType = 'transient' | 'permanent' | 'timeout' | 'circuit_open';

export function classifyAgentError(error: unknown): AgentErrorType {
    if (error instanceof CircuitOpenError) {
        return 'circuit_open';
    }

    if (error instanceof Error) {
        if (error.name === 'AbortError') {
            return 'permanent';
        }

        const msg = error.message.toLowerCase();

        if (msg.includes('timeout') || msg.includes('timed out')) {
            return 'timeout';
        }

        if (
            msg.includes('rate limit') ||
            msg.includes('429') ||
            msg.includes('overloaded') ||
            msg.includes('529') ||
            msg.includes('connection') ||
            msg.includes('network') ||
            msg.includes('econnreset') ||
            msg.includes('socket')
        ) {
            return 'transient';
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
            return 'permanent';
        }
    }

    return 'transient';
}

export function isRetryableAgentError(error: unknown): boolean {
    const type = classifyAgentError(error);
    return type === 'transient' || type === 'timeout';
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
                        this.bus.emit({
                            type: 'status',
                            phase: 'thinking',
                            label: `Retrying ${agentName} (attempt ${context.attempt + 1}/${retryPolicy.maxAttempts}) in ${delay}ms...`,
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
