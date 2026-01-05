/**
 * GateFlow Event Bus
 * Central event emitter for decoupled rendering
 */
import { Transform } from 'stream';
// ============================================================================
// Event Bus Implementation
// ============================================================================
export class EventBus {
    listeners = new Set();
    filteredListeners = new Map();
    history = [];
    historyEnabled = false;
    maxHistorySize = 1000;
    // Pending approval requests (for human-in-the-loop)
    pendingApprovals = new Map();
    approvalTimeout = 60000; // 60 seconds default
    /**
     * Emit an event to all subscribers
     */
    emit(event) {
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
            }
            catch (error) {
                console.error('[EventBus] Listener error:', error);
            }
        }
        // Notify filtered listeners
        for (const [filter, listener] of this.filteredListeners) {
            if (filter(event)) {
                try {
                    listener(event);
                }
                catch (error) {
                    console.error('[EventBus] Filtered listener error:', error);
                }
            }
        }
    }
    /**
     * Subscribe to all events
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return {
            unsubscribe: () => this.listeners.delete(listener)
        };
    }
    /**
     * Subscribe to filtered events
     */
    subscribeFiltered(filter, listener) {
        this.filteredListeners.set(filter, listener);
        return {
            unsubscribe: () => this.filteredListeners.delete(filter)
        };
    }
    /**
     * Subscribe to specific event type
     */
    on(type, listener) {
        return this.subscribeFiltered((event) => event.type === type, listener);
    }
    /**
     * One-time subscription
     */
    once(type, listener) {
        const sub = this.on(type, (event) => {
            sub.unsubscribe();
            listener(event);
        });
        return sub;
    }
    /**
     * Request approval with promise-based response
     */
    async requestApproval(action, details, options) {
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
    toJsonStream() {
        const self = this;
        return new Transform({
            objectMode: true,
            transform(event, _encoding, callback) {
                try {
                    // Handle bigint serialization
                    const serialized = JSON.stringify(event, (_, value) => typeof value === 'bigint' ? value.toString() : value);
                    callback(null, serialized + '\n');
                }
                catch (error) {
                    callback(error);
                }
            }
        });
    }
    /**
     * Pipe all events to a JSON stream
     */
    pipeToJsonStream(stream) {
        const transform = this.toJsonStream();
        transform.pipe(stream);
        return this.subscribe((event) => {
            transform.write(event);
        });
    }
    /**
     * Enable/disable event history
     */
    enableHistory(enabled, maxSize) {
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
    getHistory() {
        return this.history;
    }
    /**
     * Clear all pending approvals (on shutdown)
     */
    clearPendingApprovals() {
        for (const [id, pending] of this.pendingApprovals) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Event bus shutting down'));
        }
        this.pendingApprovals.clear();
    }
    /**
     * Remove all listeners
     */
    clear() {
        this.listeners.clear();
        this.filteredListeners.clear();
        this.clearPendingApprovals();
    }
    /**
     * Get listener count (for debugging)
     */
    get listenerCount() {
        return this.listeners.size + this.filteredListeners.size;
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let globalBus = null;
export function getGlobalEventBus() {
    if (!globalBus) {
        globalBus = new EventBus();
    }
    return globalBus;
}
export function resetGlobalEventBus() {
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
export function createScopedBus(parent, scope) {
    return {
        emit: (event) => {
            // Prefix status labels with scope
            if (event.type === 'status') {
                parent.emit({
                    ...event,
                    label: `[${scope}] ${event.label}`
                });
            }
            else {
                parent.emit(event);
            }
        },
        status: (phase, label) => {
            parent.emit({
                type: 'status',
                phase: phase,
                label: `[${scope}] ${label}`
            });
        }
    };
}
