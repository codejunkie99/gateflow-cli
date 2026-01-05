/**
 * GateFlow Event Bus
 * Central event emitter for decoupled rendering
 */

import { Transform } from 'stream';
import type { UiEvent, ApprovalResponseEvent } from './types.js';

// ============================================================================
// Event Listener Types
// ============================================================================

export type EventListener = (event: UiEvent) => void;
export type EventFilter = (event: UiEvent) => boolean;

export interface Subscription {
    unsubscribe: () => void;
}

// ============================================================================
// Event Bus Implementation
// ============================================================================

export class EventBus {
    private listeners: Set<EventListener> = new Set();
    private filteredListeners: Map<EventFilter, EventListener> = new Map();
    private history: UiEvent[] = [];
    private historyEnabled: boolean = false;
    private maxHistorySize: number = 1000;
    
    // Pending approval requests (for human-in-the-loop)
    private pendingApprovals: Map<string, {
        resolve: (response: ApprovalResponseEvent) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }> = new Map();
    
    private approvalTimeout: number = 60000; // 60 seconds default

    /**
     * Emit an event to all subscribers
     */
    emit(event: UiEvent): void {
        // Store in history if enabled
        if (this.historyEnabled) {
            this.history.push(event);
            if (this.history.length > this.maxHistorySize) {
                this.history.shift();
            }
        }

        // Handle approval responses specially
        if (event.type === 'approval_response') {
            const pending = this.pendingApprovals.get(event.id);
            if (pending) {
                clearTimeout(pending.timeout);
                pending.resolve(event);
                this.pendingApprovals.delete(event.id);
            }
        }

        // Notify all listeners
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[EventBus] Listener error:', error);
            }
        }

        // Notify filtered listeners
        for (const [filter, listener] of this.filteredListeners) {
            if (filter(event)) {
                try {
                    listener(event);
                } catch (error) {
                    console.error('[EventBus] Filtered listener error:', error);
                }
            }
        }
    }

    /**
     * Subscribe to all events
     */
    subscribe(listener: EventListener): Subscription {
        this.listeners.add(listener);
        return {
            unsubscribe: () => this.listeners.delete(listener)
        };
    }

    /**
     * Subscribe to filtered events
     */
    subscribeFiltered(filter: EventFilter, listener: EventListener): Subscription {
        this.filteredListeners.set(filter, listener);
        return {
            unsubscribe: () => this.filteredListeners.delete(filter)
        };
    }

    /**
     * Subscribe to specific event type
     */
    on<T extends UiEvent['type']>(
        type: T,
        listener: (event: Extract<UiEvent, { type: T }>) => void
    ): Subscription {
        return this.subscribeFiltered(
            (event) => event.type === type,
            listener as EventListener
        );
    }

    /**
     * One-time subscription
     */
    once<T extends UiEvent['type']>(
        type: T,
        listener: (event: Extract<UiEvent, { type: T }>) => void
    ): Subscription {
        const sub = this.on(type, (event) => {
            sub.unsubscribe();
            listener(event);
        });
        return sub;
    }

    /**
     * Request approval with promise-based response
     */
    async requestApproval(
        action: string,
        details: string,
        options?: {
            diff?: string;
            choices?: string[];
            timeout?: number;
        }
    ): Promise<ApprovalResponseEvent> {
        const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const timeout = options?.timeout ?? this.approvalTimeout;

        return new Promise((resolve, reject) => {
            // Set up timeout
            const timeoutHandle = setTimeout(() => {
                this.pendingApprovals.delete(id);
                reject(new Error(`Approval request timed out after ${timeout}ms`));
            }, timeout);

            // Store pending approval
            this.pendingApprovals.set(id, {
                resolve,
                reject,
                timeout: timeoutHandle
            });

            // Emit the request
            this.emit({
                type: 'approval_request',
                id,
                action,
                details,
                diff: options?.diff,
                options: options?.choices
            });
        });
    }

    /**
     * Create a JSON stream transform for --json mode
     */
    toJsonStream(): Transform {
        const self = this;
        return new Transform({
            objectMode: true,
            transform(event: UiEvent, _encoding, callback) {
                try {
                    // Handle bigint serialization
                    const serialized = JSON.stringify(event, (_, value) =>
                        typeof value === 'bigint' ? value.toString() : value
                    );
                    callback(null, serialized + '\n');
                } catch (error) {
                    callback(error as Error);
                }
            }
        });
    }

    /**
     * Pipe all events to a JSON stream
     */
    pipeToJsonStream(stream: NodeJS.WritableStream): Subscription {
        const transform = this.toJsonStream();
        transform.pipe(stream);
        
        return this.subscribe((event) => {
            transform.write(event);
        });
    }

    /**
     * Enable/disable event history
     */
    enableHistory(enabled: boolean, maxSize?: number): void {
        this.historyEnabled = enabled;
        if (maxSize) {
            this.maxHistorySize = maxSize;
        }
        if (!enabled) {
            this.history = [];
        }
    }

    /**
     * Get event history
     */
    getHistory(): readonly UiEvent[] {
        return this.history;
    }

    /**
     * Clear all pending approvals (on shutdown)
     */
    clearPendingApprovals(): void {
        for (const [id, pending] of this.pendingApprovals) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Event bus shutting down'));
        }
        this.pendingApprovals.clear();
    }

    /**
     * Remove all listeners
     */
    clear(): void {
        this.listeners.clear();
        this.filteredListeners.clear();
        this.clearPendingApprovals();
    }

    /**
     * Get listener count (for debugging)
     */
    get listenerCount(): number {
        return this.listeners.size + this.filteredListeners.size;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalBus: EventBus | null = null;

export function getGlobalEventBus(): EventBus {
    if (!globalBus) {
        globalBus = new EventBus();
    }
    return globalBus;
}

export function resetGlobalEventBus(): void {
    if (globalBus) {
        globalBus.clear();
    }
    globalBus = null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a scoped event bus that prefixes all events
 * Useful for nested operations
 */
export function createScopedBus(
    parent: EventBus,
    scope: string
): {
    emit: (event: UiEvent) => void;
    status: (phase: UiEvent extends { type: 'status' } ? UiEvent['phase'] : never, label: string) => void;
} {
    return {
        emit: (event) => {
            // Prefix status labels with scope
            if (event.type === 'status') {
                parent.emit({
                    ...event,
                    label: `[${scope}] ${event.label}`
                });
            } else {
                parent.emit(event);
            }
        },
        status: (phase, label) => {
            parent.emit({
                type: 'status',
                phase: phase as any,
                label: `[${scope}] ${label}`
            });
        }
    };
}

