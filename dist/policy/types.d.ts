/**
 * Policy Engine Types
 * Type definitions for tool approval and path safety
 */
export interface PolicyDecision {
    /** Whether the action is allowed at all */
    allowed: boolean;
    /** Whether user approval is required before execution */
    requiresApproval: boolean;
    /** Reason for the decision (for user display) */
    reason?: string;
    /** Suggested action if not allowed */
    suggestion?: string;
}
export type ToolName = 'read_file' | 'list_files' | 'search_code' | 'lint_file' | 'scan_project' | 'get_project_graph' | 'find_module' | 'write_file' | 'edit_file' | 'edit_lines' | 'search_replace' | 'git_commit' | 'git_branch' | 'git_checkout' | 'simulate' | 'compile' | 'exec_command';
export interface ToolPolicy {
    /** Default approval requirement */
    requiresApproval: boolean;
    /** Whether to check path safety */
    checkPath: boolean;
    /** Path argument name in tool args */
    pathArg?: string;
    /** Whether this tool is always allowed (read-only) */
    alwaysAllow?: boolean;
    /** Description for user */
    description: string;
}
export type ApprovalScope = 'once' | 'session' | 'project';
export interface ApprovalGrant {
    tool: ToolName;
    scope: ApprovalScope;
    pattern?: string;
    grantedAt: number;
    expiresAt?: number;
}
export interface PathSafetyResult {
    safe: boolean;
    reason?: string;
    isOutsideRoot: boolean;
    isDangerous: boolean;
    matchedRule?: string;
}
export interface PolicyConfig {
    /** Project root directory (absolute path) */
    projectRoot: string;
    /** Additional allowed directories (relative to project root) */
    allowedDirs: string[];
    /** Patterns that are always dangerous (never allow writes) */
    dangerousPatterns: RegExp[];
    /** Patterns that are always safe (skip approval) */
    safePatterns: RegExp[];
    /** Whether to allow writes outside project root */
    allowOutsideRoot: boolean;
    /** Whether to require approval for glob patterns */
    requireGlobApproval: boolean;
    /** Session timeout for 'session' scoped approvals (ms) */
    sessionTimeout: number;
    /** Tool-specific overrides */
    toolOverrides: Partial<Record<ToolName, Partial<ToolPolicy>>>;
}
export declare const DEFAULT_DANGEROUS_PATTERNS: RegExp[];
export declare const DEFAULT_SAFE_PATTERNS: RegExp[];
export declare const DEFAULT_TOOL_POLICIES: Record<ToolName, ToolPolicy>;
