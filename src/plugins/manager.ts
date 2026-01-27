/**
 * GateFlow Plugin Manager
 * Manages plugin lifecycle and hook execution
 */

import type { EventBus } from '../events/bus.js';
import type { GateFlowError } from '../error/types.js';
import {
    type GateFlowPlugin,
    type PluginContext,
    type PluginLogger,
    type PluginRegistry,
    type PluginLoadConfig,
    type PluginManagerConfig,
    type ToolCallHookResult,
    type ErrorHookResult,
    type AgentMessage,
    type StepResult,
    type SessionSummary,
    isToolCallHookResult,
    isErrorHookResult,
} from './types.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: PluginManagerConfig = {
    plugins: [],
    failOnError: false,
    hookTimeout: 5000, // 5 seconds
};

// ============================================================================
// Plugin Manager Implementation
// ============================================================================

export class PluginManager implements PluginRegistry {
    private plugins: Map<string, GateFlowPlugin> = new Map();
    private pluginStates: Map<string, Record<string, unknown>> = new Map();
    private pluginConfigs: Map<string, Record<string, unknown>> = new Map();
    private initialized: boolean = false;
    private config: PluginManagerConfig;
    private context: PluginContext | null = null;

    constructor(
        private bus: EventBus,
        private projectRoot: string,
        config?: Partial<PluginManagerConfig>
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Plugin Registration
    // ========================================================================

    /**
     * Register a plugin
     */
    register(plugin: GateFlowPlugin, pluginConfig?: Record<string, unknown>): void {
        if (this.plugins.has(plugin.name)) {
            throw new Error(`Plugin '${plugin.name}' is already registered`);
        }

        this.plugins.set(plugin.name, plugin);
        this.pluginStates.set(plugin.name, {});
        if (pluginConfig) {
            this.pluginConfigs.set(plugin.name, pluginConfig);
        }
    }

    /**
     * Unregister a plugin
     */
    async unregister(name: string): Promise<void> {
        const plugin = this.plugins.get(name);
        if (plugin?.cleanup) {
            await this.safeCall(() => plugin.cleanup!());
        }
        this.plugins.delete(name);
        this.pluginStates.delete(name);
        this.pluginConfigs.delete(name);
    }

    /**
     * Get a registered plugin
     */
    get(name: string): GateFlowPlugin | undefined {
        return this.plugins.get(name);
    }

    /**
     * Check if a plugin is registered
     */
    has(name: string): boolean {
        return this.plugins.has(name);
    }

    /**
     * List all registered plugin names
     */
    list(): string[] {
        return [...this.plugins.keys()];
    }

    // ========================================================================
    // Lifecycle Management
    // ========================================================================

    /**
     * Initialize all plugins
     */
    async initialize(sessionId: string): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Create the shared context
        this.context = this.createContext(sessionId);

        // Sort plugins by priority
        const sortedPlugins = this.getSortedPlugins();

        // Initialize each plugin
        for (const plugin of sortedPlugins) {
            if (plugin.initialize) {
                const pluginContext = this.getPluginContext(plugin.name);
                await this.safeCall(
                    () => plugin.initialize!(pluginContext),
                    `Plugin '${plugin.name}' initialization failed`
                );
            }
        }

        this.initialized = true;
    }

    /**
     * Cleanup all plugins
     */
    async cleanup(): Promise<void> {
        const sortedPlugins = this.getSortedPlugins().reverse(); // Cleanup in reverse order

        for (const plugin of sortedPlugins) {
            if (plugin.cleanup) {
                await this.safeCall(
                    () => plugin.cleanup!(),
                    `Plugin '${plugin.name}' cleanup failed`
                );
            }
        }

        this.initialized = false;
        this.context = null;
    }

    // ========================================================================
    // Hook Execution
    // ========================================================================

    /**
     * Execute onToolCall hooks
     * Returns the first blocking result, or allows the call to proceed
     */
    async onToolCall(
        toolName: string,
        input: unknown
    ): Promise<ToolCallHookResult> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onToolCall) {
                const pluginContext = this.getPluginContext(plugin.name);
                const result = await this.safeCall(
                    () => plugin.onToolCall!(toolName, input, pluginContext),
                    `Plugin '${plugin.name}' onToolCall hook failed`
                );

                if (isToolCallHookResult(result) && !result.proceed) {
                    return result;
                }

                // If the hook modified the input, use the modified version
                if (isToolCallHookResult(result) && result.modifiedInput !== undefined) {
                    input = result.modifiedInput;
                }
            }
        }

        return { proceed: true, modifiedInput: input };
    }

    /**
     * Execute onToolResult hooks
     */
    async onToolResult(toolName: string, result: unknown): Promise<void> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onToolResult) {
                const pluginContext = this.getPluginContext(plugin.name);
                await this.safeCall(
                    () => plugin.onToolResult!(toolName, result, pluginContext),
                    `Plugin '${plugin.name}' onToolResult hook failed`
                );
            }
        }
    }

    /**
     * Execute onMessage hooks
     */
    async onMessage(message: AgentMessage): Promise<void> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onMessage) {
                const pluginContext = this.getPluginContext(plugin.name);
                await this.safeCall(
                    () => plugin.onMessage!(message, pluginContext),
                    `Plugin '${plugin.name}' onMessage hook failed`
                );
            }
        }
    }

    /**
     * Execute onError hooks
     * Returns the first handled result
     */
    async onError(error: GateFlowError | Error): Promise<ErrorHookResult | null> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onError) {
                const pluginContext = this.getPluginContext(plugin.name);
                const result = await this.safeCall(
                    () => plugin.onError!(error, pluginContext),
                    `Plugin '${plugin.name}' onError hook failed`
                );

                if (isErrorHookResult(result) && result.handled) {
                    return result;
                }
            }
        }

        return null;
    }

    /**
     * Execute onStepStart hooks
     */
    async onStepStart(stepNumber: number): Promise<void> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onStepStart) {
                const pluginContext = this.getPluginContext(plugin.name);
                await this.safeCall(
                    () => plugin.onStepStart!(stepNumber, pluginContext),
                    `Plugin '${plugin.name}' onStepStart hook failed`
                );
            }
        }
    }

    /**
     * Execute onStepFinish hooks
     */
    async onStepFinish(stepNumber: number, stepResult: StepResult): Promise<void> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onStepFinish) {
                const pluginContext = this.getPluginContext(plugin.name);
                await this.safeCall(
                    () => plugin.onStepFinish!(stepNumber, stepResult, pluginContext),
                    `Plugin '${plugin.name}' onStepFinish hook failed`
                );
            }
        }
    }

    /**
     * Execute onSessionStart hooks
     */
    async onSessionStart(sessionId: string): Promise<void> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onSessionStart) {
                const pluginContext = this.getPluginContext(plugin.name);
                await this.safeCall(
                    () => plugin.onSessionStart!(sessionId, pluginContext),
                    `Plugin '${plugin.name}' onSessionStart hook failed`
                );
            }
        }
    }

    /**
     * Execute onSessionEnd hooks
     */
    async onSessionEnd(sessionId: string, summary: SessionSummary): Promise<void> {
        const sortedPlugins = this.getSortedPlugins();

        for (const plugin of sortedPlugins) {
            if (plugin.onSessionEnd) {
                const pluginContext = this.getPluginContext(plugin.name);
                await this.safeCall(
                    () => plugin.onSessionEnd!(sessionId, summary, pluginContext),
                    `Plugin '${plugin.name}' onSessionEnd hook failed`
                );
            }
        }
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private createContext(sessionId: string): PluginContext {
        return {
            sessionId,
            bus: this.bus,
            projectRoot: this.projectRoot,
            state: {},
            log: this.createLogger('PluginManager'),
            plugins: this,
            config: {},
        };
    }

    private getPluginContext(pluginName: string): PluginContext {
        if (!this.context) {
            throw new Error('Plugin manager not initialized');
        }

        return {
            ...this.context,
            state: this.pluginStates.get(pluginName) ?? {},
            log: this.createLogger(pluginName),
            config: this.pluginConfigs.get(pluginName) ?? {},
        };
    }

    private createLogger(name: string): PluginLogger {
        return {
            debug: (message, data) => {
                if (process.env.DEBUG) {
                    console.debug(`[${name}] ${message}`, data ?? '');
                }
            },
            info: (message, data) => {
                console.log(`[${name}] ${message}`, data ?? '');
            },
            warn: (message, data) => {
                console.warn(`[${name}] ${message}`, data ?? '');
            },
            error: (message, error, data) => {
                console.error(`[${name}] ${message}`, error ?? '', data ?? '');
            },
        };
    }

    private getSortedPlugins(): GateFlowPlugin[] {
        return [...this.plugins.values()].sort(
            (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
        );
    }

    private async safeCall<T>(
        fn: () => Promise<T> | T,
        errorMessage?: string
    ): Promise<T | undefined> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
            // Add timeout with cleanup to prevent timer leak
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(
                    () => reject(new Error('Hook execution timed out')),
                    this.config.hookTimeout
                );
            });

            const result = await Promise.race([
                Promise.resolve(fn()),
                timeoutPromise,
            ]);

            return result;
        } catch (error) {
            const message = errorMessage ?? 'Plugin hook failed';
            console.error(message, error);

            if (this.config.failOnError) {
                throw error;
            }

            return undefined;
        } finally {
            // Always clear the timeout to prevent memory leaks
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
        }
    }
}

// ============================================================================
// Global Plugin Manager
// ============================================================================

let globalPluginManager: PluginManager | null = null;

/**
 * Initialize the global plugin manager
 */
export function initPluginManager(
    bus: EventBus,
    projectRoot: string,
    config?: Partial<PluginManagerConfig>
): PluginManager {
    globalPluginManager = new PluginManager(bus, projectRoot, config);
    return globalPluginManager;
}

/**
 * Get the global plugin manager
 */
export function getPluginManager(): PluginManager | null {
    return globalPluginManager;
}

/**
 * Reset the global plugin manager
 */
export async function resetPluginManager(): Promise<void> {
    if (globalPluginManager) {
        await globalPluginManager.cleanup();
        globalPluginManager = null;
    }
}
