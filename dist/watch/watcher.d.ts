/**
 * File Watcher
 * Watch for file changes and trigger actions
 */
import type { EventBus } from '../events/index.js';
import type { ProjectIndexer } from '../context/index.js';
import type { Verilator } from '../verification/index.js';
export interface WatchConfig {
    /** Patterns to watch */
    patterns: string[];
    /** Patterns to ignore */
    ignorePatterns: string[];
    /** Debounce delay in ms */
    debounceMs: number;
    /** Actions to perform on change */
    actions: WatchAction[];
    /** Use polling (for network drives) */
    usePolling: boolean;
    /** Polling interval if usePolling is true */
    pollInterval: number;
}
export type WatchAction = 'lint' | 'index' | 'compile';
export interface WatchState {
    watching: boolean;
    patterns: string[];
    fileCount: number;
    lastChange?: {
        path: string;
        type: 'add' | 'change' | 'unlink';
        time: number;
    };
}
export declare class WatchManager {
    private rootPath;
    private bus;
    private indexer;
    private verilator?;
    private config;
    private watcher;
    private state;
    private pendingChanges;
    private debounceTimer;
    private processing;
    constructor(rootPath: string, bus: EventBus, indexer: ProjectIndexer, verilator?: Verilator | undefined, config?: Partial<WatchConfig>);
    /**
     * Start watching for file changes
     */
    start(): void;
    /**
     * Stop watching
     */
    stop(): Promise<void>;
    /**
     * Handle a file change event
     */
    private handleChange;
    /**
     * Process accumulated changes
     */
    private processChanges;
    /**
     * Run a watch action
     */
    private runAction;
    private isSystemVerilogFile;
    private getWatchedCount;
    /**
     * Get current watch state
     */
    getState(): WatchState;
    /**
     * Update configuration
     */
    updateConfig(updates: Partial<WatchConfig>): void;
    /**
     * Add a pattern to watch
     */
    addPattern(pattern: string): void;
    /**
     * Remove a pattern
     */
    removePattern(pattern: string): void;
}
