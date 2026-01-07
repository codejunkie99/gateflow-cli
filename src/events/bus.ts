/**
 * GateFlow Event Bus
 * Central event emitter for decoupled rendering
 */

import { Transform } from 'stream';
import { randomUUID } from 'crypto';
import type { UiEvent, ApprovalResponseEvent, StatusPhase } from './types.js';

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
    // Fix: Use array with unique IDs instead of Map with function keys
    private filteredListeners: Array<{ id: number; filter: EventFilter; listener: EventListener }> = [];
    private nextFilterId: number = 0;
    // Fix: Use ring buffer pattern for O(1) history operations
    private history: UiEvent[] = [];
    private historyIndex: number = 0;
    private historyFull: boolean = false;
    private historyEnabled: boolean = false;
    private maxHistorySize: number = 1000;

    // Pending approval requests (for human-in-the-loop)
    private pendingApprovals: Map<string, {
        resolve: (response: ApprovalResponseEvent) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }> = new Map();

    private approvalTimeout: number = 60000; // 60 seconds default
    private readonly MAX_PENDING_APPROVALS = 10; // Maximum concurrent approval requests

    /**
     * Emit an event to all subscribers
     */
    emit(event: UiEvent): void {
        // Store in history if enabled (ring buffer - O(1) instead of O(n))
        if (this.historyEnabled) {
            this.history[this.historyIndex] = event;
            this.historyIndex = (this.historyIndex + 1) % this.maxHistorySize;
            if (this.historyIndex === 0) {
                this.historyFull = true;
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
        for (const { filter, listener } of this.filteredListeners) {
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
     * Fix: Uses unique ID instead of function reference as key
     */
    subscribeFiltered(filter: EventFilter, listener: EventListener): Subscription {
        const id = this.nextFilterId++;
        this.filteredListeners.push({ id, filter, listener });
        return {
            unsubscribe: () => {
                const index = this.filteredListeners.findIndex(f => f.id === id);
                if (index !== -1) {
                    this.filteredListeners.splice(index, 1);
                }
            }
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
        // Check concurrent approval limit
        if (this.pendingApprovals.size >= this.MAX_PENDING_APPROVALS) {
            // Auto-reject oldest approval to make room
            const oldestId = this.pendingApprovals.keys().next().value;
            if (oldestId) {
                const oldest = this.pendingApprovals.get(oldestId);
                if (oldest) {
                    clearTimeout(oldest.timeout);
                    this.pendingApprovals.delete(oldestId);
                    oldest.reject(new Error('Too many pending approvals - oldest request rejected'));
                }
            }
        }

        // Generate cryptographically secure unique ID
        const id = `approval-${randomUUID()}`;
        const timeout = options?.timeout ?? this.approvalTimeout;

        return new Promise((resolve, reject) => {
            // Set up timeout with race condition protection
            const timeoutHandle = setTimeout(() => {
                // Fix: Check if approval still exists before deleting/rejecting
                // This prevents race condition where user responds at same time as timeout
                const pending = this.pendingApprovals.get(id);
                if (pending) {
                    this.pendingApprovals.delete(id);
                    pending.reject(new Error(`Approval request timed out after ${timeout}ms`));
                }
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
     * Fix: Handles backpressure to prevent memory issues
     */
    pipeToJsonStream(stream: NodeJS.WritableStream): Subscription {
        const transform = this.toJsonStream();
        transform.pipe(stream);

        let paused = false;
        const buffer: UiEvent[] = [];
        const MAX_BUFFER_SIZE = 10000; // Prevent unbounded memory growth

        const drainBuffer = () => {
            while (buffer.length > 0 && !paused) {
                const ok = transform.write(buffer.shift()!);
                if (!ok) {
                    paused = true;
                }
            }
        };

        transform.on('drain', () => {
            paused = false;
            drainBuffer();
        });

        const sub = this.subscribe((event) => {
            if (paused) {
                // Enforce buffer limit - drop oldest events if full
                if (buffer.length >= MAX_BUFFER_SIZE) {
                    buffer.shift();
                }
                buffer.push(event);
            } else {
                const ok = transform.write(event);
                if (!ok) {
                    paused = true;
                }
            }
        });

        return {
            unsubscribe: () => {
                sub.unsubscribe();
                transform.unpipe(stream);
                transform.end();
            }
        };
    }

    /**
     * Enable/disable event history
     */
    enableHistory(enabled: boolean, maxSize?: number): void {
        this.historyEnabled = enabled;
        if (maxSize !== undefined && maxSize > 0) {
            if (maxSize !== this.maxHistorySize) {
                // Size changed - reset ring buffer state to prevent index corruption
                this.maxHistorySize = maxSize;
                this.history = [];
                this.historyIndex = 0;
                this.historyFull = false;
            }
        }
        if (!enabled) {
            this.history = [];
            this.historyIndex = 0;
            this.historyFull = false;
        }
    }

    /**
     * Get event history (returns events in chronological order)
     */
    getHistory(): readonly UiEvent[] {
        if (!this.historyFull) {
            return this.history.slice(0, this.historyIndex);
        }
        // Ring buffer is full - concatenate from current index to end, then start to current index
        return [
            ...this.history.slice(this.historyIndex),
            ...this.history.slice(0, this.historyIndex)
        ];
    }

    /**
     * Clear all pending approvals (on shutdown)
     */
    clearPendingApprovals(): void {
        for (const pending of this.pendingApprovals.values()) {
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
        this.filteredListeners = [];
        this.clearPendingApprovals();
    }

    /**
     * Get listener count (for debugging)
     */
    get listenerCount(): number {
        return this.listeners.size + this.filteredListeners.length;
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
    status: (phase: StatusPhase, label: string) => void;
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
                phase,
                label: `[${scope}] ${label}`
            });
        }
    };
}

