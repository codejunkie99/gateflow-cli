/**
 * DynamicContextManager
 *
 * Implements Cursor's Dynamic Context Discovery patterns:
 * - Pattern 1: Tool Responses as Files (write outputs, agent uses tail/grep)
 * - Pattern 2: Chat History as Files (searchable JSONL on overflow)
 * - Pattern 5: Terminal Sessions as Files (greppable logs)
 *
 * Core principle: Files as simple, powerful primitives
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { EventBus } from '../events/bus.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Reference to a tool output file (Pattern 1)
 */
export interface ToolOutputRef {
    /** Absolute path to the output file */
    path: string;
    /** Tool name that generated this output */
    tool: string;
    /** Session ID */
    sessionId: string;
    /** Number of lines */
    lines: number;
    /** File size in bytes */
    size: number;
    /** Preview (first 5 lines) */
    preview: string;
    /** Hint for agent on how to access more */
    tailHint: string;
    /** Sequential ID within session */
    id: number;
    /** Timestamp */
    timestamp: number;
}

/**
 * Grep result structure
 */
export interface GrepResult {
    /** File path where match was found */
    file: string;
    /** Line number (1-indexed) */
    lineNumber: number;
    /** Matching line content */
    line: string;
    /** Context lines before match */
    before: string[];
    /** Context lines after match */
    after: string[];
}

/**
 * Chat history entry for JSONL file (Pattern 2)
 */
export interface HistoryEntry {
    turn: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    tools?: string[];
}

/**
 * Search result from history
 */
export interface HistorySearchResult {
    sessionId: string;
    turn: number;
    role: string;
    content: string;
    contextBefore: string[];
    contextAfter: string[];
    relevance: number;
}

/**
 * Context index entry
 */
export interface ContextIndexEntry {
    id: number;
    type: 'tool_output' | 'history' | 'terminal';
    tool?: string;
    path: string;
    lines: number;
    size: number;
    timestamp: number;
    summary?: string;
}

/**
 * Full context index for a session
 */
export interface ContextIndex {
    sessionId: string;
    projectId: string;
    entries: ContextIndexEntry[];
    lastUpdated: number;
}

/**
 * Configuration for DynamicContextManager
 */
export interface DynamicContextConfig {
    /** Base directory for all context files */
    baseDir: string;
    /** Project identifier */
    projectId: string;
    /** Lines to include in preview */
    previewLines: number;
    /** Threshold for storing as file (characters) */
    fileSizeThreshold: number;
    /** Max age for context files (ms) */
    maxAge: number;
}

// ============================================================================
// DynamicContextManager Implementation
// ============================================================================

export class DynamicContextManager {
    private config: DynamicContextConfig;
    private bus: EventBus | null;
    private initialized = false;
    private toolOutputCounter = 0;

    constructor(bus: EventBus | null = null, config?: Partial<DynamicContextConfig>) {
        this.bus = bus;

        // Default config
        const homeDir = os.homedir();
        this.config = {
            baseDir: config?.baseDir ?? path.join(homeDir, '.gateflow'),
            projectId: config?.projectId ?? 'default',
            previewLines: config?.previewLines ?? 5,
            fileSizeThreshold: config?.fileSizeThreshold ?? 2000,
            maxAge: config?.maxAge ?? 24 * 60 * 60 * 1000, // 24 hours
        };
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    async initialize(): Promise<void> {
        if (this.initialized) return;

        // Create directory structure
        const dirs = [
            this.getProjectDir(),
            this.getContextDir(),
            path.join(this.config.baseDir, 'skills'),
            path.join(this.config.baseDir, 'tools'),
        ];

        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }

        this.initialized = true;
    }

    // ========================================================================
    // Pattern 1: Tool Responses as Files
    // ========================================================================

    /**
     * Write tool output to file
     * Returns preview + file reference instead of full output
     *
     * Cursor pattern: "write the output to a file and give the agent
     * the ability to read it via tail/grep"
     */
    async writeToolOutput(
        tool: string,
        output: string,
        sessionId: string
    ): Promise<ToolOutputRef> {
        await this.initialize();

        const id = ++this.toolOutputCounter;
        const timestamp = Date.now();
        const filename = `tool_${String(id).padStart(3, '0')}_${tool}.txt`;
        const sessionDir = this.getSessionDir(sessionId);

        await fs.mkdir(sessionDir, { recursive: true });
        const filePath = path.join(sessionDir, filename);

        // Write the output
        await fs.writeFile(filePath, output, 'utf-8');

        // Calculate metrics
        const lines = output.split('\n');
        const lineCount = lines.length;
        const size = Buffer.byteLength(output, 'utf-8');

        // Generate preview (first N lines)
        const preview = lines.slice(0, this.config.previewLines).join('\n');

        // Generate tail hint if output is long
        const tailHint = lineCount > 50
            ? `Use tail_context("${filename}") to check end for errors/results`
            : '';

        const ref: ToolOutputRef = {
            path: filePath,
            tool,
            sessionId,
            lines: lineCount,
            size,
            preview,
            tailHint,
            id,
            timestamp
        };

        // Update index
        await this.updateIndex(sessionId, {
            id,
            type: 'tool_output',
            tool,
            path: filePath,
            lines: lineCount,
            size,
            timestamp,
            summary: `${tool} output (${lineCount} lines)`
        });

        // Emit event
        this.emitEvent('tool_output_written', { tool, filePath, lines: lineCount, size });

        return ref;
    }

    /**
     * Format tool output reference for agent
     * This is what gets returned instead of full output
     */
    formatToolOutputRef(ref: ToolOutputRef): string {
        const sizeKB = (ref.size / 1024).toFixed(1);
        let result = `Output saved to context file (${ref.lines} lines, ${sizeKB} KB)\n\n`;
        result += `Preview:\n${ref.preview}\n`;

        if (ref.tailHint) {
            result += `\n[${ref.tailHint}]`;
        }

        result += `\n\nFile: ${path.basename(ref.path)}`;
        return result;
    }

    /**
     * Check if output should be stored as file
     */
    shouldStoreAsFile(output: string): boolean {
        return output.length > this.config.fileSizeThreshold;
    }

    // ========================================================================
    // Pattern 2: Chat History as Files
    // ========================================================================

    /**
     * Write chat history to JSONL file
     * Agent can search to recover details lost in summarization
     */
    async writeHistoryFile(
        sessionId: string,
        messages: Array<{ role: string; content: string; timestamp?: number; toolCalls?: Array<{ name: string }> }>
    ): Promise<string> {
        await this.initialize();

        const sessionDir = this.getSessionDir(sessionId);
        await fs.mkdir(sessionDir, { recursive: true });

        const filePath = path.join(sessionDir, 'history.jsonl');

        // Convert to JSONL format - one JSON object per line (greppable)
        const entries: HistoryEntry[] = messages.map((m, i) => ({
            turn: i,
            role: m.role as 'user' | 'assistant' | 'system',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            timestamp: m.timestamp ?? Date.now(),
            tools: m.toolCalls?.map(t => t.name)
        }));

        const content = entries.map(e => JSON.stringify(e)).join('\n');
        await fs.writeFile(filePath, content, 'utf-8');

        // Update index
        await this.updateIndex(sessionId, {
            id: 0,
            type: 'history',
            path: filePath,
            lines: entries.length,
            size: Buffer.byteLength(content, 'utf-8'),
            timestamp: Date.now(),
            summary: `Chat history (${entries.length} messages)`
        });

        // Emit event
        this.emitEvent('history_written', { sessionId, filePath, messageCount: entries.length });

        return filePath;
    }

    /**
     * Search chat history across sessions
     * Implements "agent can search to recover details" pattern
     */
    async searchHistory(
        query: string,
        sessionId?: string
    ): Promise<HistorySearchResult[]> {
        await this.initialize();

        const results: HistorySearchResult[] = [];
        const searchPattern = query.toLowerCase();

        // Get sessions to search
        let sessionDirs: string[];
        if (sessionId) {
            sessionDirs = [this.getSessionDir(sessionId)];
        } else {
            const contextDir = this.getContextDir();
            try {
                const entries = await fs.readdir(contextDir, { withFileTypes: true });
                sessionDirs = entries
                    .filter(e => e.isDirectory())
                    .map(e => path.join(contextDir, e.name));
            } catch {
                return results;
            }
        }

        // Search each session's history
        for (const sessionDir of sessionDirs) {
            const historyPath = path.join(sessionDir, 'history.jsonl');

            try {
                const content = await fs.readFile(historyPath, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());
                const sid = path.basename(sessionDir);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.toLowerCase().includes(searchPattern)) {
                        try {
                            const entry: HistoryEntry = JSON.parse(line);

                            // Get context lines
                            const contextBefore = lines.slice(Math.max(0, i - 2), i);
                            const contextAfter = lines.slice(i + 1, i + 3);

                            results.push({
                                sessionId: sid,
                                turn: entry.turn,
                                role: entry.role,
                                content: entry.content,
                                contextBefore,
                                contextAfter,
                                relevance: this.calculateRelevance(entry.content, query)
                            });
                        } catch {
                            // Skip malformed entries
                        }
                    }
                }
            } catch {
                // Session doesn't have history file
            }
        }

        // Sort by relevance
        results.sort((a, b) => b.relevance - a.relevance);

        return results.slice(0, 20); // Return top 20
    }

    // ========================================================================
    // Grep/Tail Access (File Access Primitives)
    // ========================================================================

    /**
     * Grep a context file - agent tool
     * Supports regex patterns and context lines
     */
    async grep(
        filePattern: string,
        pattern: string,
        options: { context?: number; ignoreCase?: boolean } = {}
    ): Promise<GrepResult[]> {
        await this.initialize();

        const results: GrepResult[] = [];
        const contextLines = options.context ?? 0;
        const flags = options.ignoreCase ? 'gi' : 'g';

        // Resolve file pattern
        const files = await this.resolveFilePattern(filePattern);

        for (const filePath of files) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const lines = content.split('\n');

                const regex = new RegExp(pattern, flags);

                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        results.push({
                            file: filePath,
                            lineNumber: i + 1,
                            line: lines[i],
                            before: lines.slice(Math.max(0, i - contextLines), i),
                            after: lines.slice(i + 1, i + 1 + contextLines)
                        });

                        // Reset regex lastIndex for global patterns
                        regex.lastIndex = 0;
                    }
                }
            } catch {
                // Skip unreadable files
            }
        }

        return results;
    }

    /**
     * Tail a context file - get last N lines
     * Cursor pattern: "agent uses tail to check end of file"
     */
    async tail(filePath: string, lines = 50): Promise<string> {
        const resolvedPath = await this.resolvePath(filePath);
        const content = await fs.readFile(resolvedPath, 'utf-8');
        const allLines = content.split('\n');

        return allLines.slice(-lines).join('\n');
    }

    /**
     * Head a context file - get first N lines
     */
    async head(filePath: string, lines = 50): Promise<string> {
        const resolvedPath = await this.resolvePath(filePath);
        const content = await fs.readFile(resolvedPath, 'utf-8');
        const allLines = content.split('\n');

        return allLines.slice(0, lines).join('\n');
    }

    /**
     * Get specific line range from file
     */
    async getLines(filePath: string, startLine: number, endLine: number): Promise<string> {
        const resolvedPath = await this.resolvePath(filePath);
        const content = await fs.readFile(resolvedPath, 'utf-8');
        const lines = content.split('\n');

        // Convert to 0-indexed
        const start = Math.max(0, startLine - 1);
        const end = Math.min(lines.length, endLine);

        return lines.slice(start, end).join('\n');
    }

    // ========================================================================
    // Context Index
    // ========================================================================

    /**
     * Get index of all context files for session
     */
    async getContextIndex(sessionId: string): Promise<ContextIndex> {
        await this.initialize();

        const indexPath = path.join(this.getSessionDir(sessionId), 'index.json');

        try {
            const content = await fs.readFile(indexPath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return {
                sessionId,
                projectId: this.config.projectId,
                entries: [],
                lastUpdated: Date.now()
            };
        }
    }

    /**
     * Find context files by filter
     */
    async findContextFiles(
        sessionId: string,
        filter: { tool?: string; type?: ContextIndexEntry['type'] }
    ): Promise<ContextIndexEntry[]> {
        const index = await this.getContextIndex(sessionId);

        return index.entries.filter(entry => {
            if (filter.tool && entry.tool !== filter.tool) return false;
            if (filter.type && entry.type !== filter.type) return false;
            return true;
        });
    }

    /**
     * List all sessions with context
     */
    async listSessions(): Promise<string[]> {
        const contextDir = this.getContextDir();

        try {
            const entries = await fs.readdir(contextDir, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory())
                .map(e => e.name);
        } catch {
            return [];
        }
    }

    // ========================================================================
    // Cleanup
    // ========================================================================

    /**
     * Clean up old context files
     */
    async cleanup(): Promise<number> {
        const contextDir = this.getContextDir();
        const maxAge = this.config.maxAge;
        const now = Date.now();
        let cleaned = 0;

        try {
            const sessions = await fs.readdir(contextDir, { withFileTypes: true });

            for (const session of sessions) {
                if (!session.isDirectory()) continue;

                const sessionDir = path.join(contextDir, session.name);
                const files = await fs.readdir(sessionDir);

                for (const file of files) {
                    const filePath = path.join(sessionDir, file);

                    try {
                        const stats = await fs.stat(filePath);
                        if (now - stats.mtimeMs > maxAge) {
                            await fs.unlink(filePath);
                            cleaned++;
                        }
                    } catch {
                        // Skip
                    }
                }

                // Remove empty session directories
                const remaining = await fs.readdir(sessionDir);
                if (remaining.length === 0) {
                    await fs.rmdir(sessionDir);
                }
            }
        } catch {
            // Context dir might not exist
        }

        return cleaned;
    }

    /**
     * Clean up specific session
     */
    async cleanupSession(sessionId: string): Promise<void> {
        const sessionDir = this.getSessionDir(sessionId);

        try {
            const files = await fs.readdir(sessionDir);
            for (const file of files) {
                await fs.unlink(path.join(sessionDir, file));
            }
            await fs.rmdir(sessionDir);
        } catch {
            // Session might not exist
        }
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /**
     * Set project ID (for multi-project support)
     */
    setProjectId(projectId: string): void {
        this.config.projectId = projectId;
        this.toolOutputCounter = 0;
    }

    /**
     * Get configuration
     */
    getConfig(): DynamicContextConfig {
        return { ...this.config };
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private getProjectDir(): string {
        return path.join(this.config.baseDir, this.config.projectId);
    }

    private getContextDir(): string {
        return path.join(this.getProjectDir(), 'context');
    }

    private getSessionDir(sessionId: string): string {
        return path.join(this.getContextDir(), sessionId);
    }

    private async updateIndex(sessionId: string, entry: ContextIndexEntry): Promise<void> {
        const index = await this.getContextIndex(sessionId);

        // Remove existing entry with same id and type
        index.entries = index.entries.filter(
            e => !(e.id === entry.id && e.type === entry.type)
        );

        index.entries.push(entry);
        index.lastUpdated = Date.now();

        const indexPath = path.join(this.getSessionDir(sessionId), 'index.json');
        await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    }

    private async resolveFilePattern(pattern: string): Promise<string[]> {
        // If it's a glob pattern with *, expand it
        if (pattern.includes('*')) {
            const baseDir = path.dirname(pattern.replace('*', ''));
            const filePattern = path.basename(pattern);

            try {
                const resolvedBase = await this.resolvePath(baseDir);
                const files = await fs.readdir(resolvedBase);

                const regex = new RegExp(
                    '^' + filePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
                );

                return files
                    .filter(f => regex.test(f))
                    .map(f => path.join(resolvedBase, f));
            } catch {
                return [];
            }
        }

        // Single file
        try {
            const resolved = await this.resolvePath(pattern);
            return [resolved];
        } catch {
            return [];
        }
    }

    private async resolvePath(filePath: string): Promise<string> {
        // If already absolute, use as-is
        if (path.isAbsolute(filePath)) {
            return filePath;
        }

        // Try context directory first
        const contextPath = path.join(this.getContextDir(), filePath);
        try {
            await fs.access(contextPath);
            return contextPath;
        } catch {
            // Not in context dir
        }

        // Try current session directory
        const sessions = await this.listSessions();
        for (const session of sessions) {
            const sessionPath = path.join(this.getSessionDir(session), filePath);
            try {
                await fs.access(sessionPath);
                return sessionPath;
            } catch {
                // Not in this session
            }
        }

        throw new Error(`File not found: ${filePath}`);
    }

    private calculateRelevance(content: string, query: string): number {
        const lowerContent = content.toLowerCase();
        const lowerQuery = query.toLowerCase();

        // Simple relevance: occurrence count / length
        const occurrences = (lowerContent.match(new RegExp(lowerQuery, 'g')) || []).length;
        return occurrences / Math.log(content.length + 1);
    }

    private emitEvent(type: string, data: Record<string, unknown>): void {
        if (!this.bus) return;

        // Emit as status event for now (can add specific event types later)
        this.bus.emit({
            type: 'status',
            phase: 'thinking',
            label: `Context: ${type}`
        });
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalDynamicContextManager: DynamicContextManager | null = null;

/**
 * Get the global DynamicContextManager instance
 */
export function getDynamicContextManager(): DynamicContextManager {
    if (!globalDynamicContextManager) {
        globalDynamicContextManager = new DynamicContextManager();
    }
    return globalDynamicContextManager;
}

/**
 * Create a new DynamicContextManager
 */
export function createDynamicContextManager(
    bus: EventBus | null,
    config?: Partial<DynamicContextConfig>
): DynamicContextManager {
    return new DynamicContextManager(bus, config);
}

/**
 * Set the global DynamicContextManager instance
 */
export function setGlobalDynamicContextManager(manager: DynamicContextManager): void {
    globalDynamicContextManager = manager;
}
