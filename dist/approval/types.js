/**
 * Policy Engine Types
 * Type definitions for tool approval and path safety
 */
// ============================================================================
// Defaults
// ============================================================================
export const DEFAULT_DANGEROUS_PATTERNS = [
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
export const DEFAULT_SAFE_PATTERNS = [
    // SystemVerilog source files in standard directories
    /[/\\]src[/\\].*\.sv$/,
    /[/\\]rtl[/\\].*\.sv$/,
    /[/\\]tb[/\\].*\.sv$/,
    /[/\\]test[/\\].*\.sv$/,
    /[/\\]testbench[/\\].*\.sv$/,
];
export const DEFAULT_TOOL_POLICIES = {
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
