/**
 * Edit Tools
 * Line-based and search/replace edits with diff preview
 */
import fs from 'fs/promises';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import { requestApprovalSync, shouldAutoApprove, isApproved } from './approval.js';
// ============================================================================
// Edit Tools Class
// ============================================================================
export class EditTools {
    bus;
    policy;
    projectRoot;
    constructor(bus, policy, projectRoot = process.cwd()) {
        this.bus = bus;
        this.policy = policy;
        this.projectRoot = projectRoot;
    }
    resolvePath(filePath) {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.resolve(this.projectRoot, filePath);
    }
    // ========================================================================
    // Edit Lines
    // ========================================================================
    async editLines(filePath, edits, options) {
        const absolutePath = this.resolvePath(filePath);
        // Policy check
        const decision = this.policy.checkTool('edit_lines', { filePath: absolutePath });
        if (!decision.allowed) {
            return {
                success: false,
                path: absolutePath,
                error: decision.reason ?? 'Edit not allowed by policy'
            };
        }
        this.bus.emit({
            type: 'tool_call',
            tool: 'edit_lines',
            argsSummary: `${path.basename(filePath)} (${edits.length} edit${edits.length === 1 ? '' : 's'})`,
            args: { filePath, editCount: edits.length }
        });
        try {
            // Read original file
            const originalContent = await fs.readFile(absolutePath, 'utf-8');
            const originalLines = originalContent.split('\n');
            // Sort edits by line number (descending to apply from bottom up)
            const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);
            // Validate edits
            for (const edit of sortedEdits) {
                if (edit.startLine < 1 || edit.endLine > originalLines.length) {
                    return {
                        success: false,
                        path: absolutePath,
                        error: `Invalid line range: ${edit.startLine}-${edit.endLine} (file has ${originalLines.length} lines)`
                    };
                }
                if (edit.startLine > edit.endLine) {
                    return {
                        success: false,
                        path: absolutePath,
                        error: `Invalid line range: start (${edit.startLine}) > end (${edit.endLine})`
                    };
                }
            }
            // Apply edits
            const newLines = [...originalLines];
            for (const edit of sortedEdits) {
                const newContentLines = edit.newContent.split('\n');
                newLines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...newContentLines);
            }
            const newContent = newLines.join('\n');
            // Generate diff
            const diff = createTwoFilesPatch(filePath, filePath, originalContent, newContent, 'original', 'modified');
            // Calculate stats
            const stats = this.calculateDiffStats(originalLines.length, newLines.length, diff);
            // Emit diff preview
            this.bus.emit({
                type: 'diff_preview',
                path: filePath,
                unifiedDiff: diff,
                stats
            });
            // Dry run - don't apply
            if (options?.dryRun) {
                this.bus.emit({
                    type: 'tool_result',
                    tool: 'edit_lines',
                    ok: true,
                    summary: `Dry run: ${stats.added} added, ${stats.removed} removed`
                });
                return {
                    success: true,
                    path: absolutePath,
                    diff,
                    stats,
                    applied: false
                };
            }
            // Request approval if required (synchronous to avoid deadlock)
            if (decision.requiresApproval && !options?.skipApproval) {
                const autoApprove = shouldAutoApprove(filePath) || isApproved('edit_lines');
                if (!autoApprove) {
                    const approval = requestApprovalSync('edit_lines', `Edit ${edits.length} region(s) in ${filePath}`, { diff });
                    if (!approval.approved) {
                        this.bus.emit({
                            type: 'tool_result',
                            tool: 'edit_lines',
                            ok: false,
                            summary: 'User rejected'
                        });
                        return {
                            success: false,
                            path: absolutePath,
                            diff,
                            stats,
                            error: 'User rejected edit',
                            applied: false
                        };
                    }
                    if (approval.scope === 'session') {
                        this.policy.grantApproval('edit_lines', 'session', filePath);
                    }
                }
            }
            // Apply changes
            await fs.writeFile(absolutePath, newContent, 'utf-8');
            this.bus.emit({
                type: 'tool_result',
                tool: 'edit_lines',
                ok: true,
                summary: `Applied: ${stats.added} added, ${stats.removed} removed`
            });
            return {
                success: true,
                path: absolutePath,
                diff,
                stats,
                applied: true
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'tool_result',
                tool: 'edit_lines',
                ok: false,
                summary: `Failed: ${errorMsg}`
            });
            return {
                success: false,
                path: absolutePath,
                error: errorMsg
            };
        }
    }
    // ========================================================================
    // Search and Replace
    // ========================================================================
    async searchReplace(filePath, search, replace, options) {
        const absolutePath = this.resolvePath(filePath);
        // Policy check
        const decision = this.policy.checkTool('search_replace', { filePath: absolutePath });
        if (!decision.allowed) {
            return {
                success: false,
                path: absolutePath,
                replacements: 0,
                error: decision.reason ?? 'Edit not allowed by policy'
            };
        }
        this.bus.emit({
            type: 'tool_call',
            tool: 'search_replace',
            argsSummary: `"${search}" → "${replace}" in ${path.basename(filePath)}`,
            args: { filePath, search, replace, all: options?.all }
        });
        try {
            // Read original file
            const originalContent = await fs.readFile(absolutePath, 'utf-8');
            // Build regex
            let regex;
            if (options?.isRegex) {
                const flags = (options?.caseSensitive ? '' : 'i') + (options?.all ? 'g' : '');
                regex = new RegExp(search, flags);
            }
            else {
                // Escape special characters for literal search
                const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const flags = (options?.caseSensitive ? '' : 'i') + (options?.all ? 'g' : '');
                regex = new RegExp(escaped, flags);
            }
            // Count replacements
            const matches = originalContent.match(new RegExp(regex.source, regex.flags + 'g'));
            const replacementCount = options?.all ? (matches?.length ?? 0) : (matches ? 1 : 0);
            if (replacementCount === 0) {
                this.bus.emit({
                    type: 'tool_result',
                    tool: 'search_replace',
                    ok: true,
                    summary: 'No matches found'
                });
                return {
                    success: true,
                    path: absolutePath,
                    replacements: 0,
                    applied: false
                };
            }
            // Apply replacement
            const newContent = options?.all
                ? originalContent.replace(new RegExp(regex.source, regex.flags), replace)
                : originalContent.replace(regex, replace);
            // Generate diff
            const diff = createTwoFilesPatch(filePath, filePath, originalContent, newContent, 'original', 'modified');
            // Calculate stats
            const originalLineCount = originalContent.split('\n').length;
            const newLineCount = newContent.split('\n').length;
            const stats = this.calculateDiffStats(originalLineCount, newLineCount, diff);
            // Emit diff preview
            this.bus.emit({
                type: 'diff_preview',
                path: filePath,
                unifiedDiff: diff,
                stats
            });
            // Dry run
            if (options?.dryRun) {
                this.bus.emit({
                    type: 'tool_result',
                    tool: 'search_replace',
                    ok: true,
                    summary: `Dry run: ${replacementCount} replacement(s)`
                });
                return {
                    success: true,
                    path: absolutePath,
                    replacements: replacementCount,
                    diff,
                    stats,
                    applied: false
                };
            }
            // Request approval if required (synchronous to avoid deadlock)
            if (decision.requiresApproval && !options?.skipApproval) {
                const autoApprove = shouldAutoApprove(filePath) || isApproved('search_replace');
                if (!autoApprove) {
                    const approval = requestApprovalSync('search_replace', `Replace ${replacementCount} occurrence(s) in ${filePath}`, { diff });
                    if (!approval.approved) {
                        this.bus.emit({
                            type: 'tool_result',
                            tool: 'search_replace',
                            ok: false,
                            summary: 'User rejected'
                        });
                        return {
                            success: false,
                            path: absolutePath,
                            replacements: replacementCount,
                            diff,
                            stats,
                            error: 'User rejected replacement',
                            applied: false
                        };
                    }
                    if (approval.scope === 'session') {
                        this.policy.grantApproval('search_replace', 'session', filePath);
                    }
                }
            }
            // Apply changes
            await fs.writeFile(absolutePath, newContent, 'utf-8');
            this.bus.emit({
                type: 'tool_result',
                tool: 'search_replace',
                ok: true,
                summary: `Replaced ${replacementCount} occurrence(s)`
            });
            return {
                success: true,
                path: absolutePath,
                replacements: replacementCount,
                diff,
                stats,
                applied: true
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'tool_result',
                tool: 'search_replace',
                ok: false,
                summary: `Failed: ${errorMsg}`
            });
            return {
                success: false,
                path: absolutePath,
                replacements: 0,
                error: errorMsg
            };
        }
    }
    // ========================================================================
    // Insert Lines
    // ========================================================================
    async insertLines(filePath, afterLine, content, options) {
        return this.editLines(filePath, [{
                startLine: afterLine + 1,
                endLine: afterLine, // Empty range = insert
                newContent: content
            }], options);
    }
    // ========================================================================
    // Delete Lines
    // ========================================================================
    async deleteLines(filePath, startLine, endLine, options) {
        return this.editLines(filePath, [{
                startLine,
                endLine,
                newContent: '' // Empty content = delete
            }], options);
    }
    // ========================================================================
    // Replace File Content
    // ========================================================================
    async replaceContent(filePath, newContent, options) {
        const absolutePath = this.resolvePath(filePath);
        try {
            const originalContent = await fs.readFile(absolutePath, 'utf-8');
            const lineCount = originalContent.split('\n').length;
            return this.editLines(filePath, [{
                    startLine: 1,
                    endLine: lineCount,
                    newContent
                }], options);
        }
        catch (error) {
            return {
                success: false,
                path: absolutePath,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    // ========================================================================
    // Helpers
    // ========================================================================
    calculateDiffStats(originalLines, newLines, diff) {
        // Count +/- lines in diff (excluding header lines)
        const lines = diff.split('\n');
        let added = 0;
        let removed = 0;
        for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                added++;
            }
            else if (line.startsWith('-') && !line.startsWith('---')) {
                removed++;
            }
        }
        return { added, removed };
    }
    /**
     * Generate a unified diff between two strings
     */
    generateDiff(filePath, original, modified) {
        return createTwoFilesPatch(filePath, filePath, original, modified, 'original', 'modified');
    }
}
