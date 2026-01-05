/**
 * Diff Engine
 * Create, parse, and apply unified diffs
 */
import type { ParsedDiff } from 'diff';
export interface DiffStats {
    added: number;
    removed: number;
    chunks: number;
}
export interface PatchOperation {
    path: string;
    originalContent: string;
    newContent: string;
    unifiedDiff: string;
    stats: DiffStats;
}
export interface ApplyResult {
    success: boolean;
    path: string;
    method: 'git' | 'direct' | 'patch-lib';
    error?: string;
    revertable: boolean;
}
export interface ParsedHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
}
export declare class DiffEngine {
    private projectRoot;
    private tempDir;
    private isGitRepo;
    constructor(projectRoot: string);
    /**
     * Create a unified diff between original and new content
     */
    createDiff(filePath: string, original: string, modified: string, options?: {
        context?: number;
    }): PatchOperation;
    /**
     * Create diff from file on disk
     */
    createDiffFromFile(filePath: string, newContent: string, options?: {
        context?: number;
    }): Promise<PatchOperation>;
    /**
     * Apply a patch operation to disk
     * Uses git apply when available, falls back to direct write
     */
    applyPatch(patch: PatchOperation): Promise<ApplyResult>;
    /**
     * Apply patch using git apply command
     */
    private applyWithGit;
    /**
     * Apply patch using diff library
     */
    private applyWithPatchLib;
    /**
     * Direct file write (fallback)
     */
    private applyDirect;
    /**
     * Revert a previously applied patch
     */
    revertPatch(patch: PatchOperation): Promise<ApplyResult>;
    /**
     * Parse a unified diff string
     */
    parseDiff(diff: string): ParsedDiff[];
    /**
     * Extract hunks from a diff
     */
    getHunks(diff: string): ParsedHunk[];
    /**
     * Calculate diff statistics
     */
    calculateStats(diff: string): DiffStats;
    /**
     * Check if we're in a git repository
     */
    checkGitRepo(): Promise<boolean>;
    /**
     * Get git status for a file
     */
    getGitStatus(filePath: string): Promise<'modified' | 'untracked' | 'unchanged' | 'unknown'>;
    /**
     * Check if diff can be applied cleanly
     */
    canApplyCleanly(patch: PatchOperation): Promise<boolean>;
    /**
     * Validate a patch string
     */
    validatePatch(diff: string): {
        valid: boolean;
        error?: string;
    };
}
