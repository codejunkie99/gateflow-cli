/**
 * Memory Manager
 * Persistent project context with atomic writes and locking
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import type { EventBus } from '../events/index.js';
import type { ApprovalGrant } from '../approval/index.js';
import type { ChatHistoryFile, RelevantMessage } from '../context/types.js';

// ============================================================================
// Types
// ============================================================================

export interface ProjectMemory {
    version: number;
    projectId: string;
    projectPath: string;
    
    // Tool approvals
    approvals: ApprovalGrant[];
    
    // Project context (summaries, not raw content)
    context: {
        projectSummary?: string;
        recentFiles: string[];  // Paths only
        moduleNotes: Record<string, string>;  // module -> note
    };
    
    // Session history (conversation summaries)
    history: ConversationSummary[];
    
    // User preferences
    preferences: {
        autoApprove: boolean;
        lintOnSave: boolean;
        theme?: string;
    };
    
    // Metadata
    created: number;
    lastAccess: number;
}

export interface ConversationSummary {
    id: string;
    timestamp: number;
    summary: string;  // Brief description of what was done
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

// ============================================================================
// Memory Manager
// ============================================================================

export class MemoryManager {
    private config: MemoryConfig;
    private memory: ProjectMemory | null = null;
    private projectId: string;
    private memoryPath: string;
    private lockPath: string;
    private lockAcquired: boolean = false;

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
            lockTimeout: config?.lockTimeout ?? 5000
        };

        this.memoryPath = path.join(this.config.memoryDir, `${this.projectId}.json`);
        this.lockPath = path.join(this.config.memoryDir, `${this.projectId}.lock`);
    }

    // ========================================================================
    // Load / Save
    // ========================================================================

    /**
     * Load memory from disk
     */
    async load(): Promise<ProjectMemory> {
        // Ensure memory directory exists
        await fs.mkdir(this.config.memoryDir, { recursive: true });

        try {
            const content = await fs.readFile(this.memoryPath, 'utf-8');
            this.memory = JSON.parse(content) as ProjectMemory;
            
            // Update last access
            this.memory.lastAccess = Date.now();
            
            // Migrate if needed
            this.memory = this.migrate(this.memory);
            
            return this.memory;
        } catch (error) {
            // Create new memory
            this.memory = this.createDefaultMemory();
            return this.memory;
        }
    }

    /**
     * Save memory to disk (atomic)
     */
    async save(): Promise<void> {
        if (!this.memory) return;

        // Atomic write: write to temp, then rename
        const tempPath = `${this.memoryPath}.${Date.now()}.tmp`;

        try {
            await fs.writeFile(
                tempPath,
                JSON.stringify(this.memory, null, 2),
                'utf-8'
            );

            // Rename (atomic on most filesystems)
            await fs.rename(tempPath, this.memoryPath);

            this.bus.emit({
                type: 'memory_saved',
                path: this.memoryPath,
                size: JSON.stringify(this.memory).length
            });

        } catch (error) {
            // Clean up temp file if it exists
            try {
                await fs.unlink(tempPath);
            } catch {
                // Temp file may not exist or already cleaned up - safe to ignore
            }

            throw error;
        }
    }

    // ========================================================================
    // Locking
    // ========================================================================

    /**
     * Acquire lock for exclusive access
     */
    async acquireLock(): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < this.config.lockTimeout) {
            try {
                // Try to create lock file (fails if exists)
                await fs.writeFile(
                    this.lockPath,
                    JSON.stringify({ pid: process.pid, time: Date.now() }),
                    { flag: 'wx' }
                );
                this.lockAcquired = true;
                return true;
            } catch (error: any) {
                if (error.code === 'EEXIST') {
                    // Lock exists - check if stale
                    if (await this.isLockStale()) {
                        await fs.unlink(this.lockPath);
                        continue;
                    }
                    // Wait and retry
                    await new Promise(r => setTimeout(r, 100));
                } else {
                    throw error;
                }
            }
        }

        return false;
    }

    /**
     * Release lock
     */
    async releaseLock(): Promise<void> {
        if (this.lockAcquired) {
            try {
                await fs.unlink(this.lockPath);
            } catch {
                // Lock file may have been removed externally - safe to ignore
            }
            this.lockAcquired = false;
        }
    }

    /**
     * Check if lock is stale (process died)
     */
    private async isLockStale(): Promise<boolean> {
        try {
            const content = await fs.readFile(this.lockPath, 'utf-8');
            const lock = JSON.parse(content);

            // Consider stale if > 5 minutes old
            if (Date.now() - lock.time > 5 * 60 * 1000) {
                return true;
            }

            if (process.platform === 'win32') {
                // Windows: Use tasklist to check if process exists
                try {
                    const { spawnSync } = await import('child_process');
                    const result = spawnSync('tasklist', ['/FI', `PID eq ${lock.pid}`, '/NH'], {
                        encoding: 'utf-8',
                        timeout: 2000
                    });
                    // If PID not found, tasklist returns "INFO: No tasks..."
                    return !result.stdout.includes(lock.pid.toString());
                } catch {
                    // If tasklist fails, fall back to time-based only
                    return false;
                }
            } else {
                // Unix: Use signal 0 test
                try {
                    process.kill(lock.pid, 0);
                    return false; // Process exists
                } catch {
                    return true; // Process doesn't exist
                }
            }
        } catch {
            return true;
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

        // Trim history
        if (this.memory.history.length > this.config.maxHistory) {
            this.memory.history = this.memory.history.slice(0, this.config.maxHistory);
        }
    }

    /**
     * Update project context
     */
    updateContext(updates: Partial<ProjectMemory['context']>): void {
        if (!this.memory) return;
        this.memory.context = { ...this.memory.context, ...updates };
    }

    /**
     * Add a recent file
     */
    addRecentFile(filePath: string): void {
        if (!this.memory) return;

        const relativePath = path.relative(this.projectRoot, filePath);
        
        // Remove if already exists
        const existing = this.memory.context.recentFiles.indexOf(relativePath);
        if (existing > -1) {
            this.memory.context.recentFiles.splice(existing, 1);
        }

        // Add to front
        this.memory.context.recentFiles.unshift(relativePath);

        // Limit to 20
        if (this.memory.context.recentFiles.length > 20) {
            this.memory.context.recentFiles = this.memory.context.recentFiles.slice(0, 20);
        }
    }

    /**
     * Add a module note
     */
    addModuleNote(moduleName: string, note: string): void {
        if (!this.memory) return;
        this.memory.context.moduleNotes[moduleName] = note;
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
    }

    /**
     * Clear session approvals
     */
    clearSessionApprovals(): void {
        if (!this.memory) return;
        this.memory.approvals = this.memory.approvals.filter(
            a => a.scope === 'project'
        );
    }

    /**
     * Get memory for AI context
     */
    getContextForAI(): string {
        if (!this.memory) return '';

        const parts: string[] = [];

        // Project summary
        if (this.memory.context.projectSummary) {
            parts.push(`Project: ${this.memory.context.projectSummary}`);
        }

        // Recent files
        if (this.memory.context.recentFiles.length > 0) {
            parts.push(`Recent files: ${this.memory.context.recentFiles.slice(0, 5).join(', ')}`);
        }

        // Module notes
        const notes = Object.entries(this.memory.context.moduleNotes);
        if (notes.length > 0) {
            parts.push('Module notes:');
            for (const [mod, note] of notes.slice(0, 5)) {
                parts.push(`  ${mod}: ${note}`);
            }
        }

        // Recent history
        if (this.memory.history.length > 0) {
            parts.push('Recent sessions:');
            for (const conv of this.memory.history.slice(0, 3)) {
                const date = new Date(conv.timestamp).toLocaleDateString();
                parts.push(`  ${date}: ${conv.summary}`);
            }
        }

        return parts.join('\n');
    }

    // ========================================================================
    // Helpers
    // ========================================================================

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
        // Version migrations would go here
        // For now, just ensure all fields exist
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

    /**
     * Get current memory (or null if not loaded)
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
    // Chat History Archiving (Dynamic Context Discovery - Phase 3)
    // ========================================================================

    /**
     * Get the history archive directory for this project
     */
    private getArchiveDir(): string {
        return path.join(this.config.memoryDir, 'archives', this.projectId);
    }

    /**
     * Archive a conversation's messages to a file
     * Called when context window needs trimming
     */
    async archiveConversation(
        sessionId: string,
        messages: Array<{ role: string; content: string }>,
        summary: string
    ): Promise<ChatHistoryFile> {
        const archiveDir = this.getArchiveDir();
        await fs.mkdir(archiveDir, { recursive: true });

        const timestamp = Date.now();
        const filename = `${sessionId}-${timestamp}.json`;
        const filePath = path.join(archiveDir, filename);

        const archiveData = {
            sessionId,
            timestamp,
            summary,
            messageCount: messages.length,
            messages: messages.map((m, i) => ({
                turn: Math.floor(i / 2),
                role: m.role,
                content: m.content
            }))
        };

        await fs.writeFile(filePath, JSON.stringify(archiveData, null, 2), 'utf-8');

        const result: ChatHistoryFile = {
            sessionId,
            turnRange: { start: 0, end: Math.floor(messages.length / 2) },
            summary,
            filePath,
            timestamp
        };

        this.bus.emit({
            type: 'status',
            phase: 'tool',
            label: `Archived ${messages.length} messages to ${filename}`
        });

        return result;
    }

    /**
     * Search archived history for a query
     * Returns relevant messages matching the search query
     */
    async queryArchivedHistory(
        sessionId: string | null,
        query: string
    ): Promise<RelevantMessage[]> {
        const archiveDir = this.getArchiveDir();
        const results: RelevantMessage[] = [];

        try {
            const files = await fs.readdir(archiveDir);
            const queryLower = query.toLowerCase();

            for (const file of files) {
                // Filter by session if specified
                if (sessionId && !file.startsWith(sessionId)) {
                    continue;
                }

                if (!file.endsWith('.json')) continue;

                try {
                    const content = await fs.readFile(
                        path.join(archiveDir, file),
                        'utf-8'
                    );
                    const archive = JSON.parse(content);

                    // Search through messages
                    for (const msg of archive.messages) {
                        const contentLower = msg.content.toLowerCase();
                        if (contentLower.includes(queryLower)) {
                            // Calculate simple relevance score
                            const occurrences = (contentLower.match(new RegExp(queryLower, 'g')) || []).length;
                            const relevance = Math.min(occurrences / 5, 1);

                            results.push({
                                turnNumber: msg.turn,
                                role: msg.role as 'user' | 'assistant',
                                content: this.extractRelevantExcerpt(msg.content, query),
                                relevance
                            });
                        }
                    }
                } catch {
                    // Skip files that can't be read or parsed
                }
            }

            // Sort by relevance and limit
            return results
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, 20);

        } catch {
            // Archive directory may not exist yet
            return [];
        }
    }

    /**
     * Get a specific archived turn
     */
    async getArchivedTurn(
        sessionId: string,
        turnNumber: number
    ): Promise<{ role: string; content: string } | null> {
        const archiveDir = this.getArchiveDir();

        try {
            const files = await fs.readdir(archiveDir);

            for (const file of files) {
                if (!file.startsWith(sessionId) || !file.endsWith('.json')) continue;

                const content = await fs.readFile(
                    path.join(archiveDir, file),
                    'utf-8'
                );
                const archive = JSON.parse(content);

                for (const msg of archive.messages) {
                    if (msg.turn === turnNumber) {
                        return {
                            role: msg.role,
                            content: msg.content
                        };
                    }
                }
            }
        } catch {
            // Archive not found
        }

        return null;
    }

    /**
     * List all archived sessions
     */
    async listArchivedSessions(): Promise<Array<{
        sessionId: string;
        timestamp: number;
        summary: string;
        messageCount: number;
    }>> {
        const archiveDir = this.getArchiveDir();
        const sessions: Array<{
            sessionId: string;
            timestamp: number;
            summary: string;
            messageCount: number;
        }> = [];

        try {
            const files = await fs.readdir(archiveDir);

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                try {
                    const content = await fs.readFile(
                        path.join(archiveDir, file),
                        'utf-8'
                    );
                    const archive = JSON.parse(content);
                    sessions.push({
                        sessionId: archive.sessionId,
                        timestamp: archive.timestamp,
                        summary: archive.summary,
                        messageCount: archive.messageCount
                    });
                } catch {
                    // Skip unreadable files
                }
            }

            return sessions.sort((a, b) => b.timestamp - a.timestamp);
        } catch {
            return [];
        }
    }

    /**
     * Clean up old archives (beyond max age)
     */
    async cleanupArchives(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
        const archiveDir = this.getArchiveDir();
        const now = Date.now();
        let cleaned = 0;

        try {
            const files = await fs.readdir(archiveDir);

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                const filePath = path.join(archiveDir, file);
                try {
                    const stats = await fs.stat(filePath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        await fs.unlink(filePath);
                        cleaned++;
                    }
                } catch {
                    // Skip files we can't stat/delete
                }
            }
        } catch {
            // Archive directory may not exist
        }

        return cleaned;
    }

    /**
     * Extract a relevant excerpt around the query match
     */
    private extractRelevantExcerpt(content: string, query: string): string {
        const maxLength = 300;
        const queryLower = query.toLowerCase();
        const contentLower = content.toLowerCase();

        const matchIndex = contentLower.indexOf(queryLower);
        if (matchIndex === -1) {
            return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '');
        }

        // Extract context around the match
        const start = Math.max(0, matchIndex - 100);
        const end = Math.min(content.length, matchIndex + query.length + 100);

        let excerpt = content.slice(start, end);
        if (start > 0) excerpt = '...' + excerpt;
        if (end < content.length) excerpt = excerpt + '...';

        return excerpt;
    }
}

