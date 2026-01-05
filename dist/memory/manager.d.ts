/**
 * Memory Manager
 * Persistent project context with atomic writes and locking
 */
import type { EventBus } from '../events/index.js';
import type { ApprovalGrant } from '../policy/index.js';
export interface ProjectMemory {
    version: number;
    projectId: string;
    projectPath: string;
    approvals: ApprovalGrant[];
    context: {
        projectSummary?: string;
        recentFiles: string[];
        moduleNotes: Record<string, string>;
    };
    history: ConversationSummary[];
    preferences: {
        autoApprove: boolean;
        lintOnSave: boolean;
        theme?: string;
    };
    created: number;
    lastAccess: number;
}
export interface ConversationSummary {
    id: string;
    timestamp: number;
    summary: string;
    filesModified: string[];
    exitCode: number;
}
export interface MemoryConfig {
    /** Directory for memory files */
    memoryDir: string;
    /** Maximum conversation history to keep */
    maxHistory: number;
    /** Lock timeout in ms */
    lockTimeout: number;
}
export declare class MemoryManager {
    private projectRoot;
    private bus;
    private config;
    private memory;
    private projectId;
    private memoryPath;
    private lockPath;
    private lockAcquired;
    constructor(projectRoot: string, bus: EventBus, config?: Partial<MemoryConfig>);
    /**
     * Load memory from disk
     */
    load(): Promise<ProjectMemory>;
    /**
     * Save memory to disk (atomic)
     */
    save(): Promise<void>;
    /**
     * Acquire lock for exclusive access
     */
    acquireLock(): Promise<boolean>;
    /**
     * Release lock
     */
    releaseLock(): Promise<void>;
    /**
     * Check if lock is stale (process died)
     */
    private isLockStale;
    /**
     * Add a conversation summary
     */
    addConversation(summary: Omit<ConversationSummary, 'id'>): void;
    /**
     * Update project context
     */
    updateContext(updates: Partial<ProjectMemory['context']>): void;
    /**
     * Add a recent file
     */
    addRecentFile(filePath: string): void;
    /**
     * Add a module note
     */
    addModuleNote(moduleName: string, note: string): void;
    /**
     * Get approvals
     */
    getApprovals(): ApprovalGrant[];
    /**
     * Add approval
     */
    addApproval(approval: ApprovalGrant): void;
    /**
     * Clear session approvals
     */
    clearSessionApprovals(): void;
    /**
     * Get memory for AI context
     */
    getContextForAI(): string;
    private createDefaultMemory;
    private migrate;
    /**
     * Get current memory (or null if not loaded)
     */
    getMemory(): ProjectMemory | null;
    /**
     * Get project ID
     */
    getProjectId(): string;
}
