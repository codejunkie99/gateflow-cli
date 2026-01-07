/**
 * Context File Manager
 *
 * Implements Cursor's "Long Tool Responses as Files" strategy:
 * - Write large tool outputs to temporary files
 * - Return file reference + summary instead of full content
 * - Agent reads portions on-demand via read_context_output
 * - Expected 30-40% token reduction for verification sessions
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ContextFileRef, FileSummary, ReadOptions, ContextConfig } from './types.js';
import { DEFAULT_CONTEXT_CONFIG } from './types.js';

// ============================================================================
// Context File Manager
// ============================================================================

export class ContextFileManager {
    private config: ContextConfig;
    private contextDir: string;
    private initialized: boolean = false;
    private activeRefs: Map<string, ContextFileRef> = new Map();

    constructor(config?: Partial<ContextConfig>) {
        this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };

        // Set default context directory
        if (!this.config.contextFileDir) {
            this.config.contextFileDir = path.join(os.tmpdir(), 'gateflow-context');
        }
        this.contextDir = this.config.contextFileDir;
    }

    /**
     * Initialize the context directory
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await fs.mkdir(this.contextDir, { recursive: true });
            this.initialized = true;

            // Run cleanup of old files on startup
            await this.cleanup();
        } catch (error) {
            throw new Error(`Failed to initialize context directory: ${error}`);
        }
    }

    /**
     * Write tool output to a context file
     * Returns a reference that the agent can use to read portions
     */
    async writeOutput(
        toolName: string,
        sessionId: string,
        output: string
    ): Promise<ContextFileRef> {
        await this.initialize();

        const timestamp = Date.now();
        const filename = `${toolName}-${sessionId}-${timestamp}.txt`;
        const filePath = path.join(this.contextDir, filename);

        // Write the output
        await fs.writeFile(filePath, output, 'utf-8');

        // Count lines
        const lineCount = output.split('\n').length;
        const size = Buffer.byteLength(output, 'utf-8');

        const ref: ContextFileRef = {
            path: filePath,
            toolName,
            sessionId,
            size,
            lineCount,
            timestamp
        };

        // Track active refs for cleanup
        this.activeRefs.set(filePath, ref);

        return ref;
    }

    /**
     * Get a summary of a context file (first and last N lines)
     * This is what gets returned to the agent instead of full content
     */
    async getSummary(ref: ContextFileRef): Promise<FileSummary> {
        const content = await fs.readFile(ref.path, 'utf-8');
        const lines = content.split('\n');

        const n = this.config.summaryLines;
        const firstLines = lines.slice(0, n).join('\n');
        const lastLines = lines.slice(-n).join('\n');

        return {
            firstLines,
            lastLines,
            size: ref.size,
            lineCount: ref.lineCount
        };
    }

    /**
     * Read a portion of a context file
     * Supports head, tail, or range reads
     */
    async readOutput(refPath: string, options: ReadOptions = {}): Promise<string> {
        const content = await fs.readFile(refPath, 'utf-8');
        const lines = content.split('\n');

        // Handle different read modes
        if (options.head !== undefined && options.head > 0) {
            return lines.slice(0, options.head).join('\n');
        }

        if (options.tail !== undefined && options.tail > 0) {
            return lines.slice(-options.tail).join('\n');
        }

        if (options.startLine !== undefined && options.endLine !== undefined) {
            // Convert to 0-indexed
            const start = Math.max(0, options.startLine - 1);
            const end = Math.min(lines.length, options.endLine);
            return lines.slice(start, end).join('\n');
        }

        if (options.startLine !== undefined) {
            const start = Math.max(0, options.startLine - 1);
            return lines.slice(start).join('\n');
        }

        // Return full content if no options specified
        return content;
    }

    /**
     * Check if a context file exists
     */
    async exists(refPath: string): Promise<boolean> {
        try {
            await fs.access(refPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Delete a specific context file
     */
    async delete(refPath: string): Promise<void> {
        try {
            await fs.unlink(refPath);
            this.activeRefs.delete(refPath);
        } catch {
            // Ignore errors (file may already be deleted)
        }
    }

    /**
     * Clean up all context files for a session
     */
    async cleanupSession(sessionId: string): Promise<void> {
        const toDelete: string[] = [];

        for (const [filePath, ref] of this.activeRefs) {
            if (ref.sessionId === sessionId) {
                toDelete.push(filePath);
            }
        }

        await Promise.all(toDelete.map(p => this.delete(p)));
    }

    /**
     * Clean up old context files (beyond maxContextFileAge)
     */
    async cleanup(): Promise<number> {
        const maxAge = this.config.maxContextFileAge;
        const now = Date.now();
        let cleaned = 0;

        try {
            const files = await fs.readdir(this.contextDir);

            for (const file of files) {
                const filePath = path.join(this.contextDir, file);

                try {
                    const stats = await fs.stat(filePath);
                    const age = now - stats.mtimeMs;

                    if (age > maxAge) {
                        await fs.unlink(filePath);
                        this.activeRefs.delete(filePath);
                        cleaned++;
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
     * Get statistics about context files
     */
    async getStats(): Promise<{
        fileCount: number;
        totalSize: number;
        oldestFile: number;
        newestFile: number;
    }> {
        let fileCount = 0;
        let totalSize = 0;
        let oldestFile = Date.now();
        let newestFile = 0;

        try {
            const files = await fs.readdir(this.contextDir);

            for (const file of files) {
                const filePath = path.join(this.contextDir, file);

                try {
                    const stats = await fs.stat(filePath);
                    fileCount++;
                    totalSize += stats.size;
                    oldestFile = Math.min(oldestFile, stats.mtimeMs);
                    newestFile = Math.max(newestFile, stats.mtimeMs);
                } catch {
                    // Ignore individual file errors
                }
            }
        } catch {
            // Directory might not exist
        }

        return { fileCount, totalSize, oldestFile, newestFile };
    }

    /**
     * Format a file reference for agent output
     * This is what gets returned instead of full output
     */
    formatRefForAgent(ref: ContextFileRef, summary: FileSummary): string {
        const sizeKB = (ref.size / 1024).toFixed(1);

        let result = `[Output stored in context file]\n`;
        result += `Reference: ${ref.path}\n`;
        result += `Size: ${sizeKB} KB (${ref.lineCount} lines)\n\n`;
        result += `--- First ${this.config.summaryLines} lines ---\n`;
        result += summary.firstLines;
        result += `\n\n--- Last ${this.config.summaryLines} lines ---\n`;
        result += summary.lastLines;
        result += `\n\nUse read_context_output to read more of this output.`;

        return result;
    }

    /**
     * Determine if output should be stored as a file
     * Based on size thresholds
     */
    shouldStoreAsFile(output: string): boolean {
        if (!this.config.enableContextFiles) return false;

        // Store as file if > 2KB or > 50 lines
        const size = Buffer.byteLength(output, 'utf-8');
        const lines = output.split('\n').length;

        return size > 2048 || lines > 50;
    }
}

// Singleton instance
let managerInstance: ContextFileManager | null = null;

/**
 * Get the global ContextFileManager instance
 */
export function getContextFileManager(config?: Partial<ContextConfig>): ContextFileManager {
    if (!managerInstance) {
        managerInstance = new ContextFileManager(config);
    }
    return managerInstance;
}
