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

// Token Budget Manager (Phase 2 - Dynamic Context Discovery)
export {
    TokenBudgetManager,
    getTokenBudgetManager,
    createTokenBudgetManager,
    setGlobalTokenBudgetManager,
    MODEL_CONFIGS,
    type TokenBudget,
    type BudgetAllocation,
    type BudgetUsage,
    type TokenCountResult,
    type BudgetWarning,
    type TokenBudgetConfig
} from './TokenBudgetManager.js';

// Dynamic Context Manager (Phase 2 - Patterns 1, 2, 5)
export {
    DynamicContextManager,
    getDynamicContextManager,
    createDynamicContextManager,
    setGlobalDynamicContextManager,
    type ToolOutputRef,
    type GrepResult,
    type HistoryEntry,
    type HistorySearchResult,
    type ContextIndex,
    type ContextIndexEntry,
    type DynamicContextConfig
} from './DynamicContextManager.js';

// Tool Description Manager (Phase 2 - Pattern 4: 46.9% token reduction)
export {
    ToolDescriptionManager,
    getToolDescriptionManager,
    createToolDescriptionManager,
    setGlobalToolDescriptionManager,
    type ToolIndex,
    type ToolFileMeta,
    type ToolDescriptionManagerConfig
} from './ToolDescriptionManager.js';

// Skill Manager (Phase 2 - Pattern 3: Agent Skills)
export {
    SkillManager,
    getSkillManager,
    createSkillManager,
    setGlobalSkillManager,
    type Skill,
    type SkillIndexEntry,
    type SkillIndex,
    type SkillSearchResult,
    type SkillManagerConfig
} from './SkillManager.js';

// Semantic Summarizer (Phase 2 - Context Compaction)
export {
    SemanticSummarizer,
    getSemanticSummarizer,
    createSemanticSummarizer,
    setGlobalSemanticSummarizer,
    DEFAULT_IMPORTANCE_WEIGHTS,
    DEFAULT_TOOL_CLEARING,
    type Message,
    type MessageImportance,
    type ImportanceFactor,
    type ImportanceWeights,
    type ToolClearingOptions,
    type CompactionResult,
    type SemanticSummarizerConfig
} from './SemanticSummarizer.js';

// File Chunker (Phase 2 - Large File Handling)
export {
    FileChunker,
    getFileChunker,
    createFileChunker,
    setGlobalFileChunker,
    DEFAULT_CHUNKER_CONFIG,
    type FileChunk,
    type ChunkType,
    type FileChunkerConfig,
    type ChunkIndex,
    type ChunkSelection,
    type IndexerProvider
} from './FileChunker.js';
