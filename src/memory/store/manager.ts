/**
 * Memory Manager
 * Persistent project context with atomic writes and locking
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import type { EventBus } from '../../events/index.js';
import type { ApprovalGrant } from '../../approval/index.js';
import { AsyncMutex } from '../../concurrency/index.js';
import { FileLockManager } from '../file-lock.js';
import { ArchiveManager } from './conversation-archive.js';
import type {
    ProjectMemory,
    ConversationSummary,
    MemoryConfig,
    ChatHistoryFile,
    RelevantMessage,
    ArchivedSession,
    SummarizationResult,
    Message
} from './memory.types.js';

// ============================================================================
// Memory Manager
// ============================================================================

export class MemoryManager {
    private config: MemoryConfig;
    private memory: ProjectMemory | null = null;
    private projectId: string;
    private memoryPath: string;
    private lockPath: string;
    private lockManager: FileLockManager;
    private ioMutex = new AsyncMutex();
    private dirty: boolean = false;
    private revision: number = 0;
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DEBOUNCE_MS = 5000;
    private archiveManager: ArchiveManager;

    constructor(
        private projectRoot: string,
        private bus: EventBus,
        config?: Partial<MemoryConfig>
    ) {
        // Generate project ID from path
        this.projectId = crypto
            .createHash('md5')
            .update(path.resolve(projectRoot))
            .digest('hex')
            .slice(0, 12);

        this.config = {
            memoryDir: config?.memoryDir ?? path.join(os.homedir(), '.gateflow'),
            maxHistory: config?.maxHistory ?? 50,
            lockTimeout: config?.lockTimeout ?? 5000,
            archiveThreshold: config?.archiveThreshold ?? 10,
            keepRecentMessages: config?.keepRecentMessages ?? 4
        };

        this.memoryPath = path.join(this.config.memoryDir, `${this.projectId}.json`);
        this.lockPath = path.join(this.config.memoryDir, `${this.projectId}.lock`);
        this.lockManager = new FileLockManager(this.lockPath, {
            lockTimeout: this.config.lockTimeout
        });

        // Initialize archive manager
        this.archiveManager = new ArchiveManager(this.projectId, this.config, this.bus);
    }

    // ========================================================================
    // Load / Save
    // ========================================================================

    /**
     * Load memory from disk
     */
    async load(): Promise<ProjectMemory> {
        return this.ioMutex.withLock(async () => {
            await fs.mkdir(this.config.memoryDir, { recursive: true });

            try {
                const content = await fs.readFile(this.memoryPath, 'utf-8');
                this.memory = JSON.parse(content) as ProjectMemory;
                this.memory.lastAccess = Date.now();
                this.memory = this.migrate(this.memory);
                return this.memory;
            } catch (error: any) {
                if (error?.code !== 'ENOENT') {
                    console.warn('[MemoryManager] Failed to load memory, using defaults:', error);
                }
                this.memory = this.createDefaultMemory();
                return this.memory;
            }
        });
    }

    /**
     * Save memory to disk (atomic)
     */
    async save(): Promise<void> {
        return this.ioMutex.withLock(async () => {
            if (!this.memory || !this.dirty) return;

            const saveRevision = this.revision;
            const acquired = await this.acquireLock();
            if (!acquired) {
                throw new Error(`Failed to acquire memory lock: ${this.lockPath}`);
            }

            try {
                // Atomic write: write to temp, then rename
                const tempPath = `${this.memoryPath}.${Date.now()}.tmp`;
                const payload = JSON.stringify(this.memory, null, 2);

                try {
                    await fs.writeFile(
                        tempPath,
                        payload,
                        'utf-8'
                    );

                    await fs.rename(tempPath, this.memoryPath);
                    if (this.revision === saveRevision) {
                        this.dirty = false;
                    }

                    this.bus.emit({
                        type: 'memory_saved',
                        path: this.memoryPath,
                        size: Buffer.byteLength(payload, 'utf-8')
                    });

                } catch (error) {
                    try {
                        await fs.unlink(tempPath);
                    } catch {
                        // Temp file may not exist - safe to ignore
                    }
                    throw error;
                }
            } finally {
                await this.releaseLock();
            }
        });
    }

    // ========================================================================
    // Locking
    // ========================================================================

    /**
     * Acquire lock for exclusive access
     */
    private async acquireLock(): Promise<boolean> {
        return this.lockManager.acquire();
    }

    /**
     * Release lock
     */
    private async releaseLock(): Promise<void> {
        await this.lockManager.release();
    }

    /**
     * Schedule a debounced save operation
     */
    private scheduleSave(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }

        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;

            // save() acquires ioMutex internally, so we must not hold it here
            if (!this.dirty) {
                return;
            }

            // Retry logic with exponential backoff
            const delays = [1000, 2000, 4000]; // 1s, 2s, 4s
            let lastError: unknown;

            for (let attempt = 0; attempt <= delays.length; attempt++) {
                try {
                    await this.save();
                    return; // Success
                } catch (error) {
                    lastError = error;
                    if (attempt < delays.length) {
                        console.warn(`Auto-save failed (attempt ${attempt + 1}/${delays.length + 1}), retrying in ${delays[attempt]}ms:`, error);
                        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                    }
                }
            }

            console.error('Auto-save failed after all retries:', lastError);
        }, this.SAVE_DEBOUNCE_MS);
    }

    /**
     * Cancel pending save and save immediately if dirty
     */
    async flush(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        if (this.dirty) {
            await this.save();
        }
    }

    // ========================================================================
    // Memory Operations
    // ========================================================================

    /**
     * Add a conversation summary
     */
    addConversation(summary: Omit<ConversationSummary, 'id'>): void {
        if (!this.memory) return;

        const conversation: ConversationSummary = {
            id: crypto.randomUUID(),
            ...summary
        };

        this.memory.history.unshift(conversation);

        if (this.memory.history.length > this.config.maxHistory) {
            this.memory.history = this.memory.history.slice(0, this.config.maxHistory);
        }

        this.markDirty();
    }

    /**
     * Update project context
     */
    updateContext(updates: Partial<ProjectMemory['context']>): void {
        if (!this.memory) return;
        this.memory.context = { ...this.memory.context, ...updates };
        this.markDirty();
    }

    /**
     * Add a recent file
     */
    addRecentFile(filePath: string): void {
        if (!this.memory) return;

        const relativePath = path.relative(this.projectRoot, filePath);

        const existing = this.memory.context.recentFiles.indexOf(relativePath);
        if (existing > -1) {
            this.memory.context.recentFiles.splice(existing, 1);
        }

        this.memory.context.recentFiles.unshift(relativePath);

        if (this.memory.context.recentFiles.length > 20) {
            this.memory.context.recentFiles = this.memory.context.recentFiles.slice(0, 20);
        }

        this.markDirty();
    }

    /**
     * Add a module note
     */
    addModuleNote(moduleName: string, note: string): void {
        if (!this.memory) return;
        this.memory.context.moduleNotes[moduleName] = note;
        this.markDirty();
    }

    /**
     * Get approvals
     */
    getApprovals(): ApprovalGrant[] {
        return this.memory?.approvals ?? [];
    }

    /**
     * Add approval
     */
    addApproval(approval: ApprovalGrant): void {
        if (!this.memory) return;
        this.memory.approvals.push(approval);
        this.markDirty();
    }

    /**
     * Clear session approvals
     */
    clearSessionApprovals(): void {
        if (!this.memory) return;
        this.memory.approvals = this.memory.approvals.filter(
            a => a.scope === 'project'
        );
        this.markDirty();
    }

    /**
     * Get memory for AI context
     */
    getContextForAI(): string {
        if (!this.memory) return '';

        const parts: string[] = [];

        if (this.memory.context.projectSummary) {
            parts.push(`Project: ${this.memory.context.projectSummary}`);
        }

        if (this.memory.context.recentFiles.length > 0) {
            parts.push(`Recent files: ${this.memory.context.recentFiles.slice(0, 5).join(', ')}`);
        }

        const notes = Object.entries(this.memory.context.moduleNotes);
        if (notes.length > 0) {
            parts.push('Module notes:');
            for (const [mod, note] of notes.slice(0, 5)) {
                parts.push(`  ${mod}: ${note}`);
            }
        }

        if (this.memory.history.length > 0) {
            parts.push('Recent sessions:');
            for (const conv of this.memory.history.slice(0, 3)) {
                const date = new Date(conv.timestamp).toLocaleDateString();
                parts.push(`  ${date}: ${conv.summary}`);
            }
        }

        return parts.join('\n');
    }

    /**
     * Get current memory
     */
    getMemory(): ProjectMemory | null {
        return this.memory;
    }

    /**
     * Get project ID
     */
    getProjectId(): string {
        return this.projectId;
    }

    // ========================================================================
    // Archive Delegation (delegates to ArchiveManager)
    // ========================================================================

    async archiveConversation(
        sessionId: string,
        messages: Message[],
        summary: string
    ): Promise<ChatHistoryFile> {
        return this.archiveManager.archiveConversation(sessionId, messages, summary);
    }

    async triggerSummarization(
        sessionId: string,
        messages: Message[],
        options?: {
            tokenThreshold?: number;
            messageThreshold?: number;
            keepRecent?: number;
        }
    ): Promise<SummarizationResult> {
        return this.archiveManager.triggerSummarization(sessionId, messages, options);
    }

    async queryArchivedHistory(
        sessionId: string | null,
        query: string
    ): Promise<RelevantMessage[]> {
        return this.archiveManager.queryArchivedHistory(sessionId, query);
    }

    async getArchivedTurn(
        sessionId: string,
        turnNumber: number
    ): Promise<Array<{ role: string; content: string }>> {
        return this.archiveManager.getArchivedTurn(sessionId, turnNumber);
    }

    async listArchivedSessions(): Promise<ArchivedSession[]> {
        return this.archiveManager.listArchivedSessions();
    }

    async cleanupArchives(maxAgeMs?: number): Promise<number> {
        return this.archiveManager.cleanupArchives(maxAgeMs);
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private markDirty(): void {
        this.dirty = true;
        this.revision += 1;
        this.scheduleSave();
    }

    private createDefaultMemory(): ProjectMemory {
        return {
            version: 1,
            projectId: this.projectId,
            projectPath: this.projectRoot,
            approvals: [],
            context: {
                recentFiles: [],
                moduleNotes: {}
            },
            history: [],
            preferences: {
                autoApprove: false,
                lintOnSave: true
            },
            created: Date.now(),
            lastAccess: Date.now()
        };
    }

    private migrate(memory: ProjectMemory): ProjectMemory {
        return {
            ...this.createDefaultMemory(),
            ...memory,
            context: {
                ...this.createDefaultMemory().context,
                ...memory.context
            },
            preferences: {
                ...this.createDefaultMemory().preferences,
                ...memory.preferences
            }
        };
    }
}

// Re-export types for convenience
export type {
    ProjectMemory,
    ConversationSummary,
    MemoryConfig,
    ChatHistoryFile,
    RelevantMessage,
    ArchivedSession,
    SummarizationResult
} from './memory.types.js';
