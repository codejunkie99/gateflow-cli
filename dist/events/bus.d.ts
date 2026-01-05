/**
 * GateFlow Event Bus
 * Central event emitter for decoupled rendering
 */
import { Transform } from 'stream';
import type { UiEvent, ApprovalResponseEvent } from './types.js';
export type EventListener = (event: UiEvent) => void;
export type EventFilter = (event: UiEvent) => boolean;
export interface Subscription {
    unsubscribe: () => void;
}
export declare class EventBus {
    private listeners;
    private filteredListeners;
    private history;
    private historyEnabled;
    private maxHistorySize;
    private pendingApprovals;
    private approvalTimeout;
    /**
     * Emit an event to all subscribers
     */
    emit(event: UiEvent): void;
    /**
     * Subscribe to all events
     */
    subscribe(listener: EventListener): Subscription;
    /**
     * Subscribe to filtered events
     */
    subscribeFiltered(filter: EventFilter, listener: EventListener): Subscription;
    /**
     * Subscribe to specific event type
     */
    on<T extends UiEvent['type']>(type: T, listener: (event: Extract<UiEvent, {
        type: T;
    }>) => void): Subscription;
    /**
     * One-time subscription
     */
    once<T extends UiEvent['type']>(type: T, listener: (event: Extract<UiEvent, {
        type: T;
    }>) => void): Subscription;
    /**
     * Request approval with promise-based response
     */
    requestApproval(action: string, details: string, options?: {
        diff?: string;
        choices?: string[];
        timeout?: number;
    }): Promise<ApprovalResponseEvent>;
    /**
     * Create a JSON stream transform for --json mode
     */
    toJsonStream(): Transform;
    /**
     * Pipe all events to a JSON stream
     */
    pipeToJsonStream(stream: NodeJS.WritableStream): Subscription;
    /**
     * Enable/disable event history
     */
    enableHistory(enabled: boolean, maxSize?: number): void;
    /**
     * Get event history
     */
    getHistory(): readonly UiEvent[];
    /**
     * Clear all pending approvals (on shutdown)
     */
    clearPendingApprovals(): void;
    /**
     * Remove all listeners
     */
    clear(): void;
    /**
     * Get listener count (for debugging)
     */
    get listenerCount(): number;
}
export declare function getGlobalEventBus(): EventBus;
export declare function resetGlobalEventBus(): void;
/**
 * Create a scoped event bus that prefixes all events
 * Useful for nested operations
 */
export declare function createScopedBus(parent: EventBus, scope: string): {
    emit: (event: UiEvent) => void;
    status: (phase: UiEvent extends {
        type: 'status';
    } ? UiEvent['phase'] : never, label: string) => void;
};
