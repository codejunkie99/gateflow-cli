/**
 * AI Tool Definitions
 * Tools for the Vercel AI SDK agent
 */

import { z } from 'zod';
import type { EventBus } from '../events/index.js';
import type { PolicyEngine } from '../approval/index.js';
import type { FileTools, EditTools } from '../fileops/index.js';
import type { ProjectIndexer } from '../indexer/index.js';
import type { DiffEngine } from '../diff/index.js';
import type { Verilator } from '../verification/verilator.js';

// ============================================================================
// Tool Context
// ============================================================================

export interface ToolContext {
    bus: EventBus;
    policy: PolicyEngine;
    fileTools: FileTools;
    editTools: EditTools;
    indexer: ProjectIndexer;
    diffEngine: DiffEngine;
    verilator?: Verilator;
    projectRoot: string;
    dryRun: boolean;
    autoApprove: boolean;
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
    timeout: z.number().optional().describe('Simulation timeout in ms')
});

// Find All SV Files
export const findAllSvFilesSchema = z.object({
    directory: z.string().optional().default('.').describe('Starting directory (default: project root)')
});

// ============================================================================
// Tool Implementations
// ============================================================================

export function createToolExecutors(ctx: ToolContext) {
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

            const result = await ctx.fileTools.writeFile(args.path, args.content, {
                skipApproval: ctx.autoApprove
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
            const result = await ctx.editTools.editLines(args.path, args.edits, {
                dryRun: ctx.dryRun,
                skipApproval: ctx.autoApprove
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
            const result = await ctx.editTools.searchReplace(
                args.path,
                args.search,
                args.replace,
                {
                    all: args.all,
                    isRegex: args.isRegex,
                    dryRun: ctx.dryRun,
                    skipApproval: ctx.autoApprove
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

            ctx.bus.emit({
                type: 'tool_result',
                tool: 'lint_file',
                ok: result.success,
                summary: result.success
                    ? `No errors (${result.warnings.length} warnings)`
                    : `${result.errors.length} errors, ${result.warnings.length} warnings`
            });

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

            ctx.bus.emit({
                type: 'status',
                phase: 'verifying',
                label: `Simulating ${args.top}...`
            });

            const result = await ctx.verilator.simulate(args.top, {
                testbench: args.testbench,
                timeout: args.timeout
            });

            return {
                success: result.success,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                vcdPath: result.vcdPath
            };
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
        }
    };
}

// ============================================================================
// Tool Specifications for AI SDK
// ============================================================================

export function getToolSpecs() {
    return {
        read_file: {
            description: 'Read the contents of a file. Returns the file content with line numbers.',
            parameters: readFileSchema
        },
        write_file: {
            description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
            parameters: writeFileSchema
        },
        edit_lines: {
            description: 'Edit specific lines in a file. Specify line ranges to replace with new content.',
            parameters: editLinesSchema
        },
        search_replace: {
            description: 'Search and replace text in a file. Can use regex patterns.',
            parameters: searchReplaceSchema
        },
        list_files: {
            description: 'List files in a directory. Can filter by extension and recurse.',
            parameters: listFilesSchema
        },
        search_code: {
            description: 'Search for a pattern across all project files. Returns matching lines with context.',
            parameters: searchCodeSchema
        },
        find_module: {
            description: 'Find a SystemVerilog module by name. Returns its location, ports, and parameters.',
            parameters: findModuleSchema
        },
        get_dependencies: {
            description: 'Get the dependency graph for a module. Returns compilation order and any missing modules.',
            parameters: getDependenciesSchema
        },
        lint_file: {
            description: 'Run Verilator lint on a SystemVerilog file. Returns errors and warnings.',
            parameters: lintFileSchema
        },
        run_simulation: {
            description: 'Compile and run a simulation with Verilator. Returns stdout, stderr, and VCD path.',
            parameters: runSimSchema
        },
        get_project_stats: {
            description: 'Get statistics about the project: file count, modules, packages, etc.',
            parameters: z.object({})
        },
        find_all_sv_files: {
            description: 'Find all SystemVerilog (.sv) files in the project. Returns a list of all .sv file paths.',
            parameters: findAllSvFilesSchema
        }
    };
}

