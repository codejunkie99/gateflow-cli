/**
 * File Watcher
 * Watch for file changes and trigger actions
 */

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import type { EventBus } from '../events/index.js';
import type { SVIndexerAdapter } from '../indexer/sv-indexer-adapter.js';
import type { Verilator } from '../verification/index.js';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Watch Manager
// ============================================================================

export class WatchManager {
    private config: WatchConfig;
    private watcher: FSWatcher | null = null;
    private state: WatchState;
    private pendingChanges: Map<string, { type: 'add' | 'change' | 'unlink'; time: number }> = new Map();
    private debounceTimer: NodeJS.Timeout | null = null;
    private processing: boolean = false;

    constructor(
        private rootPath: string,
        private bus: EventBus,
        private indexer: SVIndexerAdapter,
        private verilator?: Verilator,
        config?: Partial<WatchConfig>
    ) {
        this.config = {
            patterns: config?.patterns ?? ['**/*.sv', '**/*.svh', '**/*.v', '**/*.vh'],
            ignorePatterns: config?.ignorePatterns ?? [
                '**/node_modules/**',
                '**/obj_dir/**',
                '**/.git/**',
                '**/dist/**',
                '**/*.gateflow-backup'
            ],
            debounceMs: config?.debounceMs ?? 300,
            actions: config?.actions ?? ['lint', 'index'],
            usePolling: config?.usePolling ?? false,
            pollInterval: config?.pollInterval ?? 1000
        };

        this.state = {
            watching: false,
            patterns: this.config.patterns,
            fileCount: 0
        };
    }

    // ========================================================================
    // Start / Stop
    // ========================================================================

    /**
     * Start watching for file changes
     */
    start(): void {
        if (this.watcher) {
            return; // Already watching
        }

        const watchPaths = this.config.patterns.map(p =>
            path.isAbsolute(p) ? p : path.join(this.rootPath, p)
        );

        this.watcher = chokidar.watch(watchPaths, {
            ignored: this.config.ignorePatterns,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50
            },
            usePolling: this.config.usePolling,
            interval: this.config.pollInterval
        });

        this.watcher
            .on('add', (filepath) => this.handleChange(filepath, 'add'))
            .on('change', (filepath) => this.handleChange(filepath, 'change'))
            .on('unlink', (filepath) => this.handleChange(filepath, 'unlink'))
            .on('ready', () => {
                this.state.watching = true;
                this.state.fileCount = this.getWatchedCount();

                this.bus.emit({
                    type: 'watch_status',
                    watching: true,
                    patterns: this.config.patterns,
                    fileCount: this.state.fileCount
                });

                this.bus.emit({
                    type: 'status',
                    phase: 'watching',
                    label: `Watching ${this.state.fileCount} files...`
                });
            })
            .on('error', (error) => {
                this.bus.emit({
                    type: 'error',
                    message: `Watch error: ${error.message}`,
                    code: 7
                });
            });
    }

    /**
     * Stop watching
     */
    async stop(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        this.state.watching = false;
        this.pendingChanges.clear();

        this.bus.emit({
            type: 'watch_status',
            watching: false,
            patterns: this.config.patterns,
            fileCount: 0
        });
    }

    // ========================================================================
    // Change Handling
    // ========================================================================

    /**
     * Handle a file change event
     */
    private handleChange(filepath: string, type: 'add' | 'change' | 'unlink'): void {
        const relativePath = path.relative(this.rootPath, filepath);

        // Store pending change
        this.pendingChanges.set(filepath, { type, time: Date.now() });

        this.state.lastChange = {
            path: relativePath,
            type,
            time: Date.now()
        };

        // Emit immediate event
        this.bus.emit({
            type: 'file_change',
            path: relativePath,
            changeType: type
        });

        // Debounce processing
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.processChanges();
        }, this.config.debounceMs);
    }

    /**
     * Process accumulated changes
     */
    private async processChanges(): Promise<void> {
        if (this.processing) {
            // Clear existing timer before rescheduling to prevent memory leak
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => this.processChanges(), this.config.debounceMs);
            return;
        }

        this.processing = true;
        const changes = new Map(this.pendingChanges);
        this.pendingChanges.clear();

        try {
            // Group by action type
            const svFiles = Array.from(changes.entries())
                .filter(([p]) => this.isSystemVerilogFile(p));

            if (svFiles.length === 0) {
                return;
            }

            this.bus.emit({
                type: 'status',
                phase: 'watching',
                label: `Processing ${svFiles.length} changed file(s)...`
            });

            // Run actions
            for (const action of this.config.actions) {
                await this.runAction(action, svFiles);
            }

            this.bus.emit({
                type: 'status',
                phase: 'watching',
                label: `Watching ${this.state.fileCount} files...`
            });

        } catch (error) {
            this.bus.emit({
                type: 'error',
                message: `Watch action failed: ${error}`,
                recoverable: true
            });
        } finally {
            this.processing = false;
        }
    }

    /**
     * Run a watch action
     */
    private async runAction(
        action: WatchAction,
        files: [string, { type: 'add' | 'change' | 'unlink'; time: number }][]
    ): Promise<void> {
        switch (action) {
            case 'index':
                for (const [filepath, change] of files) {
                    await this.indexer.updateFile(filepath, change.type);
                }
                break;

            case 'lint':
                if (!this.verilator) break;
                for (const [filepath, change] of files) {
                    if (change.type !== 'unlink') {
                        const result = await this.verilator.lint(filepath);
                        
                        this.bus.emit({
                            type: 'tool_result',
                            tool: 'watch_lint',
                            ok: result.success,
                            summary: result.success
                                ? `${path.basename(filepath)}: OK`
                                : `${path.basename(filepath)}: ${result.errors.length} errors`
                        });
                    }
                }
                break;

            case 'compile':
                // Compile would need more context (top module, etc.)
                // Skip for now
                break;
        }
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    private isSystemVerilogFile(filepath: string): boolean {
        const ext = path.extname(filepath).toLowerCase();
        return ['.sv', '.svh', '.v', '.vh'].includes(ext);
    }

    private getWatchedCount(): number {
        if (!this.watcher) return 0;
        const watched = this.watcher.getWatched();
        let count = 0;
        for (const files of Object.values(watched)) {
            count += files.filter(f => this.isSystemVerilogFile(f)).length;
        }
        return count;
    }

    /**
     * Get current watch state
     */
    getState(): WatchState {
        return { ...this.state };
    }

    /**
     * Update configuration
     */
    updateConfig(updates: Partial<WatchConfig>): void {
        const wasWatching = this.state.watching;
        
        if (wasWatching) {
            this.stop();
        }

        this.config = { ...this.config, ...updates };

        if (wasWatching) {
            this.start();
        }
    }

    /**
     * Add a pattern to watch
     */
    addPattern(pattern: string): void {
        if (!this.config.patterns.includes(pattern)) {
            this.config.patterns.push(pattern);
            if (this.watcher) {
                const fullPath = path.isAbsolute(pattern)
                    ? pattern
                    : path.join(this.rootPath, pattern);
                this.watcher.add(fullPath);
            }
        }
    }

    /**
     * Remove a pattern
     */
    removePattern(pattern: string): void {
        const index = this.config.patterns.indexOf(pattern);
        if (index > -1) {
            this.config.patterns.splice(index, 1);
            if (this.watcher) {
                const fullPath = path.isAbsolute(pattern)
                    ? pattern
                    : path.join(this.rootPath, pattern);
                this.watcher.unwatch(fullPath);
            }
        }
    }
}

