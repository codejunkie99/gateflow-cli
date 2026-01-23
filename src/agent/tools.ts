/**
 * AI Tool Definitions
 * Tools for the Vercel AI SDK agent
 */

import { z } from 'zod';
import type { EventBus } from '../events/index.js';
import type { PolicyEngine } from '../approval/index.js';
import type { FileTools, EditTools } from '../fileops/index.js';
import { shouldAutoApprove } from '../fileops/approval.js';
import type { SVIndexerAdapter } from '../indexer/sv-indexer-adapter.js';
import type { DiffEngine } from '../diff/index.js';
import type { Verilator } from '../verification/verilator.js';
import type {
    ToolRegistry,
    ContextFileManager,
    TerminalSessionManager,
    DynamicContextManager,
    FileChunker,
    TokenBudgetManager
} from '../context/index.js';
import type { MemoryManager, KnowledgeStore, MemoryService } from '../memory/index.js';
import { LEARNED_TYPES, type LearnedKnowledgeType } from '../memory/knowledge-service/index.js';
import type { SkillRegistry } from '../skills/index.js';
import type { MCPToolSync } from '../mcp/index.js';
import type { InputManager } from '../ui/index.js';

// ============================================================================
// Tool Context
// ============================================================================

export interface ToolContext {
    bus: EventBus;
    policy: PolicyEngine;
    fileTools: FileTools;
    editTools: EditTools;
    indexer: SVIndexerAdapter;
    diffEngine: DiffEngine;
    verilator?: Verilator;
    projectRoot: string;
    dryRun: boolean;
    autoApprove: boolean;
    // Dynamic context discovery (optional for backwards compatibility)
    toolRegistry?: ToolRegistry;
    contextFileManager?: ContextFileManager;
    terminalSessionManager?: TerminalSessionManager;
    sessionId?: string;
    // Unified memory service (preferred) - provides token-budgeted context injection
    memoryService?: MemoryService;
    // Legacy accessors (for backward compatibility with tool executors)
    memoryManager?: MemoryManager;
    knowledgeStore?: KnowledgeStore;
    // Skills and MCP integration
    skillRegistry?: SkillRegistry;
    mcpToolSync?: MCPToolSync;
    // Centralized input manager
    inputManager?: InputManager;
    // Phase 2: Context Window Management (Cursor's Dynamic Context Discovery)
    dynamicContextManager?: DynamicContextManager;
    fileChunker?: FileChunker;
    tokenBudgetManager?: TokenBudgetManager;
}

// ============================================================================
// Tool Definitions (Zod Schemas)
// ============================================================================

// Read File
export const readFileSchema = z.object({
    path: z.string().describe('Path to the file to read'),
    startLine: z.number().optional().describe('Starting line number (1-indexed)'),
    endLine: z.number().optional().describe('Ending line number (inclusive)')
});

// Write File
export const writeFileSchema = z.object({
    path: z.string().describe('Path to the file to write'),
    content: z.string().describe('Full content to write to the file')
});

// Edit Lines
export const editLinesSchema = z.object({
    path: z.string().describe('Path to the file to edit'),
    edits: z.array(z.object({
        startLine: z.number().describe('First line to replace (1-indexed)'),
        endLine: z.number().describe('Last line to replace (inclusive)'),
        newContent: z.string().describe('New content to insert')
    })).describe('List of edits to apply')
});

// Search Replace
export const searchReplaceSchema = z.object({
    path: z.string().describe('Path to the file to edit'),
    search: z.string().describe('Text or regex pattern to search for'),
    replace: z.string().describe('Replacement text'),
    all: z.boolean().optional().default(false).describe('Replace all occurrences'),
    isRegex: z.boolean().optional().default(false).describe('Treat search as regex')
});

// List Files
export const listFilesSchema = z.object({
    directory: z.string().describe('Directory path to list'),
    extensions: z.array(z.string()).optional().default(['.sv']).describe('Filter by file extensions (default: [".sv"])'),
    recursive: z.boolean().optional().default(true).describe('List recursively (default: true)')
});

// Search Code
export const searchCodeSchema = z.object({
    pattern: z.string().describe('Search pattern (regex)'),
    filePattern: z.string().optional().default('**/*.sv').describe('Glob pattern for files to search (default: "**/*.sv")'),
    caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
    maxResults: z.number().optional().default(50).describe('Maximum results to return')
});

// Find Module
export const findModuleSchema = z.object({
    name: z.string().describe('Module name to find')
});

// Get Dependencies
export const getDependenciesSchema = z.object({
    module: z.string().describe('Module name to get dependencies for')
});

// Lint File
export const lintFileSchema = z.object({
    path: z.string().describe('Path to the SystemVerilog file to lint')
});

// Run Simulation
export const runSimSchema = z.object({
    top: z.string().describe('Top module name'),
    testbench: z.string().optional().describe('Testbench file path'),
    timeout: z.number().optional().describe('Simulation timeout in ms'),
    analyzeWaveform: z.boolean().optional().default(false).describe('Analyze the VCD waveform after simulation completes')
});

// Open Waveform Viewer
export const openWaveformSchema = z.object({
    vcdPath: z.string().describe('Path to the VCD file to open in the interactive viewer')
});

// Find All SV Files
export const findAllSvFilesSchema = z.object({
    directory: z.string().optional().default('.').describe('Starting directory (default: project root)')
});

// Analyze Waveform
export const analyzeWaveformSchema = z.object({
    vcdPath: z.string().describe('Path to the VCD file to analyze'),
    signals: z.array(z.string()).optional().describe('Specific signals to analyze (default: all)'),
    detectClocks: z.boolean().optional().default(true).describe('Detect clock signals automatically'),
    checkAnomalies: z.boolean().optional().default(true).describe('Check for signal anomalies')
});

// Ask User (Human-in-the-loop)
export const askUserSchema = z.object({
    question: z.string().describe('Question to ask the user'),
    options: z.array(z.string()).optional().describe('Optional list of choices for the user'),
    default: z.string().optional().describe('Default option if user just presses enter')
});

// Find VCD Files
export const findVcdFilesSchema = z.object({
    directory: z.string().optional().default('.').describe('Starting directory (default: project root)'),
    pattern: z.string().optional().describe('Optional filename pattern to match (e.g., "counter" matches "counter.vcd")')
});

// ============================================================================
// Dynamic Context Discovery Tools (Schemas)
// ============================================================================

// Describe Tool - Get full description of any tool
export const describeToolSchema = z.object({
    toolName: z.string().describe('Name of the tool to describe')
});

// Read Context Output - Read portions of stored tool output
export const readContextOutputSchema = z.object({
    ref: z.string().describe('Context file path from tool result'),
    head: z.number().optional().describe('Read first N lines'),
    tail: z.number().optional().describe('Read last N lines'),
    startLine: z.number().optional().describe('Start line for range read (1-indexed)'),
    endLine: z.number().optional().describe('End line for range read (inclusive)')
});

// Search History - Search archived conversation history
export const searchHistorySchema = z.object({
    query: z.string().describe('What to search for in conversation history'),
    sessionOnly: z.boolean().optional().default(true).describe('Search only current session (default: true)')
});

// Search Terminal - Search terminal output for patterns
export const searchTerminalSchema = z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    context: z.number().optional().default(2).describe('Lines of context around matches (default: 2)')
});

// Get Terminal File Path - Get path to terminal session file for grep access
export const getTerminalFilePathSchema = z.object({});

// Search Skills - Search skill files for relevant capabilities
export const searchSkillsSchema = z.object({
    query: z.string().describe('What capability or task to search for'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results (default: 5)')
});

// Get Skill - Get full skill definition by name
export const getSkillSchema = z.object({
    name: z.string().describe('Name of the skill to retrieve')
});

// Run Skill Script - Execute a bundled script from a skill
export const runSkillScriptSchema = z.object({
    skillName: z.string().describe('Name of the skill'),
    scriptPath: z.string().describe('Path to the script within the skill'),
    env: z.record(z.string()).optional().describe('Additional environment variables')
});

// Check MCP Status - Check status of MCP servers and tools
export const checkMcpStatusSchema = z.object({
    serverName: z.string().optional().describe('Specific server to check (default: all servers)')
});

// Get MCP Tool - Get full definition of an MCP tool
export const getMcpToolSchema = z.object({
    serverName: z.string().describe('Name of the MCP server'),
    toolName: z.string().describe('Name of the tool')
});

// ============================================================================
// Phase 2: Context Window Management Tools (Cursor's Dynamic Context Discovery)
// ============================================================================

// Grep Context - Search through context files (tool outputs, history)
export const grepContextSchema = z.object({
    filePattern: z.string().describe('File pattern to search (e.g., "tool_*.txt", "history.jsonl", or full path)'),
    pattern: z.string().describe('Regex pattern to search for'),
    context: z.number().optional().default(2).describe('Lines of context around matches (default: 2)')
});

// JQ Context - Filter JSON context files using jq
export const jqContextSchema = z.object({
    filePath: z.string().describe('Path to the JSON context file'),
    filter: z.string().describe('JQ filter string (e.g. ".messages[] | select(.role==\\"user\\")")')
});

// Tail Context - Read last N lines of a context file
export const tailContextSchema = z.object({
    filePath: z.string().describe('Path to the context file'),
    lines: z.number().optional().default(50).describe('Number of lines to read from end (default: 50)')
});

// Head Context - Read first N lines of a context file
export const headContextSchema = z.object({
    filePath: z.string().describe('Path to the context file'),
    lines: z.number().optional().default(50).describe('Number of lines to read from start (default: 50)')
});

// List Context - List available context files for current session
export const listContextSchema = z.object({
    type: z.enum(['all', 'tool_output', 'history', 'terminal']).optional().default('all')
        .describe('Type of context files to list (default: all)')
});

// Get File Chunk - Get semantically meaningful chunk of a large HDL file
export const getFileChunkSchema = z.object({
    filePath: z.string().describe('Path to the HDL file'),
    lineNumber: z.number().optional().describe('Get chunk containing this line'),
    chunkName: z.string().optional().describe('Get chunk by name (module, function name)'),
    chunkType: z.enum(['module', 'interface', 'package', 'class', 'function', 'task', 'always_block'])
        .optional().describe('Get all chunks of this type')
});

// Select Relevant Chunks - Select file chunks relevant to a query
export const selectChunksSchema = z.object({
    filePath: z.string().describe('Path to the HDL file'),
    query: z.string().describe('Query describing what you need (e.g., "clock reset logic", "state machine")'),
    maxTokens: z.number().optional().default(2000).describe('Maximum tokens to return (default: 2000)')
});

// Search Knowledge - Search learned patterns and knowledge
export const searchKnowledgeSchema = z.object({
    query: z.string().describe('What to search for in learned or structural knowledge'),
    types: z.array(z.enum(['code_pattern', 'lint_fix', 'test_pattern', 'module_info', 'dependency',
        'style_preference', 'workflow', 'debug_solution', 'tool_usage', 'project_context']))
        .optional().describe('Filter by learned type or structural category'),
    maxResults: z.number().optional().default(10).describe('Maximum results (default: 10)'),
    structuralOnly: z.boolean().optional().default(false).describe('Only search structural knowledge from indexer'),
    learnedOnly: z.boolean().optional().default(false).describe('Only search learned knowledge from knowledge store')
});

// Get Token Budget - Get current token budget status
export const getTokenBudgetSchema = z.object({});

// Request Continuation - Signal that task requires continuation
export const requestContinuationSchema = z.object({
    completedTasks: z.array(z.string()).describe('List of tasks completed so far in this turn'),
    remainingTasks: z.array(z.string()).describe('List of tasks that still need to be done'),
    partialResults: z.string().optional().describe('Summary of partial results or progress made'),
    notes: z.string().optional().describe('Any notes for the next continuation turn')
});

// ============================================================================
// Tool Setup Schemas
// ============================================================================

// Check Tool Status - Check if analysis tools are installed
export const checkToolStatusSchema = z.object({
    tool: z.enum(['verible', 'slang', 'both']).optional().default('both')
        .describe('Which tool to check status for (default: both)')
});

// Setup Verible - Download and configure Verible
export const setupVeribleSchema = z.object({});

// Setup Slang - Build and configure Slang
export const setupSlangSchema = z.object({});

// Help Setup Tools - Interactive helper for setting up missing tools
export const helpSetupToolsSchema = z.object({
    tools: z.array(z.enum(['verible', 'slang'])).optional()
        .describe('Specific tools to help with (default: all missing tools)')
});

// ============================================================================
// Tool Approval Configuration (AI SDK 6)
// ============================================================================

/**
 * Declarative configuration for which tools require human approval.
 * - false: Tool executes immediately (read-only or safe operations)
 * - true: Tool requires approval before execution (writes, executions, setups)
 *
 * This is used with AI SDK 6's needsApproval pattern where tools without
 * execute functions pause for approval.
 */
export const TOOL_APPROVAL_CONFIG: Record<string, boolean> = {
    // Read-only tools - no approval needed
    read_file: false,
    list_files: false,
    search_code: false,
    lint_file: false,
    find_module: false,
    get_dependencies: false,
    find_all_sv_files: false,
    find_vcd_files: false,
    analyze_waveform: false,
    get_project_stats: false,

    // Dynamic context discovery - no approval (read-only)
    describe_tool: false,
    read_context_output: false,
    search_history: false,
    search_terminal: false,
    get_terminal_file_path: false,

    // Phase 2: Context Window Management - no approval (read-only)
    grep_context: false,
    jq_context: false,
    tail_context: false,
    head_context: false,
    list_context: false,
    get_file_chunk: false,
    select_chunks: false,
    search_knowledge: false,
    get_token_budget: false,

    // Continuation coordination - no approval (doesn't modify files)
    request_continuation: false,

    // Skills and MCP - read operations (no approval)
    search_skills: false,
    get_skill: false,
    check_mcp_status: false,
    get_mcp_tool: false,

    // Write/modify tools - needs approval
    write_file: true,
    edit_lines: true,
    search_replace: true,

    // Execution tools - needs approval
    run_simulation: true,
    run_skill_script: true,

    // Setup tools - needs approval
    setup_verible: true,
    setup_slang: true,
    help_setup_tools: true,
    check_tool_status: false, // Just checking status, not modifying

    // Interactive tools - no approval (they prompt user directly)
    ask_user: false,
    open_waveform: false,
};

// ============================================================================
// Tool Implementations
// ============================================================================

export function createToolExecutors(ctx: ToolContext): Record<string, (args: any) => Promise<unknown>> {
    const requiresApproval = (toolName: string): boolean =>
        (TOOL_APPROVAL_CONFIG[toolName] ?? false) && !ctx.autoApprove;

    const getPathArg = (args: Record<string, unknown>): string | undefined => {
        const path = args.path ?? args.filePath;
        return typeof path === 'string' ? path : undefined;
    };

    const summarizeApprovalDetails = (args: Record<string, unknown>): string => {
        const path = getPathArg(args);
        if (path) return path;
        if (typeof args.scriptPath === 'string') return args.scriptPath;
        if (typeof args.top === 'string') return args.top;
        if (typeof args.module === 'string') return args.module;
        if (typeof args.name === 'string') return args.name;
        if (typeof args.pattern === 'string') return args.pattern;

        const toolsArg = args.tools;
        if (Array.isArray(toolsArg) && toolsArg.every((tool) => typeof tool === 'string')) {
            return `tools=${toolsArg.join(', ')}`;
        }

        const keys = Object.keys(args);
        return keys.length > 0 ? keys.slice(0, 3).join(', ') : '';
    };

    const formatApprovalError = (error: unknown): string => {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        if (lower.includes('timed out') || lower.includes('timeout')) {
            return 'Approval request timed out';
        }
        return message || 'Approval request failed';
    };

    const requestToolApproval = async (
        toolName: string,
        args: Record<string, unknown>
    ): Promise<{ approved: boolean; reason?: string }> => {
        if (!requiresApproval(toolName)) {
            return { approved: true };
        }

        const isFileWrite = toolName === 'write_file'
            || toolName === 'edit_lines'
            || toolName === 'search_replace';

        if (isFileWrite && ctx.dryRun) {
            return { approved: true };
        }

        if (isFileWrite) {
            const path = getPathArg(args);
            if (path && shouldAutoApprove(path)) {
                return { approved: true };
            }
        }

        const details = summarizeApprovalDetails(args);

        if (ctx.inputManager) {
            try {
                const approval = await ctx.inputManager.requestApproval(toolName, details);
                return approval.approved
                    ? { approved: true }
                    : { approved: false, reason: 'User denied approval' };
            } catch (error) {
                return { approved: false, reason: formatApprovalError(error) };
            }
        }

        try {
            const response = await ctx.bus.requestApproval(`Tool: ${toolName}`, details);
            return response.approved
                ? { approved: true }
                : { approved: false, reason: 'User denied approval' };
        } catch (error) {
            return {
                approved: false,
                reason: formatApprovalError(error)
            };
        }
    };

    return {
        read_file: async (args: z.infer<typeof readFileSchema>) => {
            const result = await ctx.fileTools.readFile(args.path, {
                startLine: args.startLine,
                endLine: args.endLine,
                includeLineNumbers: true
            });

            if (!result.success) {
                return { error: result.error };
            }

            return {
                path: result.path,
                content: result.content,
                lines: result.lines
            };
        },

        write_file: async (args: z.infer<typeof writeFileSchema>) => {
            if (ctx.dryRun) {
                const patch = await ctx.diffEngine.createDiffFromFile(args.path, args.content);
                ctx.bus.emit({
                    type: 'diff_preview',
                    path: args.path,
                    unifiedDiff: patch.unifiedDiff,
                    stats: patch.stats
                });
                return { dryRun: true, diff: patch.unifiedDiff };
            }

            const approval = await requestToolApproval('write_file', {
                path: args.path,
                contentLength: args.content.length
            });
            if (!approval.approved) {
                return { error: approval.reason ?? 'User denied write_file' };
            }

            const result = await ctx.fileTools.writeFile(args.path, args.content, {
                skipApproval: true
            });

            if (!result.success) {
                return { error: result.error };
            }

            // FIX B: Re-index the file after writing so find_module can find newly created modules
            if (result.path && result.path.endsWith('.sv')) {
                try {
                    await ctx.indexer.updateFile(result.path, result.created ? 'add' : 'change');
                } catch (indexErr) {
                    // Don't fail write if indexing fails
                    console.error('Failed to re-index file:', indexErr);
                }
            }

            return {
                path: result.path,
                created: result.created,
                bytesWritten: result.bytesWritten
            };
        },

        edit_lines: async (args: z.infer<typeof editLinesSchema>) => {
            if (!ctx.dryRun) {
                const approval = await requestToolApproval('edit_lines', {
                    path: args.path,
                    editCount: args.edits.length
                });
                if (!approval.approved) {
                    return { error: approval.reason ?? 'User denied edit_lines' };
                }
            }

            const result = await ctx.editTools.editLines(args.path, args.edits, {
                dryRun: ctx.dryRun,
                skipApproval: true
            });

            if (!result.success) {
                return { error: result.error };
            }

            return {
                path: result.path,
                applied: result.applied,
                stats: result.stats
            };
        },

        search_replace: async (args: z.infer<typeof searchReplaceSchema>) => {
            if (!ctx.dryRun) {
                const approval = await requestToolApproval('search_replace', {
                    path: args.path,
                    search: args.search
                });
                if (!approval.approved) {
                    return { error: approval.reason ?? 'User denied search_replace' };
                }
            }

            const result = await ctx.editTools.searchReplace(
                args.path,
                args.search,
                args.replace,
                {
                    all: args.all,
                    isRegex: args.isRegex,
                    dryRun: ctx.dryRun,
                    skipApproval: true
                }
            );

            if (!result.success) {
                return { error: result.error };
            }

            return {
                path: result.path,
                replacements: result.replacements,
                applied: result.applied
            };
        },

        list_files: async (args: z.infer<typeof listFilesSchema>) => {
            // Default to .sv files only
            const extensions = args.extensions && args.extensions.length > 0
                ? args.extensions
                : ['.sv'];

            // Resolve '.' to project root
            const directory = args.directory === '.' ? ctx.projectRoot : args.directory;

            // Check if this directory should be skipped
            const excludeDirs = ['node_modules', 'dist', 'obj_dir', '.git', 'target', 'dist-electron'];
            const dirBasename = directory.split(/[\/\\]/).pop() || '';
            if (excludeDirs.includes(dirBasename)) {
                return {
                    directory: directory,
                    count: 0,
                    files: [],
                    note: 'Directory excluded from search'
                };
            }

            const result = await ctx.fileTools.listFiles(directory, {
                extensions: extensions,
                recursive: false  // Don't recurse - let agent control traversal
            });

            if (!result.success) {
                return { error: result.error };
            }

            // Filter: exclude non-source directories, keep only .sv files and allowed directories
            const svFiles = result.files.filter(f => {
                if (f.type === 'directory') {
                    // Exclude common non-source directories
                    return !excludeDirs.includes(f.name);
                }
                // Only keep .sv files
                return f.name.endsWith('.sv');
            });

            return {
                directory: result.directory,
                count: svFiles.length,
                files: svFiles.map(f => ({
                    name: f.name,
                    type: f.type,
                    size: f.size
                }))
            };
        },

        search_code: async (args: z.infer<typeof searchCodeSchema>) => {
            // Default to searching only .sv files
            const filePattern = args.filePattern || '**/*.sv';

            const result = await ctx.fileTools.searchCode(args.pattern, {
                rootPath: ctx.projectRoot,
                filePattern: filePattern,
                caseSensitive: args.caseSensitive,
                maxResults: args.maxResults
            });

            if (!result.success) {
                return { error: result.error };
            }

            // Filter results to only .sv files
            const svMatches = result.matches.filter(m => m.file.endsWith('.sv'));

            return {
                pattern: result.pattern,
                totalMatches: svMatches.length,
                matches: svMatches.slice(0, 20).map(m => ({
                    file: m.file,
                    line: m.line,
                    content: m.content.trim()
                }))
            };
        },

        find_module: async (args: z.infer<typeof findModuleSchema>) => {
            const module = ctx.indexer.findModule(args.name);

            if (!module) {
                return { error: `Module '${args.name}' not found in index` };
            }

            return {
                name: module.name,
                file: module.file,
                line: module.line,
                ports: module.ports,
                parameters: module.parameters,
                instantiates: module.instantiates
            };
        },

        get_dependencies: async (args: z.infer<typeof getDependenciesSchema>) => {
            const graph = ctx.indexer.getDependencyGraph(args.module);

            return {
                topModule: graph.topModule,
                compilationOrder: graph.compilationOrder,
                missing: graph.missing,
                cycles: graph.cycles,
                nodeCount: graph.nodes.size
            };
        },

        lint_file: async (args: z.infer<typeof lintFileSchema>) => {
            if (!ctx.verilator) {
                return { error: 'Verilator not configured' };
            }

            ctx.bus.emit({
                type: 'status',
                phase: 'verifying',
                label: `Linting ${args.path}...`
            });

            const result = await ctx.verilator.lint(args.path);

            // Log to terminal session if available
            if (ctx.terminalSessionManager && ctx.sessionId) {
                const logOutput = [
                    `Lint: ${args.path}`,
                    `Result: ${result.success ? 'PASS' : 'FAIL'}`,
                    `Errors: ${result.errors.length}, Warnings: ${result.warnings.length}`,
                    ...result.errors.map(e => `  ERROR: ${e.file}:${e.line} - ${e.message}`),
                    ...result.warnings.slice(0, 10).map(w => `  WARN: ${w.file}:${w.line} - ${w.message}`)
                ].join('\n');
                await ctx.terminalSessionManager.appendCommand(ctx.sessionId, `lint ${args.path}`, 'lint_file');
                await ctx.terminalSessionManager.appendOutput(ctx.sessionId, logOutput + '\n');
            }

            ctx.bus.emit({
                type: 'tool_result',
                tool: 'lint_file',
                ok: result.success,
                summary: result.success
                    ? `No errors (${result.warnings.length} warnings)`
                    : `${result.errors.length} errors, ${result.warnings.length} warnings`
            });

            // If many errors/warnings, store details in context file
            const totalIssues = result.errors.length + result.warnings.length;
            if (totalIssues > 20 && ctx.contextFileManager && ctx.sessionId) {
                const fullOutput = [
                    `=== Lint Results for ${args.path} ===`,
                    `Success: ${result.success}`,
                    ``,
                    `=== ERRORS (${result.errors.length}) ===`,
                    ...result.errors.map(e => `${e.file}:${e.line}:${e.column || 0}: ${e.code} - ${e.message}`),
                    ``,
                    `=== WARNINGS (${result.warnings.length}) ===`,
                    ...result.warnings.map(w => `${w.file}:${w.line}:${w.column || 0}: ${w.code} - ${w.message}`)
                ].join('\n');

                const ref = await ctx.contextFileManager.writeOutput('lint_file', ctx.sessionId, fullOutput);

                // Unix-like pattern: return file path only, agent uses tail/head/grep
                return {
                    success: result.success,
                    errorCount: result.errors.length,
                    warningCount: result.warnings.length,
                    outputFile: ref.path,
                    outputSize: `${ref.lineCount} lines (${(ref.size / 1024).toFixed(1)} KB)`,
                    hint: `Use tail to check the end: tail -50 "${ref.path}"`,
                    commands: {
                        tail: `tail -50 "${ref.path}"`,
                        head: `head -50 "${ref.path}"`,
                        grep: `grep -n "ERROR\\|error" "${ref.path}"`,
                        all: `cat "${ref.path}"`
                    }
                };
            }

            return {
                success: result.success,
                errors: result.errors,
                warnings: result.warnings
            };
        },

        run_simulation: async (args: z.infer<typeof runSimSchema>) => {
            if (!ctx.verilator) {
                return { error: 'Verilator not configured' };
            }

            const approval = await requestToolApproval('run_simulation', {
                top: args.top,
                testbench: args.testbench
            });
            if (!approval.approved) {
                return { error: approval.reason ?? 'User denied run_simulation' };
            }

            ctx.bus.emit({
                type: 'status',
                phase: 'verifying',
                label: `Simulating ${args.top}...`
            });

            const result = await ctx.verilator.simulate(args.top, {
                testbench: args.testbench,
                timeout: args.timeout
            });

            // If simulation succeeded and analyzeWaveform is requested
            let waveformAnalysis = null;
            if (result.success && result.vcdPath && args.analyzeWaveform) {
                const { VCDParser } = await import('../waveform/index.js');

                ctx.bus.emit({
                    type: 'sim_stage',
                    stage: 'parse_vcd',
                    status: 'started',
                    message: 'Analyzing waveform...'
                });

                try {
                    const parser = new VCDParser();
                    const data = await parser.parseFile(result.vcdPath);

                    // Get time range
                    let minTime = Infinity, maxTime = -Infinity;
                    for (const signal of data.signals) {
                        for (const [time] of signal.values) {
                            if (time < minTime) minTime = time;
                            if (time > maxTime) maxTime = time;
                        }
                    }

                    ctx.bus.emit({
                        type: 'waveform_loaded',
                        path: result.vcdPath,
                        signalCount: data.signals.length,
                        timeRange: {
                            start: BigInt(minTime === Infinity ? 0 : minTime),
                            end: BigInt(maxTime === -Infinity ? 0 : maxTime)
                        }
                    });

                    waveformAnalysis = {
                        signalCount: data.signals.length,
                        timeRange: { start: minTime, end: maxTime },
                        signals: data.signals.slice(0, 20).map(s => ({
                            name: s.name,
                            width: s.width,
                            changes: s.values.length
                        }))
                    };

                    ctx.bus.emit({
                        type: 'sim_stage',
                        stage: 'parse_vcd',
                        status: 'completed'
                    });
                } catch (err) {
                    ctx.bus.emit({
                        type: 'sim_stage',
                        stage: 'parse_vcd',
                        status: 'failed',
                        message: String(err)
                    });
                }
            }

            // Log to terminal session if available
            if (ctx.terminalSessionManager && ctx.sessionId) {
                const logOutput = [
                    `Simulation: ${args.top}`,
                    `Result: ${result.success ? 'PASS' : 'FAIL'} (exit code: ${result.exitCode})`,
                    result.vcdPath ? `VCD: ${result.vcdPath}` : '',
                    '--- STDOUT ---',
                    result.stdout.slice(0, 2000),
                    result.stdout.length > 2000 ? `... (${result.stdout.length} chars total)` : '',
                    '--- STDERR ---',
                    result.stderr.slice(0, 2000),
                    result.stderr.length > 2000 ? `... (${result.stderr.length} chars total)` : ''
                ].filter(Boolean).join('\n');
                await ctx.terminalSessionManager.appendCommand(ctx.sessionId, `simulate ${args.top}`, 'run_simulation');
                await ctx.terminalSessionManager.appendOutput(ctx.sessionId, logOutput + '\n');
            }

            // Check if output is large enough for context files
            const totalOutputSize = result.stdout.length + result.stderr.length;
            const shouldUseContextFile = totalOutputSize > 2048 && ctx.contextFileManager && ctx.sessionId;

            if (shouldUseContextFile && ctx.contextFileManager && ctx.sessionId) {
                const fullOutput = [
                    `=== Simulation Results for ${args.top} ===`,
                    `Success: ${result.success}`,
                    `Exit Code: ${result.exitCode}`,
                    result.vcdPath ? `VCD Path: ${result.vcdPath}` : '',
                    ``,
                    `=== STDOUT ===`,
                    result.stdout,
                    ``,
                    `=== STDERR ===`,
                    result.stderr
                ].filter(Boolean).join('\n');

                const ref = await ctx.contextFileManager.writeOutput('run_simulation', ctx.sessionId, fullOutput);

                // Unix-like pattern: return file path only, agent uses tail/head/grep
                return {
                    success: result.success,
                    exitCode: result.exitCode,
                    vcdPath: result.vcdPath,
                    waveformAnalysis,
                    outputFile: ref.path,
                    outputSize: `${ref.lineCount} lines (${(ref.size / 1024).toFixed(1)} KB)`,
                    hint: `Use tail to check the end: tail -50 "${ref.path}"`,
                    commands: {
                        tail: `tail -50 "${ref.path}"`,
                        head: `head -50 "${ref.path}"`,
                        grepError: `grep -n "error\\|Error\\|ERROR" "${ref.path}"`,
                        grepFail: `grep -n "fail\\|FAIL\\|assert" "${ref.path}"`,
                        all: `cat "${ref.path}"`
                    }
                };
            }

            return {
                success: result.success,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                vcdPath: result.vcdPath,
                waveformAnalysis
            };
        },

        open_waveform: async (args: z.infer<typeof openWaveformSchema>) => {
            const path = await import('path');
            const fs = await import('fs/promises');
            const { spawn } = await import('child_process');
            const { fileURLToPath } = await import('url');

            // Resolve path
            const resolvedPath = path.default.isAbsolute(args.vcdPath)
                ? args.vcdPath
                : path.default.join(ctx.projectRoot, args.vcdPath);

            // Check file exists
            try {
                await fs.access(resolvedPath);
            } catch {
                return { error: `VCD file not found: ${resolvedPath}` };
            }

            ctx.bus.emit({
                type: 'status',
                phase: 'tool',
                label: `Opening waveform viewer: ${args.vcdPath}`
            });

            // Check if we're in an interactive terminal
            if (process.stdin.isTTY) {
                // Direct mode - use viewer in current terminal
                const { WaveformViewer } = await import('../waveform/index.js');
                const viewer = new WaveformViewer({ bus: ctx.bus });

                try {
                    await viewer.open(resolvedPath);
                    return {
                        success: true,
                        message: `Waveform viewer closed for ${args.vcdPath}`
                    };
                } catch (err) {
                    return { error: `Failed to open waveform viewer: ${err}` };
                }
            } else {
                // Non-TTY mode - spawn new terminal window
                const cliPath = path.default.resolve(
                    path.default.dirname(fileURLToPath(import.meta.url)),
                    '../cli/main.js'
                );

                return new Promise((resolve) => {
                    let child;

                    if (process.platform === 'win32') {
                        // Windows: open new cmd window
                        child = spawn('cmd', ['/c', 'start', 'cmd', '/k',
                            `node "${cliPath}" wave "${resolvedPath}" && exit`
                        ], {
                            detached: true,
                            stdio: 'ignore',
                            shell: true
                        });
                    } else if (process.platform === 'darwin') {
                        // macOS: open new Terminal window
                        child = spawn('osascript', ['-e',
                            `tell app "Terminal" to do script "node '${cliPath}' wave '${resolvedPath}'"`
                        ], {
                            detached: true,
                            stdio: 'ignore'
                        });
                    } else {
                        // Linux: try common terminal emulators
                        const terminals = ['gnome-terminal', 'xterm', 'konsole'];
                        for (const term of terminals) {
                            try {
                                child = spawn(term, ['--', 'node', cliPath, 'wave', resolvedPath], {
                                    detached: true,
                                    stdio: 'ignore'
                                });
                                break;
                            } catch {
                                continue;
                            }
                        }
                    }

                    if (child) {
                        child.unref();
                        resolve({
                            success: true,
                            message: `Waveform viewer opened in new terminal window for ${args.vcdPath}`,
                            note: 'Viewer is running in a separate window. Press q to close it.'
                        });
                    } else {
                        resolve({
                            error: 'Could not open terminal window. Please run manually: node dist/cli/main.js wave ' + resolvedPath
                        });
                    }
                });
            }
        },

        get_project_stats: async () => {
            const stats = ctx.indexer.getStats();
            return stats;
        },

        find_all_sv_files: async (args: z.infer<typeof findAllSvFilesSchema>) => {
            // Always use project root, resolve '.' to project root
            const directory = (!args.directory || args.directory === '.')
                ? ctx.projectRoot
                : args.directory;

            // Use findFiles (glob) instead of listFiles for better performance and exclusion
            const files = await ctx.fileTools.findFiles('**/*.sv', {
                cwd: directory
            });

            return {
                directory: directory,
                count: files.length,
                files: files
            };
        },

        analyze_waveform: async (args: z.infer<typeof analyzeWaveformSchema>) => {
            const { VCDParser } = await import('../waveform/index.js');
            const path = await import('path');
            const fs = await import('fs/promises');

            // Resolve path
            const resolvedPath = path.default.isAbsolute(args.vcdPath)
                ? args.vcdPath
                : path.default.join(ctx.projectRoot, args.vcdPath);

            // Check file exists
            try {
                await fs.access(resolvedPath);
            } catch {
                return { error: `VCD file not found: ${resolvedPath}` };
            }

            ctx.bus.emit({
                type: 'sim_stage',
                stage: 'parse_vcd',
                status: 'started',
                message: `Parsing ${args.vcdPath}...`
            });

            // Parse VCD
            const parser = new VCDParser({
                signalFilter: args.signals ? new RegExp(args.signals.join('|')) : undefined
            });

            let data;
            try {
                data = await parser.parseFile(resolvedPath);
            } catch (err) {
                ctx.bus.emit({
                    type: 'sim_stage',
                    stage: 'parse_vcd',
                    status: 'failed',
                    message: String(err)
                });
                return { error: `Failed to parse VCD: ${err}` };
            }

            ctx.bus.emit({
                type: 'sim_stage',
                stage: 'parse_vcd',
                status: 'completed'
            });

            // Emit waveform loaded event
            const timeRange = getTimeRange(data);
            ctx.bus.emit({
                type: 'waveform_loaded',
                path: resolvedPath,
                signalCount: data.signals.length,
                timeRange: {
                    start: BigInt(timeRange.start),
                    end: BigInt(timeRange.end)
                }
            });

            ctx.bus.emit({
                type: 'sim_stage',
                stage: 'analyze_waveform',
                status: 'started'
            });

            // Analyze waveform
            const clocks: Array<{ signal: string; frequency: number }> = [];
            const anomalies: Array<{ type: string; signal: string; time: bigint }> = [];

            // Detect clocks (signals with regular toggling)
            if (args.detectClocks) {
                for (const signal of data.signals) {
                    if (signal.width === 1 && signal.values.length > 10) {
                        const freq = detectClockFrequency(signal);
                        if (freq > 0) {
                            clocks.push({ signal: signal.name, frequency: freq });
                        }
                    }
                }
            }

            // Check for anomalies
            if (args.checkAnomalies) {
                for (const signal of data.signals) {
                    // Check for X/Z values
                    for (const [time, value] of signal.values) {
                        if (typeof value === 'string' && (value.includes('x') || value.includes('X'))) {
                            anomalies.push({
                                type: 'unknown_value',
                                signal: signal.name,
                                time: BigInt(time)
                            });
                        }
                        if (typeof value === 'string' && (value.includes('z') || value.includes('Z'))) {
                            anomalies.push({
                                type: 'high_impedance',
                                signal: signal.name,
                                time: BigInt(time)
                            });
                        }
                    }
                }
            }

            // Calculate coverage (% of time signals have valid values)
            let validSamples = 0;
            let totalSamples = 0;
            for (const signal of data.signals) {
                for (const [, value] of signal.values) {
                    totalSamples++;
                    if (typeof value === 'number' ||
                        (typeof value === 'string' && !value.includes('x') && !value.includes('z'))) {
                        validSamples++;
                    }
                }
            }
            const coverage = totalSamples > 0 ? (validSamples / totalSamples) * 100 : 100;

            ctx.bus.emit({
                type: 'sim_stage',
                stage: 'analyze_waveform',
                status: 'completed'
            });

            // Emit analysis event
            const summary = `Analyzed ${data.signals.length} signals over ${timeRange.end - timeRange.start}${data.timescale}. ` +
                `Found ${clocks.length} clocks, ${anomalies.length} anomalies. Coverage: ${coverage.toFixed(1)}%`;

            ctx.bus.emit({
                type: 'waveform_analysis',
                clocks,
                anomalies: anomalies.slice(0, 100), // Limit to first 100
                coverage: { percentage: coverage },
                summary
            });

            return {
                path: resolvedPath,
                timescale: data.timescale,
                signalCount: data.signals.length,
                timeRange: {
                    start: timeRange.start,
                    end: timeRange.end,
                    duration: timeRange.end - timeRange.start
                },
                clocks,
                anomalyCount: anomalies.length,
                anomalies: anomalies.slice(0, 20),
                coverage: coverage.toFixed(1) + '%',
                summary,
                signals: data.signals.map(s => ({
                    name: s.name,
                    width: s.width,
                    changeCount: s.values.length
                }))
            };
        },

        ask_user: async (args: z.infer<typeof askUserSchema>) => {
            // Use centralized InputManager if available
            if (ctx.inputManager) {
                const response = await ctx.inputManager.askUser(
                    args.question,
                    args.options,
                    args.default
                );

                const normalized = response.toLowerCase();
                const isYes = ['y', 'yes', 'yeah', 'yep', 'ok', 'sure'].includes(normalized);
                const isNo = ['n', 'no', 'nope', 'nah'].includes(normalized);

                return {
                    response,
                    isYes,
                    isNo,
                    selectedOption: args.options?.find(o =>
                        o.toLowerCase() === normalized ||
                        o.toLowerCase().startsWith(normalized)
                    )
                };
            }

            // Fallback when ctx.inputManager not provided (legacy compatibility)
            const { getInputManager } = await import('../ui/index.js');
            const inputManager = getInputManager();
            inputManager.initialize();

            const response = await inputManager.askUser(
                args.question,
                args.options,
                args.default
            );

            const normalized = response.toLowerCase();
            const isYes = ['y', 'yes', 'yeah', 'yep', 'ok', 'sure'].includes(normalized);
            const isNo = ['n', 'no', 'nope', 'nah'].includes(normalized);

            return {
                response,
                isYes,
                isNo,
                selectedOption: args.options?.find(o =>
                    o.toLowerCase() === normalized ||
                    o.toLowerCase().startsWith(normalized)
                )
            };
        },

        find_vcd_files: async (args: z.infer<typeof findVcdFilesSchema>) => {
            const path = await import('path');
            const fs = await import('fs/promises');

            // Resolve starting directory
            const startDir = (!args.directory || args.directory === '.')
                ? ctx.projectRoot
                : path.default.isAbsolute(args.directory)
                    ? args.directory
                    : path.default.join(ctx.projectRoot, args.directory);

            ctx.bus.emit({
                type: 'status',
                phase: 'tool',
                label: `Searching for VCD files...`
            });

            // Use glob to find VCD files
            const files = await ctx.fileTools.findFiles('**/*.vcd', {
                cwd: startDir
            });

            // Filter by pattern if provided
            let matchedFiles = files;
            if (args.pattern) {
                const pattern = args.pattern.toLowerCase();
                matchedFiles = files.filter(f => {
                    const basename = path.default.basename(f).toLowerCase();
                    return basename.includes(pattern);
                });
            }

            // Get file stats for each match
            const results: Array<{ path: string; relativePath: string; size: number }> = [];
            for (const file of matchedFiles) {
                try {
                    const fullPath = path.default.join(startDir, file);
                    const stats = await fs.stat(fullPath);
                    results.push({
                        path: fullPath,
                        relativePath: file,
                        size: stats.size
                    });
                } catch {
                    // Skip files we can't stat
                }
            }

            return {
                count: results.length,
                files: results,
                searchDirectory: startDir,
                pattern: args.pattern || null
            };
        },

        // ====================================================================
        // Dynamic Context Discovery Tools
        // ====================================================================

        describe_tool: async (args: z.infer<typeof describeToolSchema>) => {
            if (!ctx.toolRegistry) {
                return { error: 'Tool registry not configured' };
            }

            const tool = ctx.toolRegistry.getToolDescription(args.toolName);
            if (!tool) {
                // Try to find similar tools
                const matches = ctx.toolRegistry.searchTools(args.toolName);
                if (matches.length > 0) {
                    return {
                        error: `Tool '${args.toolName}' not found. Did you mean: ${matches.slice(0, 3).map(m => m.name).join(', ')}?`
                    };
                }
                return { error: `Tool '${args.toolName}' not found` };
            }

            return {
                name: tool.name,
                description: tool.description,
                category: tool.category,
                parameters: tool.parameters,
                example: tool.example,
                formatted: ctx.toolRegistry.formatToolDescription(tool)
            };
        },

        read_context_output: async (args: z.infer<typeof readContextOutputSchema>) => {
            if (!ctx.contextFileManager) {
                return { error: 'Context file manager not configured' };
            }

            // Check if file exists
            const exists = await ctx.contextFileManager.exists(args.ref);
            if (!exists) {
                return { error: `Context file not found: ${args.ref}` };
            }

            try {
                const content = await ctx.contextFileManager.readOutput(args.ref, {
                    head: args.head,
                    tail: args.tail,
                    startLine: args.startLine,
                    endLine: args.endLine
                });

                const lines = content.split('\n').length;
                return {
                    content,
                    lines,
                    readMode: args.head ? `head ${args.head}` :
                        args.tail ? `tail ${args.tail}` :
                            args.startLine ? `range ${args.startLine}-${args.endLine || 'end'}` :
                                'full'
                };
            } catch (err) {
                return { error: `Failed to read context output: ${err}` };
            }
        },

        search_history: async (args: z.infer<typeof searchHistorySchema>) => {
            if (!ctx.memoryManager) {
                return { error: 'Memory manager not configured' };
            }

            try {
                const sessionFilter = args.sessionOnly ? ctx.sessionId : null;
                const results = await ctx.memoryManager.queryArchivedHistory(
                    sessionFilter ?? null,
                    args.query
                );

                if (results.length === 0) {
                    return {
                        count: 0,
                        message: `No archived messages found matching: ${args.query}`,
                        note: 'History is archived when context window fills up. Recent messages are still in active context.'
                    };
                }

                return {
                    count: results.length,
                    query: args.query,
                    sessionOnly: args.sessionOnly,
                    results: results.map(r => ({
                        turn: r.turnNumber,
                        role: r.role,
                        excerpt: r.content,
                        relevance: (r.relevance * 100).toFixed(0) + '%'
                    }))
                };
            } catch (err) {
                return { error: `Failed to search history: ${err}` };
            }
        },

        search_terminal: async (args: z.infer<typeof searchTerminalSchema>) => {
            if (!ctx.terminalSessionManager || !ctx.sessionId) {
                return { error: 'Terminal session manager not configured' };
            }

            try {
                const hits = await ctx.terminalSessionManager.searchOutput(
                    ctx.sessionId,
                    args.pattern,
                    args.context
                );

                if (hits.length === 0) {
                    return {
                        count: 0,
                        message: `No matches found for pattern: ${args.pattern}`
                    };
                }

                return {
                    count: hits.length,
                    pattern: args.pattern,
                    hits: hits.slice(0, 20).map(hit => ({
                        line: hit.line,
                        content: hit.content,
                        context: {
                            before: hit.before,
                            after: hit.after
                        }
                    })),
                    formatted: ctx.terminalSessionManager.formatSearchHits(hits.slice(0, 20))
                };
            } catch (err) {
                return { error: `Failed to search terminal output: ${err}` };
            }
        },

        // Get terminal file path for direct grep access
        get_terminal_file_path: async (_args: z.infer<typeof getTerminalFilePathSchema>) => {
            if (!ctx.terminalSessionManager || !ctx.sessionId) {
                return { error: 'Terminal session manager not configured' };
            }

            const filePath = ctx.terminalSessionManager.getSessionFilePath?.(ctx.sessionId);
            if (!filePath) {
                return {
                    error: 'Terminal session file not available',
                    note: 'Use search_terminal tool instead'
                };
            }

            return {
                filePath,
                sessionId: ctx.sessionId,
                note: 'You can use grep directly on this file: grep "pattern" ' + filePath
            };
        },

        // Search skills by capability/task
        search_skills: async (args: z.infer<typeof searchSkillsSchema>) => {
            if (!ctx.skillRegistry) {
                return { error: 'Skill registry not configured' };
            }

            try {
                const matches = ctx.skillRegistry.matchSkills(args.query, args.maxResults);

                if (matches.length === 0) {
                    return {
                        count: 0,
                        message: `No skills found matching: ${args.query}`,
                        skillsDir: ctx.skillRegistry.getSkillsDir(),
                        note: 'You can also grep the skills directory directly'
                    };
                }

                return {
                    count: matches.length,
                    query: args.query,
                    skillsDir: ctx.skillRegistry.getSkillsDir(),
                    matches: matches.map(m => ({
                        name: m.skill.name,
                        description: m.skill.description,
                        relevance: (m.relevance * 100).toFixed(0) + '%',
                        matchedTrigger: m.matchedTrigger,
                        filePath: m.filePath
                    }))
                };
            } catch (err) {
                return { error: `Failed to search skills: ${err}` };
            }
        },

        // Get full skill definition
        get_skill: async (args: z.infer<typeof getSkillSchema>) => {
            if (!ctx.skillRegistry) {
                return { error: 'Skill registry not configured' };
            }

            const skill = ctx.skillRegistry.getSkill(args.name);
            if (!skill) {
                return {
                    error: `Skill not found: ${args.name}`,
                    availableSkills: ctx.skillRegistry.getSkillNames()
                };
            }

            const ref = ctx.skillRegistry.getSkillRef(args.name);
            return {
                skill,
                filePath: ref?.filePath,
                formatted: ctx.skillRegistry.formatSkillForAgent(skill)
            };
        },

        // Execute a bundled skill script
        run_skill_script: async (args: z.infer<typeof runSkillScriptSchema>) => {
            if (!ctx.skillRegistry) {
                return { error: 'Skill registry not configured' };
            }

            // Check skill exists
            const skill = ctx.skillRegistry.getSkill(args.skillName);
            if (!skill) {
                return { error: `Skill not found: ${args.skillName}` };
            }

            // Check script is in skill's executables list
            const executables = skill.executables ?? [];
            if (!executables.includes(args.scriptPath)) {
                return {
                    error: `Script not found in skill: ${args.scriptPath}`,
                    availableScripts: executables
                };
            }

            const approval = await requestToolApproval('run_skill_script', {
                skillName: args.skillName,
                scriptPath: args.scriptPath
            });
            if (!approval.approved) {
                return { error: approval.reason ?? 'User denied run_skill_script' };
            }

            try {
                const result = await ctx.skillRegistry.executeScript(
                    args.skillName,
                    args.scriptPath,
                    {
                        sessionId: ctx.sessionId ?? 'unknown',
                        projectRoot: ctx.projectRoot,
                        query: '',
                        env: args.env
                    }
                );

                return {
                    success: result.success,
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    duration: `${result.duration}ms`
                };
            } catch (err) {
                return { error: `Failed to execute skill script: ${err}` };
            }
        },

        // Check MCP server and tool status
        check_mcp_status: async (args: z.infer<typeof checkMcpStatusSchema>) => {
            if (!ctx.mcpToolSync) {
                return {
                    error: 'MCP tool sync not configured',
                    note: 'No MCP servers are connected'
                };
            }

            if (args.serverName) {
                // Check specific server
                const servers = ctx.mcpToolSync.getAllServers();
                const server = servers.find(s => s.name === args.serverName);

                if (!server) {
                    return {
                        error: `Server not found: ${args.serverName}`,
                        availableServers: servers.map(s => s.name)
                    };
                }

                const tools = ctx.mcpToolSync.getServerTools(args.serverName);

                return {
                    server: {
                        name: server.name,
                        status: server.status,
                        error: server.error,
                        toolCount: server.toolCount,
                        lastSync: server.lastSync ? new Date(server.lastSync).toISOString() : null
                    },
                    tools: tools.map(t => t.name),
                    needsAuth: server.status === 'needs_auth',
                    authMessage: server.status === 'needs_auth'
                        ? `Server ${server.name} requires re-authentication. Please ask the user to re-authenticate.`
                        : null
                };
            }

            // Return summary of all servers
            const summary = ctx.mcpToolSync.getSummary();

            return {
                serverCount: summary.serverCount,
                availableServers: summary.availableServers,
                serversNeedingAuth: summary.serversNeedingAuth,
                totalTools: summary.totalTools,
                toolsByServer: summary.toolsByServer,
                toolsDir: summary.toolsDir,
                formatted: ctx.mcpToolSync.formatSummaryForAgent()
            };
        },

        // Get full MCP tool definition
        get_mcp_tool: async (args: z.infer<typeof getMcpToolSchema>) => {
            if (!ctx.mcpToolSync) {
                return { error: 'MCP tool sync not configured' };
            }

            // Check availability first
            const availability = ctx.mcpToolSync.isToolAvailable(args.serverName, args.toolName);
            if (!availability.available) {
                return {
                    error: `Tool not available: ${availability.reason}`,
                    serverName: args.serverName,
                    toolName: args.toolName
                };
            }

            const tool = ctx.mcpToolSync.getTool(args.serverName, args.toolName);
            if (!tool) {
                return { error: `Tool not found: ${args.toolName} on server ${args.serverName}` };
            }

            return {
                tool: {
                    name: tool.name,
                    description: tool.description,
                    server: tool.server,
                    status: tool.status,
                    inputSchema: tool.inputSchema,
                    examples: tool.examples,
                    tags: tool.tags
                },
                available: true
            };
        },

        // ====================================================================
        // Tool Setup Tools
        // ====================================================================

        check_tool_status: async (args: z.infer<typeof checkToolStatusSchema>) => {
            const status: Record<string, { installed: boolean; version?: string; path?: string }> = {};

            if (args.tool === 'verible' || args.tool === 'both') {
                try {
                    const { binaryManager: veribleManager } = await import('../indexer/verible/binary-manager.js');
                    const available = await veribleManager.isAvailable('verible-verilog-syntax');
                    if (available) {
                        const loc = await veribleManager.findBinary('verible-verilog-syntax', false);
                        status.verible = { installed: true, version: loc.version, path: loc.path };
                    } else {
                        status.verible = { installed: false };
                    }
                } catch {
                    status.verible = { installed: false };
                }
            }

            if (args.tool === 'slang' || args.tool === 'both') {
                try {
                    const { slangBinaryManager } = await import('../indexer/slang/binary-manager.js');
                    const available = await slangBinaryManager.isAvailable();
                    if (available) {
                        const loc = await slangBinaryManager.findBinary(false);
                        status.slang = { installed: true, version: loc.version, path: loc.path };
                    } else {
                        status.slang = { installed: false };
                    }
                } catch {
                    status.slang = { installed: false };
                }
            }

            return status;
        },

        setup_verible: async (_args: z.infer<typeof setupVeribleSchema>) => {
            // First check if already installed
            try {
                const { binaryManager: veribleManager } = await import('../indexer/verible/binary-manager.js');
                const available = await veribleManager.isAvailable('verible-verilog-syntax');
                if (available) {
                    const loc = await veribleManager.findBinary('verible-verilog-syntax', false);
                    return {
                        alreadyInstalled: true,
                        version: loc.version,
                        path: loc.path,
                        message: `Verible is already installed (version ${loc.version})`
                    };
                }
            } catch {
                // Continue with setup
            }

            const approval = await requestToolApproval('setup_verible', { tool: 'verible' });
            if (!approval.approved) {
                return {
                    success: false,
                    error: approval.reason ?? 'User denied setup_verible',
                    message: 'Verible setup canceled by user.'
                };
            }

            // Run interactive setup flow
            try {
                const { runToolSetupFlow } = await import('../indexer/setup/setup-flow.js');
                const result = await runToolSetupFlow(
                    ctx.bus,
                    ctx.policy,
                    ctx.projectRoot,
                    { interactive: true, tools: ['verible'] }
                );

                if (result.success && result.tools.verible) {
                    const v = result.tools.verible;
                    return {
                        success: true,
                        action: v.action,
                        version: v.version,
                        path: v.path,
                        message: `Verible ${v.action}${v.version ? ` (version ${v.version})` : ''}`
                    };
                } else {
                    return {
                        success: false,
                        error: result.error || 'Setup did not complete',
                        message: 'Verible setup was not completed. You can retry or run "gateflow setup" manually.'
                    };
                }
            } catch (err) {
                return {
                    success: false,
                    error: String(err),
                    message: 'Failed to run interactive setup. Try running "gateflow setup" manually.'
                };
            }
        },

        setup_slang: async (_args: z.infer<typeof setupSlangSchema>) => {
            // First check if already installed
            try {
                const { slangBinaryManager } = await import('../indexer/slang/binary-manager.js');
                const available = await slangBinaryManager.isAvailable();
                if (available) {
                    const loc = await slangBinaryManager.findBinary(false);
                    return {
                        alreadyInstalled: true,
                        version: loc.version,
                        path: loc.path,
                        message: `Slang is already installed (version ${loc.version})`
                    };
                }
            } catch {
                // Continue with setup
            }

            const approval = await requestToolApproval('setup_slang', { tool: 'slang' });
            if (!approval.approved) {
                return {
                    success: false,
                    error: approval.reason ?? 'User denied setup_slang',
                    message: 'Slang setup canceled by user.'
                };
            }

            // Check prerequisites first with streaming feedback
            const { execSync } = await import('child_process');
            const prerequisites: Record<string, boolean> = {};

            // Emit status to indicate prerequisite checking has started
            ctx.bus.emit({
                type: 'status',
                phase: 'setup',
                label: 'Checking prerequisites...'
            });

            // Helper to emit prerequisite stage events
            const emitPrereq = (prereq: 'git' | 'cmake' | 'compiler', status: 'started' | 'completed' | 'failed', message?: string) => {
                ctx.bus.emit({
                    type: 'prereq_install_stage',
                    prerequisite: prereq,
                    stage: 'checking',
                    status,
                    message
                });
            };

            // Check git
            emitPrereq('git', 'started', 'Checking for git...');
            try {
                const gitVersion = execSync('git --version', { stdio: 'pipe' }).toString().trim();
                prerequisites.git = true;
                emitPrereq('git', 'completed', gitVersion);
            } catch {
                prerequisites.git = false;
                emitPrereq('git', 'failed', 'git not found');
            }

            // Check cmake
            emitPrereq('cmake', 'started', 'Checking for cmake...');
            try {
                const cmakeVersion = execSync('cmake --version', { stdio: 'pipe' }).toString().split('\n')[0].trim();
                prerequisites.cmake = true;
                emitPrereq('cmake', 'completed', cmakeVersion);
            } catch {
                prerequisites.cmake = false;
                emitPrereq('cmake', 'failed', 'cmake not found');
            }

            // Check compiler
            const { platform } = await import('os');
            const os = platform();

            emitPrereq('compiler', 'started', 'Checking for C++20 compiler...');
            if (os === 'win32') {
                try {
                    const vsVersion = execSync('"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -property installationVersion', { stdio: 'pipe' }).toString().trim();
                    prerequisites.compiler = true;
                    emitPrereq('compiler', 'completed', `Visual Studio ${vsVersion}`);
                } catch {
                    prerequisites.compiler = false;
                    emitPrereq('compiler', 'failed', 'Visual Studio not found');
                }
            } else {
                try {
                    const gppVersion = execSync('g++ --version', { stdio: 'pipe' }).toString().split('\n')[0].trim();
                    prerequisites.compiler = true;
                    emitPrereq('compiler', 'completed', gppVersion);
                } catch {
                    try {
                        const clangVersion = execSync('clang++ --version', { stdio: 'pipe' }).toString().split('\n')[0].trim();
                        prerequisites.compiler = true;
                        emitPrereq('compiler', 'completed', clangVersion);
                    } catch {
                        prerequisites.compiler = false;
                        emitPrereq('compiler', 'failed', 'No C++20 compiler found (g++ or clang++)');
                    }
                }
            }

            const allPrereqsMet = prerequisites.git && prerequisites.cmake && prerequisites.compiler;

            // Log missing prerequisites (the setup flow will handle installing them)
            if (!allPrereqsMet) {
                const missing = [
                    !prerequisites.git ? 'git' : null,
                    !prerequisites.cmake ? 'cmake' : null,
                    !prerequisites.compiler ? 'C++20 compiler' : null
                ].filter(Boolean);

                // Emit status update about missing prerequisites
                ctx.bus.emit({
                    type: 'status',
                    phase: 'setup',
                    label: `Missing: ${missing.join(', ')}`
                });

                // Emit info about missing prerequisites - the agent will install them
                ctx.bus.emit({
                    type: 'token',
                    text: `\nMissing prerequisites: ${missing.join(', ')}. The setup assistant will help install them.\n`
                });
            } else {
                ctx.bus.emit({
                    type: 'status',
                    phase: 'setup',
                    label: 'All prerequisites found'
                });
            }

            // Run interactive setup flow (agent will install prerequisites if needed)
            try {
                const { runToolSetupFlow } = await import('../indexer/setup/setup-flow.js');
                const result = await runToolSetupFlow(
                    ctx.bus,
                    ctx.policy,
                    ctx.projectRoot,
                    { interactive: true, tools: ['slang'] }
                );

                if (result.success && result.tools.slang) {
                    const s = result.tools.slang;
                    return {
                        success: true,
                        action: s.action,
                        version: s.version,
                        path: s.path,
                        message: `Slang ${s.action}${s.version ? ` (version ${s.version})` : ''}`
                    };
                } else {
                    return {
                        success: false,
                        error: result.error || 'Setup did not complete',
                        message: 'Slang setup was not completed. You can retry or run "gateflow setup" manually.'
                    };
                }
            } catch (err) {
                return {
                    success: false,
                    error: String(err),
                    message: 'Failed to run interactive setup. Try running "gateflow setup" manually.'
                };
            }
        },

        help_setup_tools: async (args: z.infer<typeof helpSetupToolsSchema>) => {
            // Check current status
            const { binaryManager: veribleManager } = await import('../indexer/verible/binary-manager.js');
            const { slangBinaryManager } = await import('../indexer/slang/binary-manager.js');

            const veribleAvailable = await veribleManager.isAvailable('verible-verilog-syntax');
            const slangAvailable = await slangBinaryManager.isAvailable();

            // Determine which tools need setup
            let toolsToSetup: ('verible' | 'slang')[] = [];

            if (args.tools && args.tools.length > 0) {
                // User specified which tools
                toolsToSetup = args.tools;
            } else {
                // Auto-detect missing tools
                if (!veribleAvailable) toolsToSetup.push('verible');
                if (!slangAvailable) toolsToSetup.push('slang');
            }

            // If all requested tools are installed, return success
            if (toolsToSetup.length === 0) {
                return {
                    success: true,
                    message: 'All analysis tools are already configured!',
                    status: {
                        verible: veribleAvailable ? 'installed' : 'missing',
                        slang: slangAvailable ? 'installed' : 'missing'
                    }
                };
            }

            const approval = await requestToolApproval('help_setup_tools', {
                tools: toolsToSetup
            });
            if (!approval.approved) {
                return {
                    success: false,
                    error: approval.reason ?? 'User denied help_setup_tools',
                    message: 'Tool setup canceled by user.'
                };
            }

            // Run interactive setup flow for missing tools
            try {
                const { runToolSetupFlow } = await import('../indexer/setup/setup-flow.js');
                const result = await runToolSetupFlow(
                    ctx.bus,
                    ctx.policy,
                    ctx.projectRoot,
                    { interactive: true, tools: toolsToSetup }
                );

                return {
                    success: result.success,
                    tools: result.tools,
                    message: result.success
                        ? `Setup complete for: ${toolsToSetup.join(', ')}`
                        : `Setup incomplete. ${result.error || ''}`
                };
            } catch (err) {
                return {
                    success: false,
                    error: String(err),
                    message: 'Setup failed. Try running "gateflow setup" manually.'
                };
            }
        },

        // ====================================================================
        // Phase 2: Context Window Management Tools (Cursor's Dynamic Context Discovery)
        // ====================================================================

        // Grep through context files (tool outputs, history, terminal)
        grep_context: async (args: z.infer<typeof grepContextSchema>) => {
            if (!ctx.dynamicContextManager) {
                return { error: 'Dynamic context manager not configured' };
            }

            try {
                const results = await ctx.dynamicContextManager.grep(
                    args.filePattern,
                    args.pattern,
                    { context: args.context }
                );

                if (results.length === 0) {
                    return {
                        count: 0,
                        message: `No matches found for pattern: ${args.pattern} in ${args.filePattern}`
                    };
                }

                return {
                    count: results.length,
                    pattern: args.pattern,
                    filePattern: args.filePattern,
                    results: results.slice(0, 50).map(r => ({
                        file: r.file,
                        lineNumber: r.lineNumber,
                        line: r.line,
                        before: r.before,
                        after: r.after
                    }))
                };
            } catch (err) {
                return { error: `Failed to grep context: ${err}` };
            }
        },

        // JQ on context file
        jq_context: async (args: z.infer<typeof jqContextSchema>) => {
            if (!ctx.dynamicContextManager) {
                return { error: 'Dynamic context manager not configured' };
            }

            try {
                const result = await ctx.dynamicContextManager.jq(args.filePath, args.filter);
                return {
                    filePath: args.filePath,
                    filter: args.filter,
                    result
                };
            } catch (err) {
                return { error: `Failed to jq context: ${err}` };
            }
        },

        // Read last N lines of a context file (Cursor's tail pattern)
        tail_context: async (args: z.infer<typeof tailContextSchema>) => {
            if (!ctx.dynamicContextManager) {
                return { error: 'Dynamic context manager not configured' };
            }

            try {
                const content = await ctx.dynamicContextManager.tail(args.filePath, args.lines);
                const lineCount = content.split('\n').length;

                return {
                    filePath: args.filePath,
                    lines: lineCount,
                    requestedLines: args.lines,
                    content
                };
            } catch (err) {
                return { error: `Failed to tail context file: ${err}` };
            }
        },

        // Read first N lines of a context file
        head_context: async (args: z.infer<typeof headContextSchema>) => {
            if (!ctx.dynamicContextManager) {
                return { error: 'Dynamic context manager not configured' };
            }

            try {
                const content = await ctx.dynamicContextManager.head(args.filePath, args.lines);
                const lineCount = content.split('\n').length;

                return {
                    filePath: args.filePath,
                    lines: lineCount,
                    requestedLines: args.lines,
                    content
                };
            } catch (err) {
                return { error: `Failed to head context file: ${err}` };
            }
        },

        // List available context files
        list_context: async (args: z.infer<typeof listContextSchema>) => {
            if (!ctx.dynamicContextManager || !ctx.sessionId) {
                return { error: 'Dynamic context manager not configured' };
            }

            try {
                const index = await ctx.dynamicContextManager.getContextIndex(ctx.sessionId);

                // Filter by type if specified
                let entries = index.entries;
                if (args.type !== 'all') {
                    entries = entries.filter(e => e.type === args.type);
                }

                return {
                    sessionId: ctx.sessionId,
                    type: args.type,
                    count: entries.length,
                    files: entries.map(e => ({
                        path: e.path,
                        type: e.type,
                        tool: e.tool,
                        lines: e.lines,
                        size: `${(e.size / 1024).toFixed(1)} KB`,
                        created: new Date(e.timestamp).toISOString()
                    }))
                };
            } catch (err) {
                return { error: `Failed to list context files: ${err}` };
            }
        },

        // Get semantically meaningful chunk of a large HDL file
        get_file_chunk: async (args: z.infer<typeof getFileChunkSchema>) => {
            if (!ctx.fileChunker) {
                return { error: 'File chunker not configured' };
            }

            try {
                const index = await ctx.fileChunker.chunkFile(args.filePath);

                // By line number
                if (args.lineNumber !== undefined) {
                    const chunk = ctx.fileChunker.getChunkForLine(index.chunks, args.lineNumber);
                    if (!chunk) {
                        return { error: `No chunk found containing line ${args.lineNumber}` };
                    }
                    return {
                        chunk: {
                            index: chunk.index,
                            type: chunk.chunkType,
                            name: chunk.name,
                            lines: `${chunk.startLine}-${chunk.endLine}`,
                            tokens: chunk.tokenCount,
                            content: chunk.content
                        }
                    };
                }

                // By name
                if (args.chunkName) {
                    const chunk = ctx.fileChunker.getChunkByName(index, args.chunkName);
                    if (!chunk) {
                        return {
                            error: `Chunk not found: ${args.chunkName}`,
                            availableNames: Array.from(index.byName.keys())
                        };
                    }
                    return {
                        chunk: {
                            index: chunk.index,
                            type: chunk.chunkType,
                            name: chunk.name,
                            lines: `${chunk.startLine}-${chunk.endLine}`,
                            tokens: chunk.tokenCount,
                            content: chunk.content
                        }
                    };
                }

                // By type
                if (args.chunkType) {
                    const chunks = ctx.fileChunker.getChunksByType(index, args.chunkType);
                    return {
                        count: chunks.length,
                        type: args.chunkType,
                        chunks: chunks.map(c => ({
                            index: c.index,
                            name: c.name,
                            lines: `${c.startLine}-${c.endLine}`,
                            tokens: c.tokenCount
                        }))
                    };
                }

                // Return index summary
                return {
                    filePath: index.filePath,
                    totalLines: index.totalLines,
                    totalTokens: index.totalTokens,
                    chunkCount: index.chunks.length,
                    chunks: index.chunks.map(c => ({
                        index: c.index,
                        type: c.chunkType,
                        name: c.name,
                        lines: `${c.startLine}-${c.endLine}`,
                        tokens: c.tokenCount
                    }))
                };
            } catch (err) {
                return { error: `Failed to chunk file: ${err}` };
            }
        },

        // Select file chunks relevant to a query
        select_chunks: async (args: z.infer<typeof selectChunksSchema>) => {
            if (!ctx.fileChunker) {
                return { error: 'File chunker not configured' };
            }

            try {
                const index = await ctx.fileChunker.chunkFile(args.filePath);
                const selection = ctx.fileChunker.selectRelevantChunks(
                    index.chunks,
                    args.query,
                    args.maxTokens
                );

                return {
                    filePath: args.filePath,
                    query: args.query,
                    maxTokens: args.maxTokens,
                    selectedChunks: selection.chunks.length,
                    totalTokens: selection.totalTokens,
                    coverage: `${selection.coveragePercent}%`,
                    fullFile: selection.fullFile,
                    chunks: selection.chunks.map(c => ({
                        index: c.index,
                        type: c.chunkType,
                        name: c.name,
                        lines: `${c.startLine}-${c.endLine}`,
                        tokens: c.tokenCount,
                        content: c.content
                    }))
                };
            } catch (err) {
                return { error: `Failed to select chunks: ${err}` };
            }
        },

        // Search learned patterns and knowledge (unified via KnowledgeService)
        search_knowledge: async (args: z.infer<typeof searchKnowledgeSchema>) => {
            if (!ctx.memoryService) {
                return { error: 'Memory service not configured' };
            }

            try {
                const knowledgeService = ctx.memoryService.getKnowledgeService();

                // Determine which sources to search based on flags
                const sources: ('structural' | 'learned')[] = args.structuralOnly
                    ? ['structural']
                    : args.learnedOnly
                        ? ['learned']
                        : ['structural', 'learned'];

                const requestedTypes = args.types ?? [];
                const learnedTypes = requestedTypes.filter((t) =>
                    LEARNED_TYPES.includes(t as typeof LEARNED_TYPES[number])
                );
                const structuralTypes = requestedTypes.filter(
                    (t) => !LEARNED_TYPES.includes(t as typeof LEARNED_TYPES[number])
                ) as Array<'module_info' | 'dependency' | 'project_context'>;

                let effectiveSources = sources;
                if (!args.structuralOnly && !args.learnedOnly && requestedTypes.length > 0) {
                    if (learnedTypes.length === 0 && structuralTypes.length > 0) {
                        effectiveSources = ['structural'];
                    } else if (structuralTypes.length === 0 && learnedTypes.length > 0) {
                        effectiveSources = ['learned'];
                    }
                }

                const results = knowledgeService.search({
                    query: args.query,
                    knowledgeTypes: effectiveSources.includes('learned') && learnedTypes.length
                        ? (learnedTypes as LearnedKnowledgeType[])
                        : undefined,
                    structuralTypes: effectiveSources.includes('structural') && structuralTypes.length
                        ? structuralTypes
                        : undefined,
                    maxResults: args.maxResults ?? 10,
                    sources: effectiveSources,
                });

                if (results.length === 0) {
                    return {
                        count: 0,
                        message: `No knowledge found matching: ${args.query}`,
                        note: 'Knowledge includes structural info from indexer and learned patterns from lint sessions, code generation, and user corrections.',
                        sources: effectiveSources,
                    };
                }

                return {
                    count: results.length,
                    query: args.query,
                    sources: effectiveSources,
                    results: results.map(r => ({
                        id: r.id,
                        type: r.knowledgeItem?.type ??
                            (r.dependency ? 'dependency'
                                : r.hierarchyNode ? 'project_context'
                                    : r.declaration?.kind ?? r.source),
                        title: r.title,
                        content: r.content,
                        source: r.source,
                        confidence: r.knowledgeItem
                            ? `${(r.knowledgeItem.confidence * 100).toFixed(0)}%`
                            : 'N/A',
                        relevance: `${(r.relevance * 100).toFixed(0)}%`,
                        useCount: r.knowledgeItem?.useCount ?? 0,
                        matchReason: r.matchReason
                    }))
                };
            } catch (err) {
                return { error: `Failed to search knowledge: ${err}` };
            }
        },

        // Get current token budget status
        get_token_budget: async (_args: z.infer<typeof getTokenBudgetSchema>) => {
            if (!ctx.tokenBudgetManager) {
                return { error: 'Token budget manager not configured' };
            }

            const budget = ctx.tokenBudgetManager.getBudget();
            const needsCompaction = ctx.tokenBudgetManager.needsCompaction();

            return {
                budget: {
                    contextWindow: budget.contextWindow,
                    allocation: {
                        system: budget.allocation.system,
                        history: budget.allocation.history,
                        tools: budget.allocation.tools,
                        reserve: budget.allocation.reserve
                    },
                    usage: {
                        system: budget.usage.system,
                        history: budget.usage.history,
                        tools: budget.usage.tools,
                        cumulative: budget.usage.cumulative
                    }
                },
                needsCompaction,
                available: {
                    system: ctx.tokenBudgetManager.getAvailable('system'),
                    history: ctx.tokenBudgetManager.getAvailable('history'),
                    tools: ctx.tokenBudgetManager.getAvailable('tools')
                }
            };
        },

        // Continuation system - checkpoint for multi-segment execution
        request_continuation: async (args: z.infer<typeof requestContinuationSchema>) => {
            // This tool returns a special marker that signals the continuation system
            // The agent loop detects this and triggers a new segment
            ctx.bus.emit({
                type: 'status',
                phase: 'tool',
                label: `Checkpointing: ${args.completedTasks.length} done, ${args.remainingTasks.length} remaining`
            });

            return {
                _continuation: true,
                completedTasks: args.completedTasks,
                remainingTasks: args.remainingTasks,
                partialResults: args.partialResults,
                notes: args.notes
            };
        }
    };
}

// Helper: Get time range from waveform data
function getTimeRange(data: { signals: Array<{ values: [number, unknown][] }> }): { start: number; end: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const signal of data.signals) {
        for (const [time] of signal.values) {
            if (time < min) min = time;
            if (time > max) max = time;
        }
    }
    return { start: min === Infinity ? 0 : min, end: max === -Infinity ? 0 : max };
}

// Helper: Detect clock frequency from signal
function detectClockFrequency(signal: { values: [number, number | string][] }): number {
    const values = signal.values;
    if (values.length < 4) return 0;

    // Find rising edges
    const risingEdges: number[] = [];
    for (let i = 1; i < values.length; i++) {
        const prev = values[i - 1][1];
        const curr = values[i][1];
        if (prev === 0 && curr === 1) {
            risingEdges.push(values[i][0]);
        }
    }

    if (risingEdges.length < 2) return 0;

    // Calculate average period
    let totalPeriod = 0;
    for (let i = 1; i < risingEdges.length; i++) {
        totalPeriod += risingEdges[i] - risingEdges[i - 1];
    }
    const avgPeriod = totalPeriod / (risingEdges.length - 1);

    // Check if period is consistent (clock-like)
    let variance = 0;
    for (let i = 1; i < risingEdges.length; i++) {
        const period = risingEdges[i] - risingEdges[i - 1];
        variance += Math.pow(period - avgPeriod, 2);
    }
    variance /= risingEdges.length - 1;

    // If variance is too high, not a clock
    if (variance > avgPeriod * 0.1) return 0;

    // Return frequency (assuming timescale is in ns for now)
    return avgPeriod > 0 ? 1 / avgPeriod : 0;
}

// ============================================================================
// Tool Specifications for AI SDK
// ============================================================================

/**
 * Tool specification with AI SDK 6 needsApproval support.
 * When needsApproval is true and autoApprove is false, tools will pause
 * for human approval before execution.
 */
export interface ToolSpec {
    description: string;
    parameters: z.ZodType<unknown>;
    needsApproval: boolean;
}

export function getToolSpecs(): Record<string, ToolSpec> {
    return {
        // File operations
        read_file: {
            description: 'Read the contents of a file. Returns the file content with line numbers.',
            parameters: readFileSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.read_file
        },
        write_file: {
            description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
            parameters: writeFileSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.write_file
        },
        edit_lines: {
            description: 'Edit specific lines in a file. Specify line ranges to replace with new content.',
            parameters: editLinesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.edit_lines
        },
        search_replace: {
            description: 'Search and replace text in a file. Can use regex patterns.',
            parameters: searchReplaceSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_replace
        },
        list_files: {
            description: 'List files in a directory. Can filter by extension and recurse.',
            parameters: listFilesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.list_files
        },
        search_code: {
            description: 'Search for a pattern across all project files. Returns matching lines with context.',
            parameters: searchCodeSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_code
        },

        // SystemVerilog analysis
        find_module: {
            description: 'Find a SystemVerilog module by name. Returns its location, ports, and parameters.',
            parameters: findModuleSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.find_module
        },
        get_dependencies: {
            description: 'Get the dependency graph for a module. Returns compilation order and any missing modules.',
            parameters: getDependenciesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_dependencies
        },
        lint_file: {
            description: 'Run Verilator lint on a SystemVerilog file. Returns errors and warnings.',
            parameters: lintFileSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.lint_file
        },
        find_all_sv_files: {
            description: 'Find all SystemVerilog (.sv) files in the project. Returns a list of all .sv file paths.',
            parameters: findAllSvFilesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.find_all_sv_files
        },
        get_project_stats: {
            description: 'Get statistics about the project: file count, modules, packages, etc.',
            parameters: z.object({}),
            needsApproval: TOOL_APPROVAL_CONFIG.get_project_stats
        },

        // Simulation and waveform
        run_simulation: {
            description: 'Compile and run a simulation with Verilator. Returns stdout, stderr, VCD path, and optional waveform analysis. Set analyzeWaveform=true to automatically parse and analyze the VCD output.',
            parameters: runSimSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.run_simulation
        },
        open_waveform: {
            description: 'Open an interactive terminal-based waveform viewer for a VCD file. Supports keyboard navigation, zoom, pan, and signal inspection. Blocks until the viewer is closed.',
            parameters: openWaveformSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.open_waveform
        },
        // IMPORTANT: analyze_waveform is here but implementation was truncated in view. Assuming it exists.

        // Context Tools
        grep_context: {
            description: 'Search through context files (tool outputs, history, logs) using regex patterns.',
            parameters: grepContextSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.grep_context
        },
        jq_context: {
            description: 'Filter JSON context files using JQ syntax. Falls back to simple parsing if JQ is missing.',
            parameters: jqContextSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.jq_context
        },
        tail_context: {
            description: 'Read the last N lines of a context file. Use to check if a process finished correctly.',
            parameters: tailContextSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.tail_context
        },
        analyze_waveform: {
            description: 'Analyze a VCD waveform file from simulation. Detects clocks, checks for X/Z anomalies, and calculates signal coverage. Returns signal list, timing info, and analysis summary.',
            parameters: analyzeWaveformSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.analyze_waveform
        },
        find_vcd_files: {
            description: 'Search for VCD waveform files in the project. ALWAYS use this tool first when user mentions a VCD file by name to find its full path before opening. Returns list of matching files with paths.',
            parameters: findVcdFilesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.find_vcd_files
        },

        // Human-in-the-loop
        ask_user: {
            description: 'Ask the user a question and wait for their response. Use this for human-in-the-loop confirmations, like asking if they want to view waveforms after simulation. Returns the user response with isYes/isNo flags for easy checking.',
            parameters: askUserSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.ask_user
        },

        // Dynamic Context Discovery Tools
        describe_tool: {
            description: 'Get full description and parameters for a tool. Use this to understand how to use any tool.',
            parameters: describeToolSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.describe_tool
        },
        read_context_output: {
            description: 'Read a portion of tool output stored in a context file. Use head/tail for quick inspection.',
            parameters: readContextOutputSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.read_context_output
        },
        search_history: {
            description: 'Search archived conversation history for relevant context from earlier in the session.',
            parameters: searchHistorySchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_history
        },
        search_terminal: {
            description: 'Search terminal/simulation output for patterns. Find specific errors or output from commands.',
            parameters: searchTerminalSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_terminal
        },
        get_terminal_file_path: {
            description: 'Get the path to the terminal session file for direct grep access.',
            parameters: getTerminalFilePathSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_terminal_file_path
        },

        // Skills
        search_skills: {
            description: 'Search skill files for relevant capabilities based on a query.',
            parameters: searchSkillsSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_skills
        },
        get_skill: {
            description: 'Get full skill definition by name.',
            parameters: getSkillSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_skill
        },
        run_skill_script: {
            description: 'Execute a bundled script from a skill.',
            parameters: runSkillScriptSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.run_skill_script
        },

        // MCP integration
        check_mcp_status: {
            description: 'Check status of MCP servers and tools.',
            parameters: checkMcpStatusSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.check_mcp_status
        },
        get_mcp_tool: {
            description: 'Get full definition of an MCP tool.',
            parameters: getMcpToolSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_mcp_tool
        },

        // Tool Setup Tools - for installing/configuring analysis tools
        check_tool_status: {
            description: 'Check if SystemVerilog analysis tools (Verible and/or Slang) are installed and working. Use this when the user asks about tool availability, wants to know what tools are installed, or when you need to verify tools before suggesting installation. Returns installation status, version, and path for each tool.',
            parameters: checkToolStatusSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.check_tool_status
        },
        setup_verible: {
            description: 'Download and configure Verible (SystemVerilog syntax parser). Use this when the user wants to install Verible, asks to set up parsing tools, or needs help getting Verible working. Downloads prebuilt binaries from GitHub - fast and easy, no compilation required. Requires user approval for downloads.',
            parameters: setupVeribleSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.setup_verible
        },
        setup_slang: {
            description: 'Build and configure Slang (SystemVerilog semantic analyzer). Use this when the user wants to install Slang, asks to set up semantic analysis, or needs help getting Slang working. WARNING: Requires git, cmake, and a C++20 compiler. Takes several minutes to build from source. Requires user approval for build commands.',
            parameters: setupSlangSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.setup_slang
        },
        help_setup_tools: {
            description: 'Interactive helper for setting up missing analysis tools. Use this when the user asks for help setting up tools, when a tool operation fails due to missing tools, when the user asks "why isnt X working", or when they want guided setup assistance. Automatically detects which tools are missing and runs an interactive setup conversation. Preferred over individual setup_verible/setup_slang for general setup help.',
            parameters: helpSetupToolsSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.help_setup_tools
        },

        // Continuation system
        request_continuation: {
            description: 'Request continuation to a new segment when approaching the step limit but more work remains. Call this when you have completed some tasks but need more steps to finish. Provide a checkpoint of completed tasks, remaining tasks, and any context notes. The system will continue execution in a new segment with fresh step budget.',
            parameters: requestContinuationSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.request_continuation
        }
    };
}

