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
import { AsyncMutex } from '../concurrency/index.js';
import { estimateTokens } from './utils.js';

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
    /** Threshold for archiving messages (message count) */
    archiveThreshold: number;
    /** Number of recent messages to keep after archiving */
    keepRecentMessages: number;
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
    private ioMutex = new AsyncMutex();
    private dirty: boolean = false;
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DEBOUNCE_MS = 5000;

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
    }

    // ========================================================================
    // Load / Save
    // ========================================================================

    /**
     * Load memory from disk
     * Uses AsyncMutex for intra-process safety
     */
    async load(): Promise<ProjectMemory> {
        return this.ioMutex.withLock(async () => {
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
        });
    }

    /**
     * Save memory to disk (atomic)
     * Uses AsyncMutex for intra-process safety and file lock for inter-process safety
     * Only writes if dirty flag is set
     */
    async save(): Promise<void> {
        return this.ioMutex.withLock(async () => {
            if (!this.memory || !this.dirty) return;

            // Acquire file lock for inter-process safety - MUST succeed
            const acquired = await this.acquireLock();
            if (!acquired) {
                throw new Error(`Failed to acquire memory lock: ${this.lockPath}`);
            }

            try {
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
                    this.dirty = false;

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
     * Schedule a debounced save operation
     * Prevents excessive writes when multiple mutations happen in quick succession
     */
    private scheduleSave(): void {
        if (this.saveTimeout) return;  // Already scheduled

        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;
            if (this.dirty) {
                try {
                    await this.save();
                } catch (error) {
                    // Log but don't throw - this is a background save
                    console.error('Auto-save failed:', error);
                }
            }
        }, this.SAVE_DEBOUNCE_MS);
    }

    /**
     * Cancel any pending auto-save and save immediately if dirty
     * Call this before process exit to ensure data is persisted
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
    // Utilities
    // ========================================================================

    /**
     * Sanitize a string for safe use in filenames
     * - Replaces path separators and invalid characters
     * - Limits length
     * - Cross-platform safe (Windows + Unix)
     */
    private sanitizeForFilename(input: string, maxLength = 100): string {
        return input
            // Replace path separators
            .replace(/[/\\]/g, '_')
            // Remove or replace invalid chars (Windows: < > : " | ? *)
            .replace(/[<>:"|?*]/g, '_')
            // Replace control characters
            .replace(/[\x00-\x1f\x7f]/g, '')
            // Collapse multiple underscores
            .replace(/_+/g, '_')
            // Trim underscores from ends
            .replace(/^_+|_+$/g, '')
            // Limit length
            .slice(0, maxLength);
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

        this.dirty = true;
        this.scheduleSave();
    }

    /**
     * Update project context
     */
    updateContext(updates: Partial<ProjectMemory['context']>): void {
        if (!this.memory) return;
        this.memory.context = { ...this.memory.context, ...updates };
        this.dirty = true;
        this.scheduleSave();
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

        this.dirty = true;
        this.scheduleSave();
    }

    /**
     * Add a module note
     */
    addModuleNote(moduleName: string, note: string): void {
        if (!this.memory) return;
        this.memory.context.moduleNotes[moduleName] = note;
        this.dirty = true;
        this.scheduleSave();
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
        this.dirty = true;
        this.scheduleSave();
    }

    /**
     * Clear session approvals
     */
    clearSessionApprovals(): void {
        if (!this.memory) return;
        this.memory.approvals = this.memory.approvals.filter(
            a => a.scope === 'project'
        );
        this.dirty = true;
        this.scheduleSave();
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
        // Sanitize sessionId to prevent path traversal and invalid filenames
        const safeSessionId = this.sanitizeForFilename(sessionId);
        const filename = `${safeSessionId}-${timestamp}.json`;
        const filePath = path.join(archiveDir, filename);

        // Calculate turn numbers based on user message count (not message index)
        // This correctly handles tool/system messages without breaking turn tracking
        let turnCounter = 0;
        const archiveData = {
            sessionId,
            timestamp,
            summary,
            messageCount: messages.length,
            messages: messages.map((m, i) => {
                // Increment turn on each user message (turn = completed exchanges)
                if (m.role === 'user') {
                    turnCounter++;
                }
                return {
                    index: i,
                    turn: turnCounter - 1, // 0-indexed: turn 0 starts at first user message
                    role: m.role,
                    content: m.content
                };
            })
        };

        await fs.writeFile(filePath, JSON.stringify(archiveData, null, 2), 'utf-8');

        // Calculate actual turn count based on user messages
        const userMessageCount = messages.filter(m => m.role === 'user').length;
        const result: ChatHistoryFile = {
            sessionId,
            turnRange: { start: 0, end: Math.max(0, userMessageCount - 1) },
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
     * Trigger summarization when context window is filling up
     * Implements Cursor's "give the agent a reference to the history file" pattern
     *
     * @param sessionId Current session ID
     * @param messages All messages in the current conversation
     * @param options Optional thresholds for triggering archive
     * @returns SummarizationResult with history reference if triggered
     */
    async triggerSummarization(
        sessionId: string,
        messages: Array<{ role: string; content: string }>,
        options?: {
            tokenThreshold?: number;   // Approximate token threshold (chars/4)
            messageThreshold?: number; // Message count threshold
            keepRecent?: number;       // Recent messages to keep
        }
    ): Promise<{
        triggered: boolean;
        historyRef?: {
            filePath: string;
            sessionId: string;
            summary: string;
            messageCount: number;
            turnRange: { start: number; end: number };
            timestamp: number;
            agentInstructions: string;
        };
        remainingMessages: Array<{ role: string; content: string }>;
        summary: string;
    }> {
        // Default thresholds
        const tokenThreshold = options?.tokenThreshold ?? 8000;  // ~32K chars
        const messageThreshold = options?.messageThreshold ?? this.config.archiveThreshold;
        const keepRecentCount = options?.keepRecent ?? this.config.keepRecentMessages;

        // Estimate total tokens in the conversation
        const estimatedTokensTotal = messages.reduce(
            (sum, m) => sum + estimateTokens(m.content),
            0
        );

        // Check if we need to archive (token-based OR message-based)
        const shouldArchive = estimatedTokensTotal > tokenThreshold || messages.length >= messageThreshold;
        if (!shouldArchive) {
            return {
                triggered: false,
                remainingMessages: messages,
                summary: ''
            };
        }

        // Calculate how many messages to archive
        const messagesToArchive = messages.slice(0, messages.length - keepRecentCount);
        const remainingMessages = messages.slice(-keepRecentCount);

        // Generate a summary of what we're archiving
        const summary = this.generateArchiveSummary(messagesToArchive);

        // Archive the messages
        const archiveResult = await this.archiveConversation(
            sessionId,
            messagesToArchive,
            summary
        );

        // Create the history reference for the agent
        const historyRef = {
            filePath: archiveResult.filePath,
            sessionId: archiveResult.sessionId,
            summary: archiveResult.summary,
            messageCount: messagesToArchive.length,
            turnRange: archiveResult.turnRange,
            timestamp: archiveResult.timestamp,
            agentInstructions: `Your conversation history has been archived to save context space.
Archive file: ${archiveResult.filePath}
Archived messages: ${messagesToArchive.length} (turns ${archiveResult.turnRange.start}-${archiveResult.turnRange.end})
Summary: ${summary}

To search the archived conversation, grep the archive file:
  grep "pattern" ${archiveResult.filePath}

Or read the file directly for full context:
  cat ${archiveResult.filePath} | jq '.messages[] | select(.content | test("pattern"))'`
        };

        this.bus.emit({
            type: 'status',
            phase: 'tool',
            label: `Context summarized: archived ${messagesToArchive.length} messages, keeping ${remainingMessages.length} recent`
        });

        return {
            triggered: true,
            historyRef,
            remainingMessages,
            summary
        };
    }

    /**
     * Generate a brief summary of messages being archived
     */
    private generateArchiveSummary(messages: Array<{ role: string; content: string }>): string {
        // Extract key topics from the conversation
        const topics: string[] = [];

        for (const msg of messages) {
            if (msg.role === 'user') {
                // Extract first sentence or line as topic hint
                const firstLine = msg.content.split(/[.\n]/)[0].trim();
                if (firstLine.length > 10 && firstLine.length < 100) {
                    topics.push(firstLine);
                }
            }
        }

        if (topics.length === 0) {
            return `Conversation with ${messages.length} messages`;
        }

        // Take first 3 topics
        const topicSummary = topics.slice(0, 3).join('; ');
        return `Topics discussed: ${topicSummary}`;
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
                // Filter by session if specified (sanitize to match filename format)
                if (sessionId) {
                    const safeSessionId = this.sanitizeForFilename(sessionId);
                    if (!file.startsWith(safeSessionId)) {
                        continue;
                    }
                }

                if (!file.endsWith('.json')) continue;

                try {
                    const content = await fs.readFile(
                        path.join(archiveDir, file),
                        'utf-8'
                    );
                    const archive = JSON.parse(content);

                    // Search through messages using improved relevance scoring
                    for (const msg of archive.messages) {
                        const relevance = this.calculateRelevance(msg.content, query);
                        if (relevance > 0) {
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
            const safeSessionId = this.sanitizeForFilename(sessionId);

            for (const file of files) {
                if (!file.startsWith(safeSessionId) || !file.endsWith('.json')) continue;

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
     * List all archived sessions, aggregated by sessionId.
     * Returns one entry per session with:
     * - Latest archive's summary and timestamp
     * - Total message count across all archives for that session
     * - Archive count showing how many archive files exist
     */
    async listArchivedSessions(): Promise<Array<{
        sessionId: string;
        timestamp: number;
        summary: string;
        messageCount: number;
        archiveCount: number;
    }>> {
        const archiveDir = this.getArchiveDir();

        // Aggregate by sessionId
        const sessionMap = new Map<string, {
            sessionId: string;
            latestTimestamp: number;
            latestSummary: string;
            totalMessages: number;
            archiveCount: number;
        }>();

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
                    const existing = sessionMap.get(archive.sessionId);

                    if (existing) {
                        // Update existing session entry
                        existing.totalMessages += archive.messageCount || 0;
                        existing.archiveCount++;
                        // Keep the latest summary and timestamp
                        if (archive.timestamp > existing.latestTimestamp) {
                            existing.latestTimestamp = archive.timestamp;
                            existing.latestSummary = archive.summary;
                        }
                    } else {
                        // Create new session entry
                        sessionMap.set(archive.sessionId, {
                            sessionId: archive.sessionId,
                            latestTimestamp: archive.timestamp,
                            latestSummary: archive.summary,
                            totalMessages: archive.messageCount || 0,
                            archiveCount: 1
                        });
                    }
                } catch {
                    // Skip unreadable files
                }
            }

            // Convert to array and sort by timestamp (newest first)
            return Array.from(sessionMap.values())
                .map(s => ({
                    sessionId: s.sessionId,
                    timestamp: s.latestTimestamp,
                    summary: s.latestSummary,
                    messageCount: s.totalMessages,
                    archiveCount: s.archiveCount
                }))
                .sort((a, b) => b.timestamp - a.timestamp);
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
     * Calculate relevance score for search results
     * Uses term frequency and position-based scoring
     */
    private calculateRelevance(content: string, query: string): number {
        const contentLower = content.toLowerCase();
        const queryLower = query.toLowerCase();

        // Tokenize query into terms (filter short words)
        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
        if (queryTerms.length === 0) {
            // Fall back to exact match for short queries
            return contentLower.includes(queryLower) ? 0.5 : 0;
        }

        let score = 0;

        // Exact phrase match is highest value
        if (contentLower.includes(queryLower)) {
            score += 0.5;
        }

        // Score each term
        for (const term of queryTerms) {
            // Escape regex special chars
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedTerm, 'gi');
            const matches = content.match(regex) || [];

            // Term frequency contribution (capped)
            score += Math.min(matches.length * 0.1, 0.3);

            // Position bonus (earlier matches = more relevant)
            const firstIndex = contentLower.indexOf(term);
            if (firstIndex !== -1) {
                score += (1 - firstIndex / content.length) * 0.1;
            }
        }

        // Normalize by query term count
        return Math.min(score / queryTerms.length, 1);
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

