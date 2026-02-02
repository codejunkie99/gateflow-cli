/**
 * Tool Context
 * Shared dependencies passed into tool executors.
 */

import type { EventBus } from '../../events/index.js';
import type { PolicyEngine } from '../../approval/index.js';
import type { FileTools, EditTools } from '../../fileops/index.js';
import type { SVIndexerAdapter } from '../../indexer/sv-indexer-adapter.js';
import type { DiffEngine } from '../../diff/index.js';
import type { Verilator } from '../../verification/verilator.js';
import type {
    ToolRegistry,
    ContextFileManager,
    TerminalSessionManager,
    DynamicContextManager,
    FileChunker,
    TokenBudgetManager
} from '../../context/index.js';
import type { MemoryManager, KnowledgeStore, MemoryService } from '../../memory/index.js';
import type { SkillRegistry } from '../../skills/index.js';
import type { MCPToolSync } from '../../mcp/index.js';
import type { InputManager } from '../../ui/index.js';

export interface ToolContext {
    bus: EventBus;
    policy: PolicyEngine;
    fileTools: FileTools;
    editTools: EditTools;
    indexer: SVIndexerAdapter;
    diffEngine: DiffEngine;
    verilator?: Verilator;
    projectRoot: string;
    dryRun: boolean;
    autoApprove: boolean;
    // Dynamic context discovery (optional for backwards compatibility)
    toolRegistry?: ToolRegistry;
    contextFileManager?: ContextFileManager;
    terminalSessionManager?: TerminalSessionManager;
    sessionId?: string;
    // Unified memory service (preferred) - provides token-budgeted context injection
    memoryService?: MemoryService;
    // Legacy accessors (for backward compatibility with tool executors)
    memoryManager?: MemoryManager;
    knowledgeStore?: KnowledgeStore;
    // Skills and MCP integration
    skillRegistry?: SkillRegistry;
    mcpToolSync?: MCPToolSync;
    // Centralized input manager
    inputManager?: InputManager;
    // Phase 2: Context Window Management (Cursor's Dynamic Context Discovery)
    dynamicContextManager?: DynamicContextManager;
    fileChunker?: FileChunker;
    tokenBudgetManager?: TokenBudgetManager;
    // Continuation tracking for multi-step agent loops
    onContinuationCheckpoint?: (checkpoint: {
        completedTasks: string[];
        remainingTasks: string[];
        partialResults: string;
        notes: string;
    }) => void;
    continuationState?: {
        currentStep: number;
        warningStep: number;
        criticalStep: number;
        stepLimit: number;
    };
}
