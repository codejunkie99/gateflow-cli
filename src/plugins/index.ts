/**
 * GateFlow Plugin System
 * Claude Agent SDK-style plugin architecture
 */

// Types
export {
    type GateFlowPlugin,
    type PluginContext,
    type PluginLogger,
    type PluginRegistry,
    type ToolCallHookResult,
    type ErrorHookResult,
    type AgentMessage,
    type AgentMessageType,
    type StepResult,
    type SessionSummary,
    type PluginLoadConfig,
    type PluginManagerConfig,
    type AnalyticsPluginState,
    type RateLimiterPluginState,
    isGateFlowPlugin,
    isToolCallHookResult,
    isErrorHookResult,
} from './types.js';

// Manager
export {
    PluginManager,
    initPluginManager,
    getPluginManager,
    resetPluginManager,
} from './manager.js';
