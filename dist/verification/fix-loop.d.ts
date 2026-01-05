/**
 * Fix Loop with Attempt Memory
 * Iterative lint-fix cycle with thrashing prevention
 */
import type { EventBus } from '../events/index.js';
import type { Verilator, LintError } from './verilator.js';
import type { GateFlowAgent } from '../agent/core.js';
import type { FileTools } from '../fileops/file.js';
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
export declare class FixLoop {
    private bus;
    private verilator;
    private agent;
    private fileTools;
    private config;
    private attemptMemory;
    private currentSession;
    constructor(bus: EventBus, verilator: Verilator, agent: GateFlowAgent, fileTools: FileTools, config?: Partial<FixLoopConfig>);
    /**
     * Run the fix loop for a file
     */
    run(filePath: string): Promise<FixLoopResult>;
    /**
     * Check if we're thrashing (making the same fixes repeatedly)
     */
    private checkThrashing;
    /**
     * Get a signature for an error (for deduplication)
     */
    private getErrorSignature;
    /**
     * Record a fix attempt
     */
    private recordAttempt;
    /**
     * Mark attempts as failed
     */
    private markAttemptFailed;
    /**
     * Check if we made progress between lint results
     */
    private madeProgress;
    /**
     * Build the fix prompt for the agent
     * Note: The lint_fix system prompt provides the fix strategy and methodology.
     * This prompt provides the specific errors and context.
     */
    private buildFixPrompt;
    /**
     * Get context about past failed attempts
     */
    private getPastAttemptsContext;
    private summarizeResult;
    /**
     * Clear attempt memory
     */
    clearMemory(): void;
    /**
     * Get attempt statistics
     */
    getStats(): {
        totalAttempts: number;
        uniqueErrors: number;
        successRate: number;
    };
}
