/**
 * Policy Engine
 * Enforces tool approval and path safety rules
 */
import { type PolicyConfig, type PolicyDecision, type PathSafetyResult, type ToolName, type ApprovalGrant, type ApprovalScope } from './types.js';
export declare class PolicyEngine {
    private config;
    private sessionGrants;
    private projectGrants;
    private sessionStartTime;
    constructor(config: Partial<PolicyConfig> & {
        projectRoot: string;
    });
    /**
     * Check if a tool invocation is allowed
     */
    checkTool(tool: ToolName, args: Record<string, unknown>): PolicyDecision;
    /**
     * Check if a path is safe to write to
     */
    checkPathSafety(targetPath: string): PathSafetyResult;
    /**
     * Check if a path matches safe patterns (auto-approve)
     */
    isAutoApprovePath(targetPath: string): boolean;
    /**
     * Grant approval for a tool/path combination
     */
    grantApproval(tool: ToolName, scope: ApprovalScope, pattern?: string): void;
    /**
     * Check if there's a valid approval for a tool/path
     */
    hasValidApproval(tool: ToolName, pathArg?: string): boolean;
    /**
     * Clear session grants (on exit)
     */
    clearSessionGrants(): void;
    /**
     * Get project grants for persistence
     */
    getProjectGrants(): ApprovalGrant[];
    /**
     * Load project grants from persistence
     */
    loadProjectGrants(grants: ApprovalGrant[]): void;
    /**
     * Get tool policy with overrides
     */
    private getToolPolicy;
    /**
     * Check if a string is a glob pattern
     */
    private isGlobPattern;
    /**
     * Check if a path matches a glob-like pattern
     */
    private matchesPattern;
    /**
     * Get current project root
     */
    getProjectRoot(): string;
    /**
     * Update configuration
     */
    updateConfig(updates: Partial<PolicyConfig>): void;
    /**
     * Get human-readable policy summary for a tool
     */
    getToolDescription(tool: ToolName): string;
}
/**
 * Initialize global policy engine
 */
export declare function initPolicyEngine(config: Partial<PolicyConfig> & {
    projectRoot: string;
}): PolicyEngine;
/**
 * Get global policy engine
 */
export declare function getPolicyEngine(): PolicyEngine;
/**
 * Check if policy engine is initialized
 */
export declare function hasPolicyEngine(): boolean;
