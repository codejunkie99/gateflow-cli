/**
 * File Watcher
 * Watch for file changes and trigger actions
 */
import chokidar from 'chokidar';
import path from 'path';
// ============================================================================
// Watch Manager
// ============================================================================
export class WatchManager {
    rootPath;
    bus;
    indexer;
    verilator;
    config;
    watcher = null;
    state;
    pendingChanges = new Map();
    debounceTimer = null;
    processing = false;
    constructor(rootPath, bus, indexer, verilator, config) {
        this.rootPath = rootPath;
        this.bus = bus;
        this.indexer = indexer;
        this.verilator = verilator;
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
    start() {
        if (this.watcher) {
            return; // Already watching
        }
        const watchPaths = this.config.patterns.map(p => path.isAbsolute(p) ? p : path.join(this.rootPath, p));
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
    async stop() {
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
    handleChange(filepath, type) {
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
    async processChanges() {
        if (this.processing) {
            // Reschedule if we're already processing
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
        }
        catch (error) {
            this.bus.emit({
                type: 'error',
                message: `Watch action failed: ${error}`,
                recoverable: true
            });
        }
        finally {
            this.processing = false;
        }
    }
    /**
     * Run a watch action
     */
    async runAction(action, files) {
        switch (action) {
            case 'index':
                for (const [filepath, change] of files) {
                    await this.indexer.updateFile(filepath, change.type);
                }
                break;
            case 'lint':
                if (!this.verilator)
                    break;
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
    isSystemVerilogFile(filepath) {
        const ext = path.extname(filepath).toLowerCase();
        return ['.sv', '.svh', '.v', '.vh'].includes(ext);
    }
    getWatchedCount() {
        if (!this.watcher)
            return 0;
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
    getState() {
        return { ...this.state };
    }
    /**
     * Update configuration
     */
    updateConfig(updates) {
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
    addPattern(pattern) {
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
    removePattern(pattern) {
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
