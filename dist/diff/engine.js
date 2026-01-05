/**
 * Diff Engine
 * Create, parse, and apply unified diffs
 */
import { createTwoFilesPatch, parsePatch, applyPatch as applyPatchLib } from 'diff';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
const execAsync = promisify(exec);
// ============================================================================
// Diff Engine
// ============================================================================
export class DiffEngine {
    projectRoot;
    tempDir;
    isGitRepo = null;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.tempDir = path.join(os.tmpdir(), 'gateflow-patches');
    }
    // ========================================================================
    // Create Diff
    // ========================================================================
    /**
     * Create a unified diff between original and new content
     */
    createDiff(filePath, original, modified, options) {
        const context = options?.context ?? 3;
        const unifiedDiff = createTwoFilesPatch(filePath, filePath, original, modified, 'original', 'modified', { context });
        const stats = this.calculateStats(unifiedDiff);
        return {
            path: filePath,
            originalContent: original,
            newContent: modified,
            unifiedDiff,
            stats
        };
    }
    /**
     * Create diff from file on disk
     */
    async createDiffFromFile(filePath, newContent, options) {
        const absolutePath = path.resolve(filePath);
        let original = '';
        try {
            original = await fs.readFile(absolutePath, 'utf-8');
        }
        catch {
            // File doesn't exist - creating new file
        }
        return this.createDiff(filePath, original, newContent, options);
    }
    // ========================================================================
    // Apply Diff
    // ========================================================================
    /**
     * Apply a patch operation to disk
     * Uses git apply when available, falls back to direct write
     */
    async applyPatch(patch) {
        const absolutePath = path.resolve(patch.path);
        // Try git apply first (if in git repo)
        if (await this.checkGitRepo()) {
            try {
                const result = await this.applyWithGit(patch);
                if (result.success) {
                    return result;
                }
                // Fall through to direct write if git apply fails
            }
            catch {
                // Git apply failed, try direct
            }
        }
        // Try patch library
        try {
            const result = await this.applyWithPatchLib(patch);
            if (result.success) {
                return result;
            }
        }
        catch {
            // Patch lib failed
        }
        // Fallback: direct file write
        return this.applyDirect(patch);
    }
    /**
     * Apply patch using git apply command
     */
    async applyWithGit(patch) {
        const absolutePath = path.resolve(patch.path);
        // Ensure temp directory exists
        await fs.mkdir(this.tempDir, { recursive: true });
        const patchFile = path.join(this.tempDir, `patch-${Date.now()}.patch`);
        try {
            // Write patch file
            await fs.writeFile(patchFile, patch.unifiedDiff, 'utf-8');
            // Apply with git
            await execAsync(`git apply "${patchFile}"`, {
                cwd: this.projectRoot
            });
            return {
                success: true,
                path: absolutePath,
                method: 'git',
                revertable: true
            };
        }
        catch (error) {
            return {
                success: false,
                path: absolutePath,
                method: 'git',
                error: error instanceof Error ? error.message : String(error),
                revertable: false
            };
        }
        finally {
            // Clean up patch file
            try {
                await fs.unlink(patchFile);
            }
            catch { }
        }
    }
    /**
     * Apply patch using diff library
     */
    async applyWithPatchLib(patch) {
        const absolutePath = path.resolve(patch.path);
        try {
            // Read current file
            let current = '';
            try {
                current = await fs.readFile(absolutePath, 'utf-8');
            }
            catch {
                // File doesn't exist
            }
            // Apply patch
            const result = applyPatchLib(current, patch.unifiedDiff);
            if (result === false) {
                return {
                    success: false,
                    path: absolutePath,
                    method: 'patch-lib',
                    error: 'Patch application failed (conflict or offset issue)',
                    revertable: false
                };
            }
            // Write result
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, result, 'utf-8');
            return {
                success: true,
                path: absolutePath,
                method: 'patch-lib',
                revertable: true
            };
        }
        catch (error) {
            return {
                success: false,
                path: absolutePath,
                method: 'patch-lib',
                error: error instanceof Error ? error.message : String(error),
                revertable: false
            };
        }
    }
    /**
     * Direct file write (fallback)
     */
    async applyDirect(patch) {
        const absolutePath = path.resolve(patch.path);
        try {
            // Create backup
            const backupPath = `${absolutePath}.gateflow-backup`;
            try {
                await fs.copyFile(absolutePath, backupPath);
            }
            catch {
                // File doesn't exist, no backup needed
            }
            // Write new content
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, patch.newContent, 'utf-8');
            return {
                success: true,
                path: absolutePath,
                method: 'direct',
                revertable: true
            };
        }
        catch (error) {
            return {
                success: false,
                path: absolutePath,
                method: 'direct',
                error: error instanceof Error ? error.message : String(error),
                revertable: false
            };
        }
    }
    // ========================================================================
    // Revert
    // ========================================================================
    /**
     * Revert a previously applied patch
     */
    async revertPatch(patch) {
        const absolutePath = path.resolve(patch.path);
        // Try git revert first
        if (await this.checkGitRepo()) {
            try {
                // Ensure temp directory exists
                await fs.mkdir(this.tempDir, { recursive: true });
                const patchFile = path.join(this.tempDir, `revert-${Date.now()}.patch`);
                await fs.writeFile(patchFile, patch.unifiedDiff, 'utf-8');
                await execAsync(`git apply -R "${patchFile}"`, {
                    cwd: this.projectRoot
                });
                await fs.unlink(patchFile);
                return {
                    success: true,
                    path: absolutePath,
                    method: 'git',
                    revertable: false
                };
            }
            catch {
                // Fall through
            }
        }
        // Direct restore from original
        try {
            await fs.writeFile(absolutePath, patch.originalContent, 'utf-8');
            return {
                success: true,
                path: absolutePath,
                method: 'direct',
                revertable: false
            };
        }
        catch (error) {
            return {
                success: false,
                path: absolutePath,
                method: 'direct',
                error: error instanceof Error ? error.message : String(error),
                revertable: false
            };
        }
    }
    // ========================================================================
    // Parse
    // ========================================================================
    /**
     * Parse a unified diff string
     */
    parseDiff(diff) {
        return parsePatch(diff);
    }
    /**
     * Extract hunks from a diff
     */
    getHunks(diff) {
        const parsed = parsePatch(diff);
        const hunks = [];
        for (const file of parsed) {
            for (const hunk of file.hunks) {
                hunks.push({
                    oldStart: hunk.oldStart,
                    oldLines: hunk.oldLines,
                    newStart: hunk.newStart,
                    newLines: hunk.newLines,
                    lines: hunk.lines
                });
            }
        }
        return hunks;
    }
    // ========================================================================
    // Utilities
    // ========================================================================
    /**
     * Calculate diff statistics
     */
    calculateStats(diff) {
        const lines = diff.split('\n');
        let added = 0;
        let removed = 0;
        let chunks = 0;
        for (const line of lines) {
            if (line.startsWith('@@')) {
                chunks++;
            }
            else if (line.startsWith('+') && !line.startsWith('+++')) {
                added++;
            }
            else if (line.startsWith('-') && !line.startsWith('---')) {
                removed++;
            }
        }
        return { added, removed, chunks };
    }
    /**
     * Check if we're in a git repository
     */
    async checkGitRepo() {
        if (this.isGitRepo !== null) {
            return this.isGitRepo;
        }
        try {
            await execAsync('git rev-parse --git-dir', {
                cwd: this.projectRoot
            });
            this.isGitRepo = true;
        }
        catch {
            this.isGitRepo = false;
        }
        return this.isGitRepo;
    }
    /**
     * Get git status for a file
     */
    async getGitStatus(filePath) {
        if (!(await this.checkGitRepo())) {
            return 'unknown';
        }
        try {
            const { stdout } = await execAsync(`git status --porcelain "${filePath}"`, {
                cwd: this.projectRoot
            });
            const status = stdout.trim();
            if (!status)
                return 'unchanged';
            if (status.startsWith('??'))
                return 'untracked';
            if (status.startsWith(' M') || status.startsWith('M '))
                return 'modified';
            return 'modified';
        }
        catch {
            return 'unknown';
        }
    }
    /**
     * Check if diff can be applied cleanly
     */
    async canApplyCleanly(patch) {
        const absolutePath = path.resolve(patch.path);
        try {
            let current = '';
            try {
                current = await fs.readFile(absolutePath, 'utf-8');
            }
            catch {
                // File doesn't exist - that's fine for new files
                return true;
            }
            // Try to apply with diff lib
            const result = applyPatchLib(current, patch.unifiedDiff);
            return result !== false;
        }
        catch {
            return false;
        }
    }
    /**
     * Validate a patch string
     */
    validatePatch(diff) {
        try {
            const parsed = parsePatch(diff);
            if (parsed.length === 0) {
                return { valid: false, error: 'No patches found in diff' };
            }
            return { valid: true };
        }
        catch (error) {
            return {
                valid: false,
                error: error instanceof Error ? error.message : 'Invalid patch format'
            };
        }
    }
}
