/**
 * Archive Manager
 * Handles conversation history archiving and retrieval
 */

import fs from 'fs/promises';
import path from 'path';
import type { EventBus } from '../../events/index.js';
import { AsyncMutex } from '../../concurrency/index.js';
import { estimateTokens } from '../utils.js';
import type {
    ChatHistoryFile,
    RelevantMessage,
    ArchivedSession,
    SummarizationResult,
    Message,
    MemoryConfig
} from './memory.types.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of results returned from archive queries */
const MAX_QUERY_RESULTS = 20;

/** Default max age for archive cleanup (7 days in ms) */
const DEFAULT_ARCHIVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimum topic length for summary extraction */
const TOPIC_MIN_LENGTH = 10;

/** Maximum topic length for summary extraction */
const TOPIC_MAX_LENGTH = 100;

/** Maximum number of topics to include in summary */
const MAX_TOPICS_IN_SUMMARY = 3;

/** Maximum length of extracted excerpts */
const MAX_EXCERPT_LENGTH = 300;

/** Context window size around match in excerpts */
const EXCERPT_CONTEXT_WINDOW = 100;

/** Valid message roles for RelevantMessage */
const VALID_RELEVANT_ROLES = new Set(['user', 'assistant']);

// ============================================================================
// Types
// ============================================================================

/** Schema for archived conversation data */
interface ArchiveSchema {
    sessionId: string;
    timestamp: number;
    summary: string;
    messageCount: number;
    messages: Array<{
        index: number;
        turn: number;
        role: string;
        content: string;
    }>;
}

// ============================================================================
// Archive Manager
// ============================================================================

export class ArchiveManager {
    private archiveDir: string;
    private archiveMutex = new AsyncMutex();

    constructor(
        private projectId: string,
        private config: MemoryConfig,
        private bus: EventBus
    ) {
        this.archiveDir = path.join(config.memoryDir, 'archives', projectId);
    }

    // ========================================================================
    // Archive Operations
    // ========================================================================

    /**
     * Archive a conversation's messages to a file.
     * Called when context window needs trimming.
     *
     * @param sessionId - Unique session identifier
     * @param messages - Messages to archive
     * @param summary - Summary of the conversation
     * @returns Archive metadata including file path
     * @throws Error if sessionId is empty
     */
    async archiveConversation(
        sessionId: string,
        messages: Message[],
        summary: string
    ): Promise<ChatHistoryFile> {
        // Use mutex to prevent concurrent archive operations for same session
        return this.archiveMutex.withLock(async () => {
            // Validate sessionId to prevent malformed filenames
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error('sessionId cannot be empty');
            }

            await fs.mkdir(this.archiveDir, { recursive: true });

            const timestamp = Date.now();
            // Sanitize sessionId to prevent path traversal and invalid filenames
            const safeSessionId = this.sanitizeForFilename(sessionId);
            const filename = `${safeSessionId}-${timestamp}.json`;
            const filePath = path.join(this.archiveDir, filename);

            // Calculate turn numbers based on user message count
            let currentTurn = -1;
            const archiveData: ArchiveSchema = {
                sessionId,
                timestamp,
                summary,
                messageCount: messages.length,
                messages: messages.map((m, i) => {
                    if (m.role === 'user') {
                        currentTurn++;
                    }
                    return {
                        index: i,
                        turn: Math.max(0, currentTurn),
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
        });
    }

    /**
     * Trigger summarization when context window is filling up.
     * Implements the "give the agent a reference to the history file" pattern.
     *
     * @param sessionId - Current session ID
     * @param messages - All messages in the current conversation
     * @param options - Optional thresholds for triggering archive
     * @returns SummarizationResult with history reference if triggered
     */
    async triggerSummarization(
        sessionId: string,
        messages: Message[],
        options?: {
            tokenThreshold?: number;
            messageThreshold?: number;
            keepRecent?: number;
        }
    ): Promise<SummarizationResult> {
        const tokenThreshold = options?.tokenThreshold ?? 8000;
        const messageThreshold = options?.messageThreshold ?? this.config.archiveThreshold;
        const keepRecentCount = options?.keepRecent ?? this.config.keepRecentMessages;

        // Estimate total tokens
        const estimatedTokensTotal = messages.reduce(
            (sum, m) => sum + estimateTokens(m.content),
            0
        );

        // Check if we need to archive
        const shouldArchive = estimatedTokensTotal > tokenThreshold || messages.length >= messageThreshold;
        if (!shouldArchive) {
            return {
                triggered: false,
                remainingMessages: messages,
                summary: ''
            };
        }

        // Guard: Don't create empty archives when we have fewer messages than keepRecentCount
        if (messages.length <= keepRecentCount) {
            return {
                triggered: false,
                remainingMessages: messages,
                summary: ''
            };
        }

        // Split messages
        const messagesToArchive = messages.slice(0, messages.length - keepRecentCount);
        const remainingMessages = messages.slice(-keepRecentCount);

        // Generate summary
        const summary = this.generateArchiveSummary(messagesToArchive);

        // Archive
        const archiveResult = await this.archiveConversation(
            sessionId,
            messagesToArchive,
            summary
        );

        // Create history reference
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

    // ========================================================================
    // Query Operations
    // ========================================================================

    /**
     * Search archived history for a query.
     * Returns relevant messages sorted by relevance score.
     *
     * @param sessionId - Filter by session ID (null for all sessions)
     * @param query - Search query string
     * @returns Array of relevant messages with relevance scores
     */
    async queryArchivedHistory(
        sessionId: string | null,
        query: string
    ): Promise<RelevantMessage[]> {
        const results: RelevantMessage[] = [];

        try {
            const files = await fs.readdir(this.archiveDir);

            for (const file of files) {
                if (sessionId) {
                    const safeSessionId = this.sanitizeForFilename(sessionId);
                    if (!file.startsWith(safeSessionId)) {
                        continue;
                    }
                }

                if (!file.endsWith('.json')) continue;

                try {
                    const content = await fs.readFile(
                        path.join(this.archiveDir, file),
                        'utf-8'
                    );
                    const archive = this.parseAndValidateArchive(content);
                    if (!archive) continue;

                    for (const msg of archive.messages) {
                        // Skip non-standard roles for RelevantMessage
                        if (!VALID_RELEVANT_ROLES.has(msg.role)) {
                            continue;
                        }

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
                } catch (error) {
                    console.warn(`[ArchiveManager] Error reading archive ${file}:`, error);
                }
            }

            return results
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, MAX_QUERY_RESULTS);

        } catch (error) {
            console.warn('[ArchiveManager] Error listing archive directory:', error);
            return [];
        }
    }

    /**
     * Get all messages for a specific archived turn.
     * A turn includes the user message and all associated responses (assistant, tool, etc.)
     *
     * @param sessionId - Session ID to search in
     * @param turnNumber - Turn number to retrieve
     * @returns Array of messages for that turn (empty if not found)
     */
    async getArchivedTurn(
        sessionId: string,
        turnNumber: number
    ): Promise<Array<{ role: string; content: string }>> {
        const turnMessages: Array<{ role: string; content: string }> = [];

        try {
            const files = await fs.readdir(this.archiveDir);
            const safeSessionId = this.sanitizeForFilename(sessionId);

            for (const file of files) {
                if (!file.startsWith(safeSessionId) || !file.endsWith('.json')) continue;

                try {
                    const content = await fs.readFile(
                        path.join(this.archiveDir, file),
                        'utf-8'
                    );
                    const archive = this.parseAndValidateArchive(content);
                    if (!archive) continue;

                    // Collect ALL messages for this turn (user + assistant + tool messages)
                    for (const msg of archive.messages) {
                        if (msg.turn === turnNumber) {
                            turnMessages.push({
                                role: msg.role,
                                content: msg.content
                            });
                        }
                    }

                    // If we found messages, return them (don't search other archive files)
                    if (turnMessages.length > 0) {
                        return turnMessages;
                    }
                } catch (error) {
                    console.warn(`[ArchiveManager] Error reading archive ${file}:`, error);
                }
            }
        } catch (error) {
            console.warn('[ArchiveManager] Error listing archive directory:', error);
        }

        return turnMessages;
    }

    /**
     * List all archived sessions, aggregated by sessionId.
     * Returns one entry per session with latest archive's summary and timestamp,
     * total message count across all archives, and archive count.
     *
     * @returns Array of archived session metadata, sorted by timestamp (newest first)
     */
    async listArchivedSessions(): Promise<ArchivedSession[]> {
        const sessionMap = new Map<string, {
            sessionId: string;
            latestTimestamp: number;
            latestSummary: string;
            totalMessages: number;
            archiveCount: number;
        }>();

        try {
            const files = await fs.readdir(this.archiveDir);

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                try {
                    const content = await fs.readFile(
                        path.join(this.archiveDir, file),
                        'utf-8'
                    );
                    const archive = this.parseAndValidateArchive(content);
                    if (!archive) continue;

                    const existing = sessionMap.get(archive.sessionId);

                    if (existing) {
                        existing.totalMessages += archive.messageCount || 0;
                        existing.archiveCount++;
                        if (archive.timestamp > existing.latestTimestamp) {
                            existing.latestTimestamp = archive.timestamp;
                            existing.latestSummary = archive.summary;
                        }
                    } else {
                        sessionMap.set(archive.sessionId, {
                            sessionId: archive.sessionId,
                            latestTimestamp: archive.timestamp,
                            latestSummary: archive.summary,
                            totalMessages: archive.messageCount || 0,
                            archiveCount: 1
                        });
                    }
                } catch (error) {
                    console.warn(`[ArchiveManager] Error reading archive ${file}:`, error);
                }
            }

            return Array.from(sessionMap.values())
                .map(s => ({
                    sessionId: s.sessionId,
                    timestamp: s.latestTimestamp,
                    summary: s.latestSummary,
                    messageCount: s.totalMessages,
                    archiveCount: s.archiveCount
                }))
                .sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            console.warn('[ArchiveManager] Error listing archive directory:', error);
            return [];
        }
    }

    /**
     * Clean up old archives beyond max age.
     * Uses the archive's internal timestamp for accurate age calculation.
     *
     * @param maxAgeMs - Maximum age in milliseconds (default: 7 days)
     * @returns Number of archives deleted
     */
    async cleanupArchives(maxAgeMs: number = DEFAULT_ARCHIVE_MAX_AGE_MS): Promise<number> {
        const now = Date.now();
        let cleaned = 0;

        try {
            const files = await fs.readdir(this.archiveDir);

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                const filePath = path.join(this.archiveDir, file);
                try {
                    // Read archive to get internal timestamp (more reliable than mtime)
                    const content = await fs.readFile(filePath, 'utf-8');
                    const archive = this.parseAndValidateArchive(content);

                    if (archive && now - archive.timestamp > maxAgeMs) {
                        await fs.unlink(filePath);
                        cleaned++;
                    }
                } catch (error) {
                    console.warn(`[ArchiveManager] Error processing archive ${file} for cleanup:`, error);
                }
            }
        } catch (error) {
            console.warn('[ArchiveManager] Error listing archive directory for cleanup:', error);
        }

        return cleaned;
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    /**
     * Parse and validate archive JSON content.
     * Returns null if the content is invalid or doesn't match expected schema.
     *
     * @param content - Raw JSON content
     * @returns Validated ArchiveSchema or null
     */
    private parseAndValidateArchive(content: string): ArchiveSchema | null {
        try {
            const data = JSON.parse(content);

            // Validate required fields
            if (
                typeof data.sessionId !== 'string' ||
                typeof data.timestamp !== 'number' ||
                typeof data.summary !== 'string' ||
                !Array.isArray(data.messages)
            ) {
                console.warn('[ArchiveManager] Invalid archive schema: missing required fields');
                return null;
            }

            // Validate messages array structure
            for (const msg of data.messages) {
                if (
                    typeof msg.index !== 'number' ||
                    typeof msg.turn !== 'number' ||
                    typeof msg.role !== 'string' ||
                    typeof msg.content !== 'string'
                ) {
                    console.warn('[ArchiveManager] Invalid archive schema: malformed message');
                    return null;
                }
            }

            return data as ArchiveSchema;
        } catch (error) {
            console.warn('[ArchiveManager] Failed to parse archive JSON:', error);
            return null;
        }
    }

    /**
     * Generate a brief summary of messages being archived.
     * Extracts key topics from user messages.
     *
     * @param messages - Messages to summarize
     * @returns Summary string
     */
    private generateArchiveSummary(messages: Message[]): string {
        const topics: string[] = [];

        for (const msg of messages) {
            if (msg.role === 'user') {
                // Use sentence boundary detection (. ? ! or newline)
                const firstSentence = msg.content.split(/[.?!\n]/)[0].trim();
                if (firstSentence.length > TOPIC_MIN_LENGTH && firstSentence.length < TOPIC_MAX_LENGTH) {
                    topics.push(firstSentence);
                }
            }
        }

        if (topics.length === 0) {
            return `Conversation with ${messages.length} messages`;
        }

        const topicSummary = topics.slice(0, MAX_TOPICS_IN_SUMMARY).join('; ');
        return `Topics discussed: ${topicSummary}`;
    }

    /**
     * Calculate relevance score for search results.
     * Uses term frequency and position-based scoring.
     *
     * @param content - Content to score
     * @param query - Search query
     * @returns Relevance score between 0 and 1
     */
    private calculateRelevance(content: string, query: string): number {
        const contentLower = content.toLowerCase();
        const queryLower = query.toLowerCase();

        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
        if (queryTerms.length === 0) {
            return contentLower.includes(queryLower) ? 0.5 : 0;
        }

        let score = 0;

        // Exact phrase match is highest value
        if (contentLower.includes(queryLower)) {
            score += 0.5;
        }

        // Score each term
        for (const term of queryTerms) {
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
     * Extract a relevant excerpt around the query match.
     * Snaps to word boundaries to avoid cutting words mid-way.
     *
     * @param content - Full content
     * @param query - Search query
     * @returns Excerpt with ellipsis if truncated
     */
    private extractRelevantExcerpt(content: string, query: string): string {
        const queryLower = query.toLowerCase();
        const contentLower = content.toLowerCase();

        const matchIndex = contentLower.indexOf(queryLower);
        if (matchIndex === -1) {
            // No match - return beginning of content, snapped to word boundary
            let endPos = Math.min(content.length, MAX_EXCERPT_LENGTH);
            // Snap to word boundary
            while (endPos < content.length && content[endPos] !== ' ' && endPos > MAX_EXCERPT_LENGTH - 20) {
                endPos--;
            }
            return content.slice(0, endPos) + (content.length > endPos ? '...' : '');
        }

        // Calculate initial bounds
        let start = Math.max(0, matchIndex - EXCERPT_CONTEXT_WINDOW);
        let end = Math.min(content.length, matchIndex + query.length + EXCERPT_CONTEXT_WINDOW);

        // Snap start to word boundary (find previous space)
        while (start > 0 && content[start - 1] !== ' ') {
            start--;
        }

        // Snap end to word boundary (find next space)
        while (end < content.length && content[end] !== ' ') {
            end++;
        }

        let excerpt = content.slice(start, end);
        if (start > 0) excerpt = '...' + excerpt;
        if (end < content.length) excerpt = excerpt + '...';

        return excerpt;
    }

    /**
     * Sanitize a string for safe use in filenames.
     * - Replaces path separators and invalid characters
     * - Handles Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
     * - Handles edge cases (empty, all dots)
     * - Limits length
     * - Cross-platform safe (Windows + Unix)
     *
     * @param input - String to sanitize
     * @param maxLength - Maximum filename length (default: 100)
     * @returns Sanitized filename-safe string
     */
    private sanitizeForFilename(input: string, maxLength = 100): string {
        const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

        let result = input
            .replace(/[/\\]/g, '_')
            .replace(/[<>:"|?*]/g, '_')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, maxLength);

        if (result === '' || /^\.+$/.test(result) || WINDOWS_RESERVED.test(result)) {
            result = `_${result || 'unnamed'}_`;
        }

        return result;
    }
}
