/**
 * Approval System
 * Uses centralized InputManager to avoid readline conflicts
 */

import chalk from 'chalk';
import { getInputManager } from '../ui/index.js';

export type ApprovalScope = 'once' | 'session' | 'all';

export interface ApprovalResult {
    approved: boolean;
    scope: ApprovalScope;
}

// Session-level approvals (auto-approve for rest of session)
const sessionApprovals = new Set<string>();
let approveAll = false;

/**
 * Request approval from the user (async, uses InputManager)
 */
export async function requestApproval(
    action: string,
    details: string,
    options?: { diff?: string }
): Promise<ApprovalResult> {
    // Check if already approved for this action type
    if (approveAll || sessionApprovals.has(action)) {
        return { approved: true, scope: 'session' };
    }

    const inputManager = getInputManager();
    return inputManager.requestApproval(action, details, options);
}

/**
 * Request synchronous approval from the user
 * DEPRECATED: Use requestApproval() instead
 * This is kept for backwards compatibility but now uses InputManager
 */
export function requestApprovalSync(
    action: string,
    details: string,
    options?: { diff?: string }
): ApprovalResult {
    // Check if already approved for this action type
    if (approveAll || sessionApprovals.has(action)) {
        return { approved: true, scope: 'session' };
    }

    // Since we can't do async in sync context, we'll auto-approve with warning
    // This should rarely happen as most paths are now async
    console.log(chalk.yellow('\nWARNING: Sync approval requested, auto-approving for: ' + action));
    console.log(chalk.gray('   ' + details));
    return { approved: true, scope: 'once' };
}

/**
 * Auto-approve all operations for this session
 */
export function setApproveAll(value: boolean): void {
    approveAll = value;
}

/**
 * Check if an action is already approved
 */
export function isApproved(action: string): boolean {
    return approveAll || sessionApprovals.has(action);
}

/**
 * Clear all session approvals
 */
export function clearApprovals(): void {
    sessionApprovals.clear();
    approveAll = false;
}

/**
 * Auto-approve specific file patterns (e.g., SystemVerilog files)
 */
const AUTO_APPROVE_PATTERNS = [
    /\.sv$/i,
    /\.svh$/i,
    /\.v$/i,
    /\.vh$/i,
];

export function shouldAutoApprove(filePath: string): boolean {
    return AUTO_APPROVE_PATTERNS.some(pattern => pattern.test(filePath));
}
