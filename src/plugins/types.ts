/**
 * GateFlow Plugin System Types
 * Following Claude Agent SDK plugin pattern with lifecycle hooks
 */

import type { EventBus } from '../events/bus.js';
import type { GateFlowError } from '../error/types.js';

// ============================================================================
// Plugin Interface
// ============================================================================

/**
 * GateFlow plugin interface following Claude Agent SDK pattern
 * Plugins can hook into the agent lifecycle for customization
 */
export interface GateFlowPlugin {
    /** Unique plugin name */
    name: string;
    /** Plugin version (semver) */
    version: string;
    /** Optional plugin description */
    description?: string;
    /** Plugin priority (lower = runs first) */
    priority?: number;

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    /**
     * Called when the plugin is initialized
     * Use this for setup, resource allocation, etc.
     */
    initialize?: (context: PluginContext) => Promise<void>;

    /**
     * Called before a tool is executed
     * Can modify input or cancel the tool call
     */
    onToolCall?: (
        toolName: string,
        input: unknown,
        context: PluginContext
    ) => Promise<ToolCallHookResult | void>;

    /**
     * Called after a tool completes
     * Can modify or inspect the result
     */
    onToolResult?: (
        toolName: string,
        result: unknown,
        context: PluginContext
    ) => Promise<void>;

    /**
     * Called when an agent message is generated
     * Can inspect or modify the message
     */
    onMessage?: (
        message: AgentMessage,
        context: PluginContext
    ) => Promise<void>;

    /**
     * Called when an error occurs
     * Can implement custom error handling or recovery
     */
    onError?: (
        error: GateFlowError | Error,
        context: PluginContext
    ) => Promise<ErrorHookResult | void>;

    /**
     * Called before each agent step
     */
    onStepStart?: (
        stepNumber: number,
        context: PluginContext
    ) => Promise<void>;

    /**
     * Called after each agent step completes
     */
    onStepFinish?: (
        stepNumber: number,
        stepResult: StepResult,
        context: PluginContext
    ) => Promise<void>;

    /**
     * Called when the agent session starts
     */
    onSessionStart?: (
        sessionId: string,
        context: PluginContext
    ) => Promise<void>;

    /**
     * Called when the agent session ends
     */
    onSessionEnd?: (
        sessionId: string,
        summary: SessionSummary,
        context: PluginContext
    ) => Promise<void>;

    /**
     * Called when the plugin is being cleaned up
     * Use this for resource cleanup, flushing buffers, etc.
     */
    cleanup?: () => Promise<void>;
}

// ============================================================================
// Plugin Context
// ============================================================================

/**
 * Context provided to plugin hooks
 */
export interface PluginContext {
    /** Current session ID */
    sessionId: string;
    /** Event bus for emitting events */
    bus: EventBus;
    /** Project root directory */
    projectRoot: string;
    /** Plugin-specific state storage */
    state: Record<string, unknown>;
    /** Logger for the plugin */
    log: PluginLogger;
    /** Access to other plugins */
    plugins: PluginRegistry;
    /** Configuration */
    config: Record<string, unknown>;
}

/**
 * Simple logger interface for plugins
 */
export interface PluginLogger {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, error?: Error, data?: Record<string, unknown>): void;
}

/**
 * Plugin registry interface
 */
export interface PluginRegistry {
    get(name: string): GateFlowPlugin | undefined;
    has(name: string): boolean;
    list(): string[];
}

// ============================================================================
// Hook Results
// ============================================================================

/**
 * Result from onToolCall hook
 */
export interface ToolCallHookResult {
    /** Whether to proceed with the tool call */
    proceed: boolean;
    /** Modified input (if proceed is true) */
    modifiedInput?: unknown;
    /** Reason for blocking (if proceed is false) */
    blockReason?: string;
}

/**
 * Result from onError hook
 */
export interface ErrorHookResult {
    /** Whether the error was handled */
    handled: boolean;
    /** Whether to retry the operation */
    retry: boolean;
    /** Delay before retry (ms) */
    retryDelay?: number;
    /** Modified error to re-throw */
    modifiedError?: Error;
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Agent message type
 */
export type AgentMessageType =
    | 'assistant'
    | 'user'
    | 'system'
    | 'tool_call'
    | 'tool_result';

/**
 * Agent message
 */
export interface AgentMessage {
    type: AgentMessageType;
    content: string | unknown;
    timestamp: number;
    metadata?: Record<string, unknown>;
}

// ============================================================================
// Step and Session Types
// ============================================================================

/**
 * Result of an agent step
 */
export interface StepResult {
    /** Step number */
    stepNumber: number;
    /** Tools called in this step */
    toolsCalled: string[];
    /** Whether the step was successful */
    success: boolean;
    /** Error if step failed */
    error?: Error;
    /** Duration of the step (ms) */
    durationMs: number;
    /** Tokens used in this step */
    tokensUsed?: number;
}

/**
 * Summary of an agent session
 */
export interface SessionSummary {
    /** Session ID */
    sessionId: string;
    /** Total duration (ms) */
    durationMs: number;
    /** Total steps executed */
    totalSteps: number;
    /** Total tool calls made */
    totalToolCalls: number;
    /** Whether the session was successful */
    success: boolean;
    /** Final error if failed */
    error?: Error;
    /** Total tokens used */
    tokensUsed?: number;
}

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * Configuration for loading plugins
 */
export interface PluginLoadConfig {
    /** Plugin to load */
    plugin: GateFlowPlugin;
    /** Plugin-specific configuration */
    config?: Record<string, unknown>;
    /** Whether the plugin is enabled */
    enabled?: boolean;
}

/**
 * Plugin manager configuration
 */
export interface PluginManagerConfig {
    /** Plugins to load */
    plugins: PluginLoadConfig[];
    /** Whether to fail on plugin errors */
    failOnError: boolean;
    /** Default plugin timeout (ms) */
    hookTimeout: number;
}

// ============================================================================
// Built-in Plugin Types
// ============================================================================

/**
 * Analytics plugin state
 */
export interface AnalyticsPluginState {
    callCount: number;
    startTime: number;
    toolCounts: Record<string, number>;
    errorCounts: Record<string, number>;
    totalTokens: number;
}

/**
 * Rate limiter plugin state
 */
export interface RateLimiterPluginState {
    callCount: number;
    lastReset: number;
    maxCalls: number;
    windowMs: number;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isGateFlowPlugin(obj: unknown): obj is GateFlowPlugin {
    if (!obj || typeof obj !== 'object') return false;
    const plugin = obj as Record<string, unknown>;
    return (
        typeof plugin.name === 'string' &&
        typeof plugin.version === 'string'
    );
}

export function isToolCallHookResult(obj: unknown): obj is ToolCallHookResult {
    if (!obj || typeof obj !== 'object') return false;
    const result = obj as Record<string, unknown>;
    return typeof result.proceed === 'boolean';
}

export function isErrorHookResult(obj: unknown): obj is ErrorHookResult {
    if (!obj || typeof obj !== 'object') return false;
    const result = obj as Record<string, unknown>;
    return typeof result.handled === 'boolean';
}
