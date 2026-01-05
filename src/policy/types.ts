/**
 * Policy Engine Types
 * Type definitions for tool approval and path safety
 */

// ============================================================================
// Policy Decision
// ============================================================================

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

// ============================================================================
// Tool Classification
// ============================================================================

export type ToolName =
    // Read-only (always allowed, no approval)
    | 'read_file'
    | 'list_files'
    | 'search_code'
    | 'lint_file'
    | 'scan_project'
    | 'get_project_graph'
    | 'find_module'
    // Write operations (require approval)
    | 'write_file'
    | 'edit_file'
    | 'edit_lines'
    | 'search_replace'
    // Git operations (require approval)
    | 'git_commit'
    | 'git_branch'
    | 'git_checkout'
    // Simulation (configurable)
    | 'simulate'
    | 'compile'
    // System operations
    | 'exec_command';

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

// ============================================================================
// Approval Scope
// ============================================================================

export type ApprovalScope = 'once' | 'session' | 'project';

export interface ApprovalGrant {
    tool: ToolName;
    scope: ApprovalScope;
    pattern?: string;  // Path pattern for path-based approvals
    grantedAt: number;
    expiresAt?: number;  // Only for 'session' scope
}

// ============================================================================
// Path Safety
// ============================================================================

export interface PathSafetyResult {
    safe: boolean;
    reason?: string;
    isOutsideRoot: boolean;
    isDangerous: boolean;
    matchedRule?: string;
}

// ============================================================================
// Policy Configuration
// ============================================================================

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

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_DANGEROUS_PATTERNS: RegExp[] = [
    // Version control
    /[/\\]\.git[/\\]/,
    /[/\\]\.svn[/\\]/,
    /[/\\]\.hg[/\\]/,
    
    // Package managers
    /[/\\]node_modules[/\\]/,
    /[/\\]vendor[/\\]/,
    
    // Build outputs (Verilator)
    /[/\\]obj_dir[/\\]/,
    
    // Config files
    /[/\\]\.env$/,
    /[/\\]\.env\.[^/\\]+$/,
    /[/\\]package\.json$/,
    /[/\\]package-lock\.json$/,
    /[/\\]tsconfig\.json$/,
    
    // Binary files
    /\.exe$/i,
    /\.dll$/i,
    /\.so$/i,
    /\.dylib$/i,
    /\.bin$/i,
    /\.o$/i,
    /\.a$/i,
    
    // System directories (Unix)
    /^\/etc[/\\]/,
    /^\/usr[/\\]/,
    /^\/var[/\\]/,
    /^\/bin[/\\]/,
    /^\/sbin[/\\]/,
    
    // System directories (Windows)
    /^[A-Z]:[/\\]Windows[/\\]/i,
    /^[A-Z]:[/\\]Program Files[/\\]/i,
    /^[A-Z]:[/\\]Program Files \(x86\)[/\\]/i,
    /^[A-Z]:[/\\]System[/\\]/i,
];

export const DEFAULT_SAFE_PATTERNS: RegExp[] = [
    // SystemVerilog source files in standard directories
    /[/\\]src[/\\].*\.sv$/,
    /[/\\]rtl[/\\].*\.sv$/,
    /[/\\]tb[/\\].*\.sv$/,
    /[/\\]test[/\\].*\.sv$/,
    /[/\\]testbench[/\\].*\.sv$/,
];

export const DEFAULT_TOOL_POLICIES: Record<ToolName, ToolPolicy> = {
    // Read-only tools
    read_file: {
        requiresApproval: false,
        checkPath: false,
        alwaysAllow: true,
        description: 'Read file contents'
    },
    list_files: {
        requiresApproval: false,
        checkPath: false,
        alwaysAllow: true,
        description: 'List directory contents'
    },
    search_code: {
        requiresApproval: false,
        checkPath: false,
        alwaysAllow: true,
        description: 'Search code patterns'
    },
    lint_file: {
        requiresApproval: false,
        checkPath: false,
        alwaysAllow: true,
        description: 'Run Verilator lint'
    },
    scan_project: {
        requiresApproval: false,
        checkPath: false,
        alwaysAllow: true,
        description: 'Scan project structure'
    },
    get_project_graph: {
        requiresApproval: false,
        checkPath: false,
        alwaysAllow: true,
        description: 'Get module dependencies'
    },
    find_module: {
        requiresApproval: false,
        checkPath: false,
        alwaysAllow: true,
        description: 'Find module definition'
    },
    
    // Write operations
    write_file: {
        requiresApproval: true,
        checkPath: true,
        pathArg: 'filePath',
        description: 'Write/create file'
    },
    edit_file: {
        requiresApproval: true,
        checkPath: true,
        pathArg: 'filePath',
        description: 'Edit existing file'
    },
    edit_lines: {
        requiresApproval: true,
        checkPath: true,
        pathArg: 'filePath',
        description: 'Edit specific lines'
    },
    search_replace: {
        requiresApproval: true,
        checkPath: true,
        pathArg: 'filePath',
        description: 'Search and replace'
    },
    
    // Git operations
    git_commit: {
        requiresApproval: true,
        checkPath: false,
        description: 'Git commit changes'
    },
    git_branch: {
        requiresApproval: true,
        checkPath: false,
        description: 'Create/switch branch'
    },
    git_checkout: {
        requiresApproval: true,
        checkPath: false,
        description: 'Git checkout'
    },
    
    // Simulation
    simulate: {
        requiresApproval: false, // Configurable
        checkPath: true,
        pathArg: 'testbench',
        description: 'Run simulation'
    },
    compile: {
        requiresApproval: false,
        checkPath: true,
        pathArg: 'sourceFile',
        description: 'Compile with Verilator'
    },
    
    // System
    exec_command: {
        requiresApproval: true,
        checkPath: false,
        description: 'Execute shell command'
    }
};

