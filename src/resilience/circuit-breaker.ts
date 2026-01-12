/**
 * GateFlow Circuit Breaker
 * Prevents cascading failures by failing fast when services are unhealthy
 */

import { GateFlowErrorCode, createGateFlowError } from '../error/types.js';

// ============================================================================
// Circuit State
// ============================================================================

export enum CircuitState {
    /** Circuit is closed - requests flow normally */
    CLOSED = 'closed',
    /** Circuit is open - requests fail immediately */
    OPEN = 'open',
    /** Circuit is testing - allowing limited requests through */
    HALF_OPEN = 'half_open',
}

// ============================================================================
// Configuration
// ============================================================================

export interface CircuitBreakerConfig {
    /** Number of failures before opening the circuit */
    failureThreshold: number;
    /** Number of successes in half-open state to close the circuit */
    successThreshold: number;
    /** Time to wait before transitioning from open to half-open (ms) */
    timeout: number;
    /** Minimum number of requests before failure rate is calculated */
    volumeThreshold: number;
    /** Time window for counting failures (ms) */
    rollingWindow: number;
    /** Function to determine if an error counts as a failure */
    isFailure: (error: unknown) => boolean;
}

export interface CircuitBreakerStats {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailure: number | null;
    lastSuccess: number | null;
    lastStateChange: number;
    totalRequests: number;
    failureRate: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    volumeThreshold: 10,
    rollingWindow: 60000,
    isFailure: () => true, // All errors count as failures by default
};

// ============================================================================
// Circuit Breaker Error
// ============================================================================

export class CircuitOpenError extends Error {
    public readonly code = GateFlowErrorCode.TOOL_EXECUTION_FAILED;
    public readonly timestamp: number;

    constructor(
        public readonly circuitName: string,
        public readonly retryAfter: number
    ) {
        super(`Circuit '${circuitName}' is open. Retry after ${retryAfter}ms`);
        this.name = 'CircuitOpenError';
        this.timestamp = Date.now();
    }
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failures: number = 0;
    private successes: number = 0;
    private lastFailure: number = 0;
    private lastSuccess: number = 0;
    private lastStateChange: number = Date.now();
    private totalRequests: number = 0;
    private recentFailures: number[] = []; // Timestamps of recent failures
    private config: CircuitBreakerConfig;

    constructor(
        private readonly name: string,
        config?: Partial<CircuitBreakerConfig>
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Execute an operation through the circuit breaker
     */
    async execute<T>(operation: () => Promise<T>): Promise<T> {
        // Check if circuit is open
        if (this.state === CircuitState.OPEN) {
            const timeSinceOpen = Date.now() - this.lastStateChange;

            if (timeSinceOpen >= this.config.timeout) {
                // Transition to half-open
                this.transitionTo(CircuitState.HALF_OPEN);
            } else {
                // Fail fast
                throw new CircuitOpenError(
                    this.name,
                    this.config.timeout - timeSinceOpen
                );
            }
        }

        this.totalRequests++;

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            if (this.config.isFailure(error)) {
                this.onFailure();
            }
            throw error;
        }
    }

    /**
     * Record a successful operation
     */
    private onSuccess(): void {
        this.successes++;
        this.lastSuccess = Date.now();

        if (this.state === CircuitState.HALF_OPEN) {
            if (this.successes >= this.config.successThreshold) {
                this.transitionTo(CircuitState.CLOSED);
            }
        }
    }

    /**
     * Record a failed operation
     */
    private onFailure(): void {
        const now = Date.now();
        this.failures++;
        this.lastFailure = now;
        this.recentFailures.push(now);

        // Clean up old failures outside the rolling window
        const windowStart = now - this.config.rollingWindow;
        this.recentFailures = this.recentFailures.filter(t => t >= windowStart);

        if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in half-open state reopens the circuit
            this.transitionTo(CircuitState.OPEN);
        } else if (this.state === CircuitState.CLOSED) {
            // Check if we should open the circuit
            if (
                this.totalRequests >= this.config.volumeThreshold &&
                this.recentFailures.length >= this.config.failureThreshold
            ) {
                this.transitionTo(CircuitState.OPEN);
            }
        }
    }

    /**
     * Transition to a new state
     */
    private transitionTo(newState: CircuitState): void {
        if (this.state !== newState) {
            this.state = newState;
            this.lastStateChange = Date.now();

            // Reset counters on state change
            if (newState === CircuitState.CLOSED) {
                this.failures = 0;
                this.successes = 0;
                this.recentFailures = [];
            } else if (newState === CircuitState.HALF_OPEN) {
                this.successes = 0;
            }
        }
    }

    /**
     * Get current circuit state
     */
    getState(): CircuitState {
        // Auto-transition from open to half-open if timeout has passed
        if (
            this.state === CircuitState.OPEN &&
            Date.now() - this.lastStateChange >= this.config.timeout
        ) {
            this.transitionTo(CircuitState.HALF_OPEN);
        }
        return this.state;
    }

    /**
     * Check if the circuit is open (requests will fail)
     */
    isOpen(): boolean {
        return this.getState() === CircuitState.OPEN;
    }

    /**
     * Manually reset the circuit to closed state
     */
    reset(): void {
        this.transitionTo(CircuitState.CLOSED);
        this.totalRequests = 0;
    }

    /**
     * Manually trip the circuit to open state
     */
    trip(): void {
        this.transitionTo(CircuitState.OPEN);
    }

    /**
     * Get circuit statistics
     */
    getStats(): CircuitBreakerStats {
        const windowStart = Date.now() - this.config.rollingWindow;
        const recentTotal = this.totalRequests; // Simplified - could track in rolling window
        const recentFailures = this.recentFailures.filter(t => t >= windowStart).length;

        return {
            state: this.getState(),
            failures: this.failures,
            successes: this.successes,
            lastFailure: this.lastFailure || null,
            lastSuccess: this.lastSuccess || null,
            lastStateChange: this.lastStateChange,
            totalRequests: this.totalRequests,
            failureRate: recentTotal > 0 ? recentFailures / recentTotal : 0,
        };
    }

    /**
     * Get circuit name
     */
    getName(): string {
        return this.name;
    }
}

// ============================================================================
// Circuit Breaker Registry
// ============================================================================

export class CircuitBreakerRegistry {
    private breakers = new Map<string, CircuitBreaker>();

    /**
     * Get or create a circuit breaker
     */
    get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
        let breaker = this.breakers.get(name);
        if (!breaker) {
            breaker = new CircuitBreaker(name, config);
            this.breakers.set(name, breaker);
        }
        return breaker;
    }

    /**
     * Execute through a named circuit breaker
     */
    async execute<T>(
        name: string,
        operation: () => Promise<T>,
        config?: Partial<CircuitBreakerConfig>
    ): Promise<T> {
        return this.get(name, config).execute(operation);
    }

    /**
     * Get all circuit breaker stats
     */
    getAllStats(): Record<string, CircuitBreakerStats> {
        const stats: Record<string, CircuitBreakerStats> = {};
        for (const [name, breaker] of this.breakers) {
            stats[name] = breaker.getStats();
        }
        return stats;
    }

    /**
     * Reset all circuit breakers
     */
    resetAll(): void {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }
}

// ============================================================================
// Pre-configured Circuit Breakers
// ============================================================================

/** Global circuit breaker registry */
export const circuitRegistry = new CircuitBreakerRegistry();

/** Circuit breaker for Verilator operations */
export const verilatorBreaker = new CircuitBreaker('verilator', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 60000,
    volumeThreshold: 5,
});

/** Circuit breaker for file system operations */
export const fileSystemBreaker = new CircuitBreaker('filesystem', {
    failureThreshold: 5,
    successThreshold: 1,
    timeout: 10000,
    volumeThreshold: 10,
});

/** Circuit breaker for API calls */
export const apiBreaker = new CircuitBreaker('api', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,
    volumeThreshold: 5,
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a circuit-broken version of a function
 */
export function withCircuitBreaker<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    breaker: CircuitBreaker
): (...args: TArgs) => Promise<TResult> {
    return (...args: TArgs) => breaker.execute(() => fn(...args));
}

/**
 * Decorator for adding circuit breaker to class methods
 */
export function CircuitBroken(breakerName: string, config?: Partial<CircuitBreakerConfig>) {
    return function <T extends (...args: any[]) => Promise<any>>(
        _target: object,
        _propertyKey: string,
        descriptor: TypedPropertyDescriptor<T>
    ): TypedPropertyDescriptor<T> {
        const originalMethod = descriptor.value!;
        const breaker = circuitRegistry.get(breakerName, config);

        descriptor.value = (function (this: any, ...args: Parameters<T>): ReturnType<T> {
            return breaker.execute(() => originalMethod.apply(this, args)) as ReturnType<T>;
        } as unknown) as T;

        return descriptor;
    };
}
