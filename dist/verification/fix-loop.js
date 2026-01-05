/**
 * Fix Loop with Attempt Memory
 * Iterative lint-fix cycle with thrashing prevention
 */
// ============================================================================
// Fix Loop Implementation
// ============================================================================
export class FixLoop {
    bus;
    verilator;
    agent;
    fileTools;
    config;
    attemptMemory = new Map();
    currentSession = [];
    constructor(bus, verilator, agent, fileTools, config) {
        this.bus = bus;
        this.verilator = verilator;
        this.agent = agent;
        this.fileTools = fileTools;
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
    async run(filePath) {
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
        while (!currentResult.success &&
            attemptCount < this.config.maxAttempts &&
            !thrashingDetected) {
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
            }
            catch (error) {
                this.bus.emit({
                    type: 'error',
                    message: `Fix attempt failed: ${error}`,
                    recoverable: true
                });
                break;
            }
        }
        const result = {
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
    checkThrashing(errors) {
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
            const fixCounts = new Map();
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
    getErrorSignature(error) {
        // Normalize file path
        const file = error.file.split(/[/\\]/).pop() ?? error.file;
        // Ignore line number to handle code shifts during editing
        // We rely on the error code and message content
        return `${error.code}:${file}:${error.message.replace(/\s+/g, ' ').trim()}`;
    }
    /**
     * Record a fix attempt
     */
    recordAttempt(errors, fix) {
        const timestamp = Date.now();
        for (const error of errors) {
            const signature = this.getErrorSignature(error);
            const attempt = {
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
    markAttemptFailed(errors) {
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
    madeProgress(prev, next) {
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
    buildFixPrompt(filePath, errors, fileContent) {
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
    getPastAttemptsContext(errors) {
        const failedFixes = [];
        for (const error of errors) {
            const sig = this.getErrorSignature(error);
            const attempts = this.attemptMemory.get(sig) ?? [];
            const failed = attempts.filter(a => !a.success);
            if (failed.length > 0) {
                failedFixes.push(`Error "${sig.slice(0, 50)}..." - ${failed.length} previous fix attempt(s) failed`);
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
    summarizeResult(result) {
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
    clearMemory() {
        this.attemptMemory.clear();
        this.currentSession = [];
    }
    /**
     * Get attempt statistics
     */
    getStats() {
        let total = 0;
        let successful = 0;
        for (const attempts of this.attemptMemory.values()) {
            for (const attempt of attempts) {
                total++;
                if (attempt.success)
                    successful++;
            }
        }
        return {
            totalAttempts: total,
            uniqueErrors: this.attemptMemory.size,
            successRate: total > 0 ? successful / total : 0
        };
    }
}
