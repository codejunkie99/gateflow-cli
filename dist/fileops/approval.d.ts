/**
 * Synchronous Approval System
 * Uses readline-sync to avoid deadlock with async agent execution
 */
export type ApprovalScope = 'once' | 'session' | 'all';
export interface ApprovalResult {
    approved: boolean;
    scope: ApprovalScope;
}
/**
 * Request synchronous approval from the user
 * This blocks the event loop but avoids the readline/async deadlock
 */
export declare function requestApprovalSync(action: string, details: string, options?: {
    diff?: string;
}): ApprovalResult;
/**
 * Auto-approve all operations for this session
 */
export declare function setApproveAll(value: boolean): void;
/**
 * Check if an action is already approved
 */
export declare function isApproved(action: string): boolean;
/**
 * Clear all session approvals
 */
export declare function clearApprovals(): void;
export declare function shouldAutoApprove(filePath: string): boolean;
