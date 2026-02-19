/**
 * Context Management Module
 *
 * Context optimization strategies:
 * 1. Long Tool Responses as Files - 30-40% for verification sessions
 * 2. Terminal Sessions as Files - 10-20% reduction
 * 3. Token Budget Management - Pre-flight context estimation
 * 4. File Chunking - AST-based large file handling
 *
 * Note: SkillManager, ToolDescriptionManager, and SemanticSummarizer
 * were removed in favor of AI SDK 6 native features (pruneMessages,
 * prepareStep, contextWindowManager).
 */

// Types
;

;

// Tool Registry (Phase 1)
export { ToolRegistry, getToolRegistry } from './ToolRegistry.js';

// Context File Manager (Phase 2)
export { ContextFileManager, getContextFileManager } from './ContextFileManager.js';

// Terminal Session Manager (Phase 4)
export { TerminalSessionManager, getTerminalSessionManager } from './TerminalSessionManager.js';

// Token Budget Manager (Phase 2 - Dynamic Context Discovery)
export {
    TokenBudgetManager,
    
    createTokenBudgetManager,
    
    
    
    
    
    
    
    
} from './TokenBudgetManager.js';

// Dynamic Context Manager (Phase 2 - Patterns 1, 2, 5)
export {
    DynamicContextManager,
    
    createDynamicContextManager,
    
    
    
    
    
    
    
    
} from './DynamicContextManager.js';

// File Chunker (Phase 2 - Large File Handling)
export {
    FileChunker,
    
    createFileChunker,
    
    
    
    
    
    
    
    
} from './FileChunker.js';
