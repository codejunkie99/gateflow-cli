/**
 * Policy Engine
 * Enforces tool approval and path safety rules
 */
import path from 'path';
import { DEFAULT_DANGEROUS_PATTERNS, DEFAULT_SAFE_PATTERNS, DEFAULT_TOOL_POLICIES, } from './types.js';
// ============================================================================
// Policy Engine
// ============================================================================
export class PolicyEngine {
    config;
    sessionGrants = [];
    projectGrants = [];
    sessionStartTime;
    constructor(config) {
        this.config = {
            projectRoot: path.resolve(config.projectRoot),
            allowedDirs: config.allowedDirs ?? [],
            dangerousPatterns: config.dangerousPatterns ?? DEFAULT_DANGEROUS_PATTERNS,
            safePatterns: config.safePatterns ?? DEFAULT_SAFE_PATTERNS,
            allowOutsideRoot: config.allowOutsideRoot ?? false,
            requireGlobApproval: config.requireGlobApproval ?? true,
            sessionTimeout: config.sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
            toolOverrides: config.toolOverrides ?? {},
        };
        this.sessionStartTime = Date.now();
    }
    // ========================================================================
    // Main Policy Check
    // ========================================================================
    /**
     * Check if a tool invocation is allowed
     */
    checkTool(tool, args) {
        const policy = this.getToolPolicy(tool);
        // Always-allow tools (read-only)
        if (policy.alwaysAllow) {
            return {
                allowed: true,
                requiresApproval: false,
            };
        }
        // Check path safety if required
        if (policy.checkPath && policy.pathArg) {
            const targetPath = args[policy.pathArg];
            if (typeof targetPath === 'string') {
                const pathResult = this.checkPathSafety(targetPath);
                if (!pathResult.safe) {
                    return {
                        allowed: false,
                        requiresApproval: false,
                        reason: pathResult.reason,
                        suggestion: pathResult.isOutsideRoot
                            ? 'Move file inside project directory'
                            : 'This path is protected',
                    };
                }
            }
        }
        // Check for glob patterns
        if (this.config.requireGlobApproval) {
            const pathArg = policy.pathArg ? args[policy.pathArg] : null;
            if (typeof pathArg === 'string' && this.isGlobPattern(pathArg)) {
                return {
                    allowed: true,
                    requiresApproval: true,
                    reason: 'Glob pattern affects multiple files',
                };
            }
        }
        // Check for existing approvals
        if (policy.requiresApproval) {
            const pathArg = policy.pathArg ? args[policy.pathArg] : undefined;
            const hasApproval = this.hasValidApproval(tool, pathArg);
            if (hasApproval) {
                return {
                    allowed: true,
                    requiresApproval: false,
                    reason: 'Previously approved',
                };
            }
        }
        // Default: allowed with approval if required
        return {
            allowed: true,
            requiresApproval: policy.requiresApproval,
            reason: policy.requiresApproval
                ? `${policy.description} requires approval`
                : undefined,
        };
    }
    // ========================================================================
    // Path Safety
    // ========================================================================
    /**
     * Check if a path is safe to write to
     */
    checkPathSafety(targetPath) {
        const absolutePath = path.resolve(targetPath);
        const normalizedPath = absolutePath.replace(/\\/g, '/');
        // Check dangerous patterns first
        for (const pattern of this.config.dangerousPatterns) {
            if (pattern.test(absolutePath) || pattern.test(normalizedPath)) {
                return {
                    safe: false,
                    reason: `Path matches dangerous pattern: ${pattern.source}`,
                    isOutsideRoot: false,
                    isDangerous: true,
                    matchedRule: pattern.source,
                };
            }
        }
        // Check if outside project root
        const isInRoot = absolutePath.startsWith(this.config.projectRoot);
        const isInAllowedDir = this.config.allowedDirs.some(dir => {
            const allowedPath = path.resolve(this.config.projectRoot, dir);
            return absolutePath.startsWith(allowedPath);
        });
        if (!isInRoot && !isInAllowedDir && !this.config.allowOutsideRoot) {
            return {
                safe: false,
                reason: `Path is outside project root: ${this.config.projectRoot}`,
                isOutsideRoot: true,
                isDangerous: false,
            };
        }
        // Path is safe
        return {
            safe: true,
            isOutsideRoot: !isInRoot,
            isDangerous: false,
        };
    }
    /**
     * Check if a path matches safe patterns (auto-approve)
     */
    isAutoApprovePath(targetPath) {
        const absolutePath = path.resolve(targetPath);
        const normalizedPath = absolutePath.replace(/\\/g, '/');
        return this.config.safePatterns.some(pattern => pattern.test(absolutePath) || pattern.test(normalizedPath));
    }
    // ========================================================================
    // Approval Management
    // ========================================================================
    /**
     * Grant approval for a tool/path combination
     */
    grantApproval(tool, scope, pattern) {
        const grant = {
            tool,
            scope,
            pattern,
            grantedAt: Date.now(),
            expiresAt: scope === 'session'
                ? Date.now() + this.config.sessionTimeout
                : undefined,
        };
        if (scope === 'project') {
            this.projectGrants.push(grant);
        }
        else if (scope === 'session') {
            this.sessionGrants.push(grant);
        }
        // 'once' scope is not stored - single use
    }
    /**
     * Check if there's a valid approval for a tool/path
     */
    hasValidApproval(tool, pathArg) {
        const now = Date.now();
        // Check session grants
        const validSessionGrant = this.sessionGrants.find(grant => {
            if (grant.tool !== tool)
                return false;
            if (grant.expiresAt && grant.expiresAt < now)
                return false;
            if (grant.pattern && pathArg && !this.matchesPattern(pathArg, grant.pattern)) {
                return false;
            }
            return true;
        });
        if (validSessionGrant)
            return true;
        // Check project grants
        const validProjectGrant = this.projectGrants.find(grant => {
            if (grant.tool !== tool)
                return false;
            if (grant.pattern && pathArg && !this.matchesPattern(pathArg, grant.pattern)) {
                return false;
            }
            return true;
        });
        return !!validProjectGrant;
    }
    /**
     * Clear session grants (on exit)
     */
    clearSessionGrants() {
        this.sessionGrants = [];
    }
    /**
     * Get project grants for persistence
     */
    getProjectGrants() {
        return [...this.projectGrants];
    }
    /**
     * Load project grants from persistence
     */
    loadProjectGrants(grants) {
        this.projectGrants = grants.filter(g => g.scope === 'project');
    }
    // ========================================================================
    // Helpers
    // ========================================================================
    /**
     * Get tool policy with overrides
     */
    getToolPolicy(tool) {
        const basePolicy = DEFAULT_TOOL_POLICIES[tool];
        const override = this.config.toolOverrides[tool];
        if (!basePolicy) {
            // Unknown tool - require approval by default
            return {
                requiresApproval: true,
                checkPath: false,
                description: `Unknown tool: ${tool}`,
            };
        }
        if (override) {
            return { ...basePolicy, ...override };
        }
        return basePolicy;
    }
    /**
     * Check if a string is a glob pattern
     */
    isGlobPattern(str) {
        return str.includes('*') || str.includes('?') || str.includes('[');
    }
    /**
     * Check if a path matches a glob-like pattern
     */
    matchesPattern(pathStr, pattern) {
        // Simple glob matching (can be enhanced with minimatch)
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '{{DOUBLESTAR}}')
            .replace(/\*/g, '[^/\\\\]*')
            .replace(/{{DOUBLESTAR}}/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(pathStr);
    }
    // ========================================================================
    // Configuration Access
    // ========================================================================
    /**
     * Get current project root
     */
    getProjectRoot() {
        return this.config.projectRoot;
    }
    /**
     * Update configuration
     */
    updateConfig(updates) {
        this.config = { ...this.config, ...updates };
        if (updates.projectRoot) {
            this.config.projectRoot = path.resolve(updates.projectRoot);
        }
    }
    /**
     * Get human-readable policy summary for a tool
     */
    getToolDescription(tool) {
        const policy = this.getToolPolicy(tool);
        const parts = [policy.description];
        if (policy.alwaysAllow) {
            parts.push('(auto-allowed)');
        }
        else if (policy.requiresApproval) {
            parts.push('(requires approval)');
        }
        if (policy.checkPath) {
            parts.push('(path checked)');
        }
        return parts.join(' ');
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
let globalPolicyEngine = null;
/**
 * Initialize global policy engine
 */
export function initPolicyEngine(config) {
    globalPolicyEngine = new PolicyEngine(config);
    return globalPolicyEngine;
}
/**
 * Get global policy engine
 */
export function getPolicyEngine() {
    if (!globalPolicyEngine) {
        throw new Error('Policy engine not initialized. Call initPolicyEngine() first.');
    }
    return globalPolicyEngine;
}
/**
 * Check if policy engine is initialized
 */
export function hasPolicyEngine() {
    return globalPolicyEngine !== null;
}
