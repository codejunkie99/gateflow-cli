/**
 * GateFlow Fallback Manager
 * Handles model fallback chain when primary model fails
 */

import { GateFlowErrorCode } from '../error/types.js';
import {
    RateLimitError,
    APITimeoutError,
    ContextLengthExceededError,
    AuthenticationError,
    classifyError,
} from '../error/classes.js';

// ============================================================================
// Fallback Configuration
// ============================================================================

export interface FallbackChain {
    /** Ordered list of models to try */
    models: string[];
    /** Conditions that trigger fallback */
    conditions: FallbackConditions;
    /** Maximum fallback attempts per request */
    maxFallbacks: number;
}

export interface FallbackConditions {
    /** Fallback on rate limit errors */
    onRateLimit: boolean;
    /** Fallback on timeout errors */
    onTimeout: boolean;
    /** Fallback on context length exceeded */
    onContextExceeded: boolean;
    /** Fallback on generic API errors */
    onError: boolean;
    /** Fallback on model unavailable */
    onModelUnavailable: boolean;
}

export interface FallbackAttempt {
    model: string;
    error?: Error;
    timestamp: number;
    durationMs: number;
}

export interface FallbackStats {
    currentModelIndex: number;
    currentModel: string;
    failedModels: string[];
    attempts: FallbackAttempt[];
    totalFallbacks: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default fallback chain - tries sonnet first, then haiku
 */
export const DEFAULT_FALLBACK_CHAIN: FallbackChain = {
    models: [
        'claude-sonnet-4-20250514',
        'claude-haiku-3.5-sonnet-20241022',
    ],
    conditions: {
        onRateLimit: true,
        onTimeout: true,
        onContextExceeded: true,
        onError: false, // Don't fallback on generic errors by default
        onModelUnavailable: true,
    },
    maxFallbacks: 2,
};

/**
 * Aggressive fallback chain - tries all available models
 */
export const AGGRESSIVE_FALLBACK_CHAIN: FallbackChain = {
    models: [
        'claude-sonnet-4-20250514',
        'claude-haiku-3.5-sonnet-20241022',
    ],
    conditions: {
        onRateLimit: true,
        onTimeout: true,
        onContextExceeded: true,
        onError: true,
        onModelUnavailable: true,
    },
    maxFallbacks: 3,
};

// ============================================================================
// Fallback Manager Implementation
// ============================================================================

export class FallbackManager {
    private currentModelIndex: number = 0;
    private failedModels: Set<string> = new Set();
    private attempts: FallbackAttempt[] = [];
    private fallbackCount: number = 0;
    private chain: FallbackChain;

    constructor(chain?: FallbackChain) {
        this.chain = chain ?? DEFAULT_FALLBACK_CHAIN;
    }

    /**
     * Get the current model to use
     */
    getCurrentModel(): string {
        return this.chain.models[this.currentModelIndex] ?? this.chain.models[0];
    }

    /**
     * Check if we should fallback based on the error
     */
    shouldFallback(error: unknown): boolean {
        // Check if we've exceeded max fallbacks
        if (this.fallbackCount >= this.chain.maxFallbacks) {
            return false;
        }

        // Check if there are more models to try
        if (this.currentModelIndex >= this.chain.models.length - 1) {
            return false;
        }

        // Check error conditions
        if (error instanceof RateLimitError && this.chain.conditions.onRateLimit) {
            return true;
        }
        if (error instanceof APITimeoutError && this.chain.conditions.onTimeout) {
            return true;
        }
        if (error instanceof ContextLengthExceededError && this.chain.conditions.onContextExceeded) {
            return true;
        }

        // Check for model unavailable errors
        if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            if (
                this.chain.conditions.onModelUnavailable &&
                (msg.includes('model') && (msg.includes('unavailable') || msg.includes('not found')))
            ) {
                return true;
            }
        }

        // Generic error fallback
        if (this.chain.conditions.onError && classifyError(error) !== 'fatal') {
            return true;
        }

        return false;
    }

    /**
     * Move to the next model in the chain
     * @returns The next model, or null if no more models
     */
    nextModel(): string | null {
        if (this.currentModelIndex >= this.chain.models.length - 1) {
            return null;
        }

        // Record failure of current model
        this.failedModels.add(this.getCurrentModel());

        // Move to next model
        this.currentModelIndex++;
        this.fallbackCount++;

        return this.getCurrentModel();
    }

    /**
     * Record an attempt
     */
    recordAttempt(model: string, error?: Error, durationMs: number = 0): void {
        this.attempts.push({
            model,
            error,
            timestamp: Date.now(),
            durationMs,
        });
    }

    /**
     * Reset the fallback manager to initial state
     */
    reset(): void {
        this.currentModelIndex = 0;
        this.failedModels.clear();
        this.attempts = [];
        this.fallbackCount = 0;
    }

    /**
     * Get the index of the current model
     */
    getCurrentModelIndex(): number {
        return this.currentModelIndex;
    }

    /**
     * Check if all models have been tried
     */
    isExhausted(): boolean {
        return this.currentModelIndex >= this.chain.models.length - 1;
    }

    /**
     * Get fallback statistics
     */
    getStats(): FallbackStats {
        return {
            currentModelIndex: this.currentModelIndex,
            currentModel: this.getCurrentModel(),
            failedModels: [...this.failedModels],
            attempts: [...this.attempts],
            totalFallbacks: this.fallbackCount,
        };
    }

    /**
     * Get remaining models that haven't been tried
     */
    getRemainingModels(): string[] {
        return this.chain.models.slice(this.currentModelIndex + 1);
    }

    /**
     * Update the fallback chain
     */
    updateChain(chain: Partial<FallbackChain>): void {
        this.chain = { ...this.chain, ...chain };
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Execute an operation with automatic fallback
 */
export async function withFallback<T>(
    operation: (model: string) => Promise<T>,
    manager: FallbackManager,
    callbacks?: {
        onFallback?: (fromModel: string, toModel: string, error: Error) => void;
        onSuccess?: (model: string, attempts: number) => void;
        onExhausted?: (attempts: FallbackAttempt[]) => void;
    }
): Promise<T> {
    let attempts = 0;

    while (true) {
        const model = manager.getCurrentModel();
        const startTime = Date.now();
        attempts++;

        try {
            const result = await operation(model);
            manager.recordAttempt(model, undefined, Date.now() - startTime);
            callbacks?.onSuccess?.(model, attempts);
            return result;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            manager.recordAttempt(model, err, Date.now() - startTime);

            if (manager.shouldFallback(error)) {
                const nextModel = manager.nextModel();
                if (nextModel) {
                    callbacks?.onFallback?.(model, nextModel, err);
                    continue;
                }
            }

            // No more fallbacks available
            callbacks?.onExhausted?.(manager.getStats().attempts);
            throw error;
        }
    }
}

/**
 * Create a fallback manager with custom configuration
 */
export function createFallbackManager(options?: {
    models?: string[];
    conditions?: Partial<FallbackConditions>;
    maxFallbacks?: number;
}): FallbackManager {
    const chain: FallbackChain = {
        models: options?.models ?? DEFAULT_FALLBACK_CHAIN.models,
        conditions: {
            ...DEFAULT_FALLBACK_CHAIN.conditions,
            ...options?.conditions,
        },
        maxFallbacks: options?.maxFallbacks ?? DEFAULT_FALLBACK_CHAIN.maxFallbacks,
    };

    return new FallbackManager(chain);
}

// ============================================================================
// Global Fallback Manager
// ============================================================================

let globalFallbackManager: FallbackManager | null = null;

/**
 * Get the global fallback manager
 */
export function getGlobalFallbackManager(): FallbackManager {
    if (!globalFallbackManager) {
        globalFallbackManager = new FallbackManager();
    }
    return globalFallbackManager;
}

/**
 * Set the global fallback manager
 */
export function setGlobalFallbackManager(manager: FallbackManager): void {
    globalFallbackManager = manager;
}

/**
 * Reset the global fallback manager
 */
export function resetGlobalFallbackManager(): void {
    if (globalFallbackManager) {
        globalFallbackManager.reset();
    }
}
