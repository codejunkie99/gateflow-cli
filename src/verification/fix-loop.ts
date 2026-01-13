/**
 * Fix Loop with Attempt Memory
 * Iterative lint-fix cycle with thrashing prevention
 */

import type { EventBus } from '../events/index.js';
import type { Verilator, LintError, LintResult } from './verilator.js';
import type { GateFlowAgent } from '../agent/core.js';
import type { FileTools } from '../fileops/file.js';
import type { KnowledgeStore } from '../memory/KnowledgeStore.js';
import { getSystemPrompt } from '../agent/prompts.js';

// ============================================================================
// Types
// ============================================================================

export interface FixLoopConfig {
    /** Maximum fix attempts */
    maxAttempts: number;
    /** Maximum identical fixes before giving up */
    maxIdenticalFixes: number;
    /** Confidence threshold for auto-fix (0-1) */
    autoFixThreshold: number;
    /** Require approval for fixes */
    requireApproval: boolean;
}

export interface FixAttempt {
    errorSignature: string;
    fix: string;
    success: boolean;
    timestamp: number;
}

export interface FixLoopResult {
    success: boolean;
    initialErrors: LintError[];
    finalErrors: LintError[];
    attemptCount: number;
    fixedCount: number;
    thrashingDetected: boolean;
    duration: number;
}

// ============================================================================
// Fix Loop Implementation
// ============================================================================

export class FixLoop {
    private config: FixLoopConfig;
    private attemptMemory: Map<string, FixAttempt[]> = new Map();
    private currentSession: FixAttempt[] = [];

    constructor(
        private bus: EventBus,
        private verilator: Verilator,
        private agent: GateFlowAgent,
        private fileTools: FileTools,
        config?: Partial<FixLoopConfig>
    ) {
        this.config = {
            maxAttempts: config?.maxAttempts ?? 5,
            maxIdenticalFixes: config?.maxIdenticalFixes ?? 2,
            autoFixThreshold: config?.autoFixThreshold ?? 0.8,
            requireApproval: config?.requireApproval ?? false
        };
    }

    // ========================================================================
    // Main Fix Loop
    // ========================================================================

    /**
     * Run the fix loop for a file
     */
    async run(filePath: string): Promise<FixLoopResult> {
        const startTime = Date.now();
        this.currentSession = [];

        this.bus.emit({
            type: 'status',
            phase: 'fixing',
            label: `Starting fix loop for ${filePath}`
        });

        // Initial lint
        const initialResult = await this.verilator.lint(filePath);
        const initialErrors = [...initialResult.errors];

        if (initialResult.success) {
            return {
                success: true,
                initialErrors: [],
                finalErrors: [],
                attemptCount: 0,
                fixedCount: 0,
                thrashingDetected: false,
                duration: Date.now() - startTime
            };
        }

        let currentResult = initialResult;
        let attemptCount = 0;
        let fixedCount = 0;
        let thrashingDetected = false;

        while (
            !currentResult.success &&
            attemptCount < this.config.maxAttempts &&
            !thrashingDetected
        ) {
            attemptCount++;

            this.bus.emit({
                type: 'status',
                phase: 'fixing',
                label: `Fix attempt ${attemptCount}/${this.config.maxAttempts} (${currentResult.errors.length} errors)`
            });

            // Check for thrashing
            const thrashResult = this.checkThrashing(currentResult.errors);
            if (thrashResult.thrashing) {
                thrashingDetected = true;
                this.bus.emit({
                    type: 'error',
                    message: `Thrashing detected: ${thrashResult.reason}`,
                    recoverable: true
                });
                break;
            }

            // Read file content
            const fileResult = await this.fileTools.readFile(filePath);
            const fileContent = fileResult.success && fileResult.content 
                ? fileResult.content 
                : '(Could not read file)';

            // Generate fix with agent (force lint_fix mode)
            const fixPrompt = this.buildFixPrompt(filePath, currentResult.errors, fileContent);
            
            try {
                await this.agent.run(fixPrompt, {
                    mode: 'lint_fix', // Force lint_fix mode for fix loop
                    onToolCall: (name, args) => {
                        // Record edit attempts for thrashing detection
                        if (name === 'edit_lines' || name === 'search_replace' || name === 'write_file') {
                            this.recordAttempt(currentResult.errors, JSON.stringify(args));
                        }
                    }
                });

                // Re-lint after fix
                const newResult = await this.verilator.lint(filePath);
                
                // Count fixed errors
                const prevErrorCount = currentResult.errors.length;
                const newErrorCount = newResult.errors.length;
                const fixedThisRound = prevErrorCount - newErrorCount;

                if (fixedThisRound > 0) {
                    fixedCount += fixedThisRound;
                    
                    this.bus.emit({
                        type: 'tool_result',
                        tool: 'fix_attempt',
                        ok: true,
                        summary: `Fixed ${fixedThisRound} error(s), ${newErrorCount} remaining`
                    });
                }

                // Check if we made progress
                if (!this.madeProgress(currentResult, newResult)) {
                    this.bus.emit({
                        type: 'error',
                        message: 'Fix attempt made no progress',
                        recoverable: true
                    });
                    
                    // Mark this attempt as unsuccessful
                    this.markAttemptFailed(currentResult.errors);
                }

                currentResult = newResult;

            } catch (error) {
                this.bus.emit({
                    type: 'error',
                    message: `Fix attempt failed: ${error}`,
                    recoverable: true
                });
                break;
            }
        }

        const result: FixLoopResult = {
            success: currentResult.success,
            initialErrors,
            finalErrors: currentResult.errors,
            attemptCount,
            fixedCount,
            thrashingDetected,
            duration: Date.now() - startTime
        };

        this.bus.emit({
            type: 'tool_result',
            tool: 'fix_loop',
            ok: result.success,
            summary: this.summarizeResult(result),
            duration: result.duration
        });

        return result;
    }

    // ========================================================================
    // Thrashing Detection
    // ========================================================================

    /**
     * Check if we're thrashing (making the same fixes repeatedly)
     */
    private checkThrashing(errors: LintError[]): {
        thrashing: boolean;
        reason?: string;
    } {
        // Get error signatures
        const signatures = errors.map(e => this.getErrorSignature(e));

        // Check each error
        for (const sig of signatures) {
            const attempts = this.attemptMemory.get(sig) ?? [];
            const sessionAttempts = this.currentSession.filter(a => a.errorSignature === sig);

            // Too many attempts for this error
            if (sessionAttempts.length >= this.config.maxAttempts) {
                return {
                    thrashing: true,
                    reason: `Max attempts (${this.config.maxAttempts}) reached for error: ${sig.slice(0, 50)}`
                };
            }

            // Check for identical fixes
            const fixCounts = new Map<string, number>();
            for (const attempt of [...attempts, ...sessionAttempts]) {
                const count = (fixCounts.get(attempt.fix) ?? 0) + 1;
                fixCounts.set(attempt.fix, count);

                if (count >= this.config.maxIdenticalFixes) {
                    return {
                        thrashing: true,
                        reason: `Same fix attempted ${count} times`
                    };
                }
            }
        }

        return { thrashing: false };
    }

    /**
     * Get a signature for an error (for deduplication)
     */
    private getErrorSignature(error: LintError): string {
        // Normalize file path
        const file = error.file.split(/[/\\]/).pop() ?? error.file;
        // Ignore line number to handle code shifts during editing
        // We rely on the error code and message content
        return `${error.code}:${file}:${error.message.replace(/\s+/g, ' ').trim()}`;
    }

    /**
     * Record a fix attempt
     */
    private recordAttempt(errors: LintError[], fix: string): void {
        const timestamp = Date.now();

        for (const error of errors) {
            const signature = this.getErrorSignature(error);
            
            const attempt: FixAttempt = {
                errorSignature: signature,
                fix,
                success: false, // Will be updated later
                timestamp
            };

            this.currentSession.push(attempt);

            // Update memory
            const existing = this.attemptMemory.get(signature) ?? [];
            existing.push(attempt);
            this.attemptMemory.set(signature, existing);
        }
    }

    /**
     * Mark attempts as failed
     */
    private markAttemptFailed(errors: LintError[]): void {
        const signatures = new Set(errors.map(e => this.getErrorSignature(e)));

        // Mark recent attempts for these errors as failed
        for (let i = this.currentSession.length - 1; i >= 0; i--) {
            if (signatures.has(this.currentSession[i].errorSignature)) {
                this.currentSession[i].success = false;
            }
        }
    }

    /**
     * Check if we made progress between lint results
     */
    private madeProgress(prev: LintResult, next: LintResult): boolean {
        // Fewer errors
        if (next.errors.length < prev.errors.length) {
            return true;
        }

        // Different errors (might be progress even if count is same)
        const prevSigs = new Set(prev.errors.map(e => this.getErrorSignature(e)));
        const nextSigs = new Set(next.errors.map(e => this.getErrorSignature(e)));

        // New errors that weren't there before
        for (const sig of nextSigs) {
            if (!prevSigs.has(sig)) {
                // If we fixed something and introduced something new, it might be progress
                for (const oldSig of prevSigs) {
                    if (!nextSigs.has(oldSig)) {
                        return true; // Something changed
                    }
                }
            }
        }

        return false;
    }

    // ========================================================================
    // Prompt Building
    // ========================================================================

    /**
     * Build the fix prompt for the agent
     * Note: The lint_fix system prompt provides the fix strategy and methodology.
     * This prompt provides the specific errors and context.
     */
    private buildFixPrompt(filePath: string, errors: LintError[], fileContent: string): string {
        const errorList = errors
            .slice(0, 10) // Limit to avoid prompt explosion
            .map(e => `- Line ${e.line}: [${e.code}] ${e.message}`)
            .join('\n');

        const pastAttempts = this.getPastAttemptsContext(errors);

        return `## Task: Fix Verilator Errors

File: ${filePath}

### Current File Content
\`\`\`systemverilog
${fileContent}
\`\`\`

### Errors to Fix
${errorList}
${pastAttempts}

### Instructions
1. Review the file content and errors above
2. Identify root cause (one fix often resolves multiple errors)
3. Apply minimal targeted edits (prefer edit_lines or search_replace)
4. The file will be re-linted automatically after your fix`;
    }

    /**
     * Get context about past failed attempts
     */
    private getPastAttemptsContext(errors: LintError[]): string {
        const failedFixes: string[] = [];

        for (const error of errors) {
            const sig = this.getErrorSignature(error);
            const attempts = this.attemptMemory.get(sig) ?? [];
            const failed = attempts.filter(a => !a.success);

            if (failed.length > 0) {
                failedFixes.push(
                    `Error "${sig.slice(0, 50)}..." - ${failed.length} previous fix attempt(s) failed`
                );
            }
        }

        if (failedFixes.length === 0) {
            return '';
        }

        return `\nNote: Some of these errors have been attempted before without success:
${failedFixes.join('\n')}

Please try a DIFFERENT approach than previous attempts.`;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private summarizeResult(result: FixLoopResult): string {
        if (result.success) {
            return `All errors fixed in ${result.attemptCount} attempt(s)`;
        }

        if (result.thrashingDetected) {
            return `Stopped due to thrashing (${result.fixedCount} fixed, ${result.finalErrors.length} remaining)`;
        }

        return `Fixed ${result.fixedCount} errors, ${result.finalErrors.length} remaining after ${result.attemptCount} attempts`;
    }

    /**
     * Clear attempt memory
     */
    clearMemory(): void {
        this.attemptMemory.clear();
        this.currentSession = [];
    }

    /**
     * Get attempt statistics
     */
    getStats(): {
        totalAttempts: number;
        uniqueErrors: number;
        successRate: number;
    } {
        let total = 0;
        let successful = 0;

        for (const attempts of this.attemptMemory.values()) {
            for (const attempt of attempts) {
                total++;
                if (attempt.success) successful++;
            }
        }

        return {
            totalAttempts: total,
            uniqueErrors: this.attemptMemory.size,
            successRate: total > 0 ? successful / total : 0
        };
    }

    // ========================================================================
    // Knowledge Store Persistence
    // ========================================================================

    /**
     * Persist fix attempt patterns to the knowledge store
     *
     * This should be called after a fix loop session completes.
     * Patterns that have been seen multiple times are persisted for
     * future reference and thrashing detection across sessions.
     *
     * @param knowledgeStore - KnowledgeStore instance to persist to
     * @returns Number of patterns persisted
     */
    async persistAttemptMemory(knowledgeStore: KnowledgeStore): Promise<number> {
        let persisted = 0;

        for (const [signature, attempts] of this.attemptMemory) {
            // Only persist patterns seen multiple times (more likely to be real patterns)
            if (attempts.length < 2) {
                continue;
            }

            // Calculate success metrics
            const successful = attempts.filter(a => a.success);
            const total = attempts.length;
            const successRate = successful.length / total;

            // Determine confidence based on success rate and sample size
            const confidence = this.calculatePatternConfidence(successRate, total);

            // Skip low-confidence patterns
            if (confidence < 0.3) {
                continue;
            }

            // Build knowledge item
            const item = {
                type: 'lint_fix' as const,
                title: `Fix pattern: ${this.truncateSignature(signature)}`,
                content: this.formatAttemptContent(signature, attempts, successful),
                tags: this.buildPatternTags(signature, successRate),
                keywords: this.extractKeywordsFromSignature(signature),
                scope: {
                    global: false,
                    projectIds: [knowledgeStore.getProjectId()]
                },
                source: {
                    method: 'tool_result' as const,
                    tool: 'fix-loop'
                },
                confidence
            };

            try {
                knowledgeStore.addKnowledge(item);
                persisted++;
            } catch (error) {
                // Log but continue with other patterns
                console.warn(
                    `[FixLoop] Failed to persist pattern:`,
                    error instanceof Error ? error.message : error
                );
            }
        }

        return persisted;
    }

    /**
     * Load relevant historical patterns from knowledge store
     *
     * This pre-populates attemptMemory with patterns from previous
     * sessions that may be relevant to the current file.
     *
     * @param knowledgeStore - KnowledgeStore to load from
     * @param filePath - File being fixed (for relevance filtering)
     */
    async loadHistoricalPatterns(
        knowledgeStore: KnowledgeStore,
        filePath: string
    ): Promise<number> {
        const results = knowledgeStore.search({
            types: ['lint_fix'],
            filePath,
            maxResults: 20,
            minConfidence: 0.3
        });

        let loaded = 0;

        for (const result of results) {
            // Extract signature from title
            const signatureMatch = result.item.title.match(/Fix pattern: (.+)/);
            if (!signatureMatch) continue;

            const signature = signatureMatch[1];

            // Create a synthetic attempt from the stored pattern
            // This is used for thrashing detection
            if (!this.attemptMemory.has(signature)) {
                this.attemptMemory.set(signature, [{
                    errorSignature: signature,
                    fix: 'historical',  // Marker for historical pattern
                    success: result.item.tags.includes('high-success'),
                    timestamp: result.item.lastAccessed
                }]);
                loaded++;
            }
        }

        return loaded;
    }

    // ========================================================================
    // Persistence Helper Methods
    // ========================================================================

    /**
     * Calculate confidence score for a fix pattern
     */
    private calculatePatternConfidence(successRate: number, sampleSize: number): number {
        // Base confidence from success rate
        let confidence = successRate;

        // Bonus for larger sample sizes (more reliable)
        if (sampleSize >= 5) {
            confidence += 0.1;
        } else if (sampleSize >= 3) {
            confidence += 0.05;
        }

        // Penalty for very low success rates
        if (successRate < 0.2) {
            confidence *= 0.5;  // Still useful to know what doesn't work
        }

        // Clamp to valid range
        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Truncate error signature for display
     */
    private truncateSignature(signature: string): string {
        const maxLength = 60;
        if (signature.length <= maxLength) {
            return signature;
        }
        return signature.slice(0, maxLength - 3) + '...';
    }

    /**
     * Format attempt history as human-readable content
     */
    private formatAttemptContent(
        signature: string,
        allAttempts: FixAttempt[],
        successfulAttempts: FixAttempt[]
    ): string {
        const lines: string[] = [];

        // Error description
        lines.push(`Error: ${signature}`);
        lines.push('');

        // Success info
        if (successfulAttempts.length > 0) {
            lines.push(`Successful fix (${successfulAttempts.length}/${allAttempts.length} attempts):`);
            lines.push('```');
            // Show the most recent successful fix
            const latestSuccess = successfulAttempts[successfulAttempts.length - 1];
            lines.push(this.truncateFix(latestSuccess.fix));
            lines.push('```');
        } else {
            lines.push(`No successful fix found after ${allAttempts.length} attempts.`);
            lines.push('');
            lines.push('Last attempted fix:');
            lines.push('```');
            const lastAttempt = allAttempts[allAttempts.length - 1];
            lines.push(this.truncateFix(lastAttempt.fix));
            lines.push('```');
        }

        // Attempt timeline (summarized)
        lines.push('');
        lines.push(`Attempt history: ${allAttempts.length} total, ${successfulAttempts.length} successful`);

        return lines.join('\n');
    }

    /**
     * Truncate fix description if too long
     */
    private truncateFix(fix: string): string {
        const maxLength = 500;
        if (fix.length <= maxLength) {
            return fix;
        }
        return fix.slice(0, maxLength - 50) + '\n... (truncated, ' + (fix.length - maxLength + 50) + ' more chars)';
    }

    /**
     * Build tags for the pattern based on characteristics
     */
    private buildPatternTags(signature: string, successRate: number): string[] {
        const tags = ['lint', 'fix-pattern', 'namespace:logs'];

        // Tag by success status
        if (successRate >= 0.8) {
            tags.push('high-success');
        } else if (successRate >= 0.5) {
            tags.push('medium-success');
        } else if (successRate > 0) {
            tags.push('low-success');
        } else {
            tags.push('no-success');
        }

        // Tag by error type (from signature)
        const sig = signature.toLowerCase();
        if (sig.includes('unused')) tags.push('unused');
        if (sig.includes('undriven')) tags.push('undriven');
        if (sig.includes('undeclared')) tags.push('undeclared');
        if (sig.includes('width')) tags.push('width-mismatch');
        if (sig.includes('type')) tags.push('type-error');
        if (sig.includes('syntax')) tags.push('syntax-error');

        return tags;
    }

    /**
     * Extract search keywords from error signature
     */
    private extractKeywordsFromSignature(signature: string): string[] {
        const keywords: string[] = [];

        // HDL-related terms
        const hdlTerms = signature.match(
            /\b(module|interface|signal|wire|reg|logic|port|assign|always|process|clk|reset|rst)\b/gi
        );
        if (hdlTerms) {
            keywords.push(...hdlTerms.map(t => t.toLowerCase()));
        }

        // Error type terms
        const errorTerms = signature.match(
            /\b(unused|undriven|undeclared|missing|syntax|type|width|mismatch)\b/gi
        );
        if (errorTerms) {
            keywords.push(...errorTerms.map(t => t.toLowerCase()));
        }

        // Error code if present
        const codeMatch = signature.match(/^([A-Z0-9_]+):/);
        if (codeMatch) {
            keywords.push(codeMatch[1].toLowerCase());
        }

        return [...new Set(keywords)];
    }
}

