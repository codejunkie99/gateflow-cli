/**
 * Terminal Session Manager
 *
 * Implements Cursor's "Terminal Sessions as Files" strategy:
 * - Persist all terminal/simulation output to session files
 * - Enable pattern search across terminal history
 * - Agent can query "why did my command fail?" without copy-paste
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { TerminalSession, TerminalSearchHit, ContextConfig } from './types.js';
import { DEFAULT_CONTEXT_CONFIG } from './types.js';

// ============================================================================
// Terminal Session Manager
// ============================================================================

export class TerminalSessionManager {
    private config: ContextConfig;
    private sessionsDir: string;
    private sessions: Map<string, TerminalSession> = new Map();
    private initialized: boolean = false;

    constructor(config?: Partial<ContextConfig>) {
        this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };

        // Set sessions directory within context dir
        const contextDir = this.config.contextFileDir || path.join(os.tmpdir(), 'gateflow-context');
        this.sessionsDir = path.join(contextDir, 'terminal-sessions');
    }

    /**
     * Initialize the sessions directory
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await fs.mkdir(this.sessionsDir, { recursive: true });
            this.initialized = true;
        } catch (error) {
            throw new Error(`Failed to initialize terminal sessions directory: ${error}`);
        }
    }

    /**
     * Create a new terminal session
     */
    async createSession(sessionId: string): Promise<TerminalSession> {
        await this.initialize();

        const filePath = path.join(this.sessionsDir, `${sessionId}.log`);

        // Create empty file
        await fs.writeFile(filePath, '', 'utf-8');

        const session: TerminalSession = {
            id: sessionId,
            filePath,
            startTime: Date.now(),
            lineCount: 0
        };

        this.sessions.set(sessionId, session);
        return session;
    }

    /**
     * Get or create a session
     */
    async getOrCreateSession(sessionId: string): Promise<TerminalSession> {
        let session = this.sessions.get(sessionId);
        if (!session) {
            session = await this.createSession(sessionId);
        }
        return session;
    }

    /**
     * Get the file path for a session (for direct grep access)
     * Returns undefined if session doesn't exist
     */
    getSessionFilePath(sessionId: string): string | undefined {
        const session = this.sessions.get(sessionId);
        return session?.filePath;
    }

    /**
     * Append output to a terminal session
     * Called during command execution to stream output
     */
    async appendOutput(sessionId: string, output: string): Promise<void> {
        const session = await this.getOrCreateSession(sessionId);

        // Append to file
        await fs.appendFile(session.filePath, output, 'utf-8');

        // Update line count
        session.lineCount += output.split('\n').length - 1;
    }

    /**
     * Append a command header to the session
     */
    async appendCommand(sessionId: string, command: string, toolName?: string): Promise<void> {
        const timestamp = new Date().toISOString();
        const header = `\n${'='.repeat(60)}\n[${timestamp}] ${toolName || 'bash'}: ${command}\n${'='.repeat(60)}\n`;
        await this.appendOutput(sessionId, header);
    }

    /**
     * Get recent output from a session
     */
    async getRecentOutput(sessionId: string, lines: number = 50): Promise<string> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return '';
        }

        try {
            const content = await fs.readFile(session.filePath, 'utf-8');
            const allLines = content.split('\n');
            return allLines.slice(-lines).join('\n');
        } catch {
            return '';
        }
    }

    /**
     * Get full session content
     */
    async getFullOutput(sessionId: string): Promise<string> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return '';
        }

        try {
            return await fs.readFile(session.filePath, 'utf-8');
        } catch {
            return '';
        }
    }

    /**
     * Search terminal output for patterns
     */
    async searchOutput(
        sessionId: string,
        pattern: string,
        contextLines: number = 2
    ): Promise<TerminalSearchHit[]> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return [];
        }

        try {
            const content = await fs.readFile(session.filePath, 'utf-8');
            const lines = content.split('\n');
            const regex = new RegExp(pattern, 'gi');
            const hits: TerminalSearchHit[] = [];

            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    const start = Math.max(0, i - contextLines);
                    const end = Math.min(lines.length - 1, i + contextLines);

                    hits.push({
                        line: i + 1, // 1-indexed
                        content: lines[i],
                        before: lines.slice(start, i),
                        after: lines.slice(i + 1, end + 1)
                    });

                    // Reset regex lastIndex for global matching
                    regex.lastIndex = 0;
                }
            }

            return hits;
        } catch {
            return [];
        }
    }

    /**
     * Search across all active sessions
     */
    async searchAllSessions(
        pattern: string,
        contextLines: number = 2
    ): Promise<Map<string, TerminalSearchHit[]>> {
        const results = new Map<string, TerminalSearchHit[]>();

        for (const sessionId of this.sessions.keys()) {
            const hits = await this.searchOutput(sessionId, pattern, contextLines);
            if (hits.length > 0) {
                results.set(sessionId, hits);
            }
        }

        return results;
    }

    /**
     * Get summary of session activity
     */
    async getSessionSummary(sessionId: string): Promise<{
        exists: boolean;
        lineCount: number;
        sizeBytes: number;
        startTime: number;
        commandCount: number;
    }> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { exists: false, lineCount: 0, sizeBytes: 0, startTime: 0, commandCount: 0 };
        }

        try {
            const stats = await fs.stat(session.filePath);
            const content = await fs.readFile(session.filePath, 'utf-8');

            // Count command headers (lines starting with =====)
            const commandCount = (content.match(/^={60}$/gm) || []).length / 2;

            return {
                exists: true,
                lineCount: session.lineCount,
                sizeBytes: stats.size,
                startTime: session.startTime,
                commandCount
            };
        } catch {
            return { exists: false, lineCount: 0, sizeBytes: 0, startTime: 0, commandCount: 0 };
        }
    }

    /**
     * Clean up a specific session
     */
    async cleanupSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            try {
                await fs.unlink(session.filePath);
            } catch {
                // Ignore errors
            }
            this.sessions.delete(sessionId);
        }
    }

    /**
     * Clean up all old sessions
     */
    async cleanup(): Promise<number> {
        const maxAge = this.config.maxContextFileAge;
        const now = Date.now();
        let cleaned = 0;

        try {
            const files = await fs.readdir(this.sessionsDir);

            for (const file of files) {
                const filePath = path.join(this.sessionsDir, file);

                try {
                    const stats = await fs.stat(filePath);
                    const age = now - stats.mtimeMs;

                    if (age > maxAge) {
                        await fs.unlink(filePath);
                        cleaned++;

                        // Remove from sessions map if present
                        const sessionId = path.basename(file, '.log');
                        this.sessions.delete(sessionId);
                    }
                } catch {
                    // Ignore individual file errors
                }
            }
        } catch {
            // Directory might not exist yet
        }

        return cleaned;
    }

    /**
     * Format search hits for agent output
     */
    formatSearchHits(hits: TerminalSearchHit[]): string {
        if (hits.length === 0) {
            return 'No matches found.';
        }

        return hits.map(hit => {
            let result = `--- Line ${hit.line} ---\n`;

            if (hit.before.length > 0) {
                result += hit.before.map((l, i) =>
                    `  ${hit.line - hit.before.length + i}: ${l}`
                ).join('\n') + '\n';
            }

            result += `> ${hit.line}: ${hit.content}\n`;

            if (hit.after.length > 0) {
                result += hit.after.map((l, i) =>
                    `  ${hit.line + i + 1}: ${l}`
                ).join('\n') + '\n';
            }

            return result;
        }).join('\n');
    }
}

// Singleton instance
let managerInstance: TerminalSessionManager | null = null;

/**
 * Get the global TerminalSessionManager instance
 */
export function getTerminalSessionManager(config?: Partial<ContextConfig>): TerminalSessionManager {
    if (!managerInstance) {
        managerInstance = new TerminalSessionManager(config);
    }
    return managerInstance;
}
