/**
 * Dynamic Context Discovery Module
 *
 * Implements Cursor's context optimization strategies:
 * 1. Tool Description Optimization - ~46% token reduction
 * 2. Long Tool Responses as Files - 30-40% for verification sessions
 * 3. Terminal Sessions as Files - 10-20% reduction
 *
 * Core principle: Files as the universal context primitive
 */

// Types
export type {
    ContextFileRef,
    ReadOptions,
    FileSummary,
    ToolCategory,
    ToolDescription,
    ParameterDoc,
    ToolMatch,
    ChatHistoryFile,
    RelevantMessage,
    TerminalSession,
    TerminalSearchHit,
    ContextConfig
} from './types.js';

export { DEFAULT_CONTEXT_CONFIG } from './types.js';

// Tool Registry (Phase 1)
export { ToolRegistry, getToolRegistry } from './ToolRegistry.js';

// Context File Manager (Phase 2)
export { ContextFileManager, getContextFileManager } from './ContextFileManager.js';

// Terminal Session Manager (Phase 4)
export { TerminalSessionManager, getTerminalSessionManager } from './TerminalSessionManager.js';
