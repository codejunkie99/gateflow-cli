/**
 * Tool Catalog
 * Self-documenting tools with metadata for AI SDK 6 Agent interface
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from '../agent/tools.js';

export interface ToolDefinition {
    name: string;
    description: string;
    category: 'read' | 'write' | 'edit' | 'analyze' | 'execute';
    inputSchema: z.ZodType<any>;
    outputSchema?: z.ZodType<any>;
    preconditions?: string[];
    postconditions?: string[];
    sideEffects?: string[];
    examples?: Array<{
        input: any;
        output: any;
        description: string;
    }>;
    performanceHints?: {
        avgLatency?: number;
        batchSize?: number;
    };
}

/**
 * Create tool catalog from existing tool executors
 * Wraps tools with AI SDK 6's tool() helper
 */
export function createToolCatalog(context: ToolContext): Record<string, any> {
    const { fileTools, editTools, indexer, verilator } = context;

    return {
        read_file: tool({
            description: 'Read the contents of a file. Returns the file content with line numbers.',
            inputSchema: z.object({
                path: z.string().describe('Path to the file to read'),
                startLine: z.number().optional().describe('Starting line number (1-indexed)'),
                endLine: z.number().optional().describe('Ending line number (inclusive)')
            }),
            execute: async ({ path, startLine, endLine }) => {
                return await fileTools.readFile(path, { startLine, endLine });
            }
        }),

        write_file: tool({
            description: 'Write content to a file. Creates the file if it does not exist.',
            inputSchema: z.object({
                path: z.string().describe('Path to the file to write'),
                content: z.string().describe('Full content to write to the file')
            }),
            execute: async ({ path, content }) => {
                return await fileTools.writeFile(path, content);
            }
        }),

        edit_lines: tool({
            description: 'Edit specific lines in a file. Specify line ranges to replace.',
            inputSchema: z.object({
                path: z.string().describe('Path to the file to edit'),
                edits: z.array(z.object({
                    startLine: z.number().describe('First line to replace (1-indexed)'),
                    endLine: z.number().describe('Last line to replace (inclusive)'),
                    newContent: z.string().describe('New content to insert')
                }))
            }),
            execute: async ({ path, edits }) => {
                return await editTools.editLines(path, edits);
            }
        }),

        search_replace: tool({
            description: 'Search and replace text in a file.',
            inputSchema: z.object({
                path: z.string().describe('Path to the file to edit'),
                search: z.string().describe('Text or regex pattern to search for'),
                replace: z.string().describe('Replacement text'),
                all: z.boolean().optional().default(false).describe('Replace all occurrences'),
                isRegex: z.boolean().optional().default(false).describe('Treat search as regex')
            }),
            execute: async ({ path, search, replace, all, isRegex }) => {
                return await editTools.searchReplace(path, search, replace, { all, isRegex });
            }
        }),

        list_files: tool({
            description: 'List SystemVerilog (.sv) files in a directory. Automatically filters for .sv files only.',
            inputSchema: z.object({
                directory: z.string().describe('Directory path to list'),
                extensions: z.array(z.string()).optional().default(['.sv']).describe('Filter by extensions (default: [".sv"])'),
                recursive: z.boolean().optional().default(true).describe('List recursively (default: true)')
            }),
            execute: async ({ directory, extensions, recursive }) => {
                return await fileTools.listFiles(directory, { extensions, recursive });
            }
        }),

        search_code: tool({
            description: 'Search for a pattern across all SystemVerilog (.sv) files in the project.',
            inputSchema: z.object({
                pattern: z.string().describe('Search pattern (regex)'),
                filePattern: z.string().optional().default('**/*.sv').describe('Glob pattern for files (default: "**/*.sv")'),
                caseSensitive: z.boolean().optional().default(false),
                maxResults: z.number().optional().default(50)
            }),
            execute: async ({ pattern, filePattern, caseSensitive, maxResults }) => {
                return await fileTools.searchCode(pattern, { filePattern, caseSensitive, maxResults });
            }
        }),

        find_all_sv_files: tool({
            description: 'Find all SystemVerilog (.sv) files in the project. Use this to discover what .sv files exist.',
            inputSchema: z.object({
                directory: z.string().optional().default('.').describe('Starting directory (default: project root)')
            }),
            execute: async ({ directory }) => {
                // Use findFiles with .sv pattern - pattern is first arg, cwd is option
                return await fileTools.findFiles('**/*.sv', { cwd: directory || '.' });
            }
        }),

        find_module: tool({
            description: 'Find a SystemVerilog module by name.',
            inputSchema: z.object({
                name: z.string().describe('Module name to find')
            }),
            execute: async ({ name }) => {
                return await indexer.findModule(name);
            }
        }),

        get_dependencies: tool({
            description: 'Get the dependency graph for a module.',
            inputSchema: z.object({
                module: z.string().describe('Module name')
            }),
            execute: async ({ module: moduleName }) => {
                // Get module and extract dependencies from its analysis
                const moduleInfo = await indexer.findModule(moduleName);
                if (!moduleInfo) {
                    return { success: false, error: `Module ${moduleName} not found` };
                }
                return { success: true, module: moduleName, dependencies: (moduleInfo as any).dependencies || [] };
            }
        }),

        lint_file: tool({
            description: 'Run Verilator lint on a SystemVerilog file.',
            inputSchema: z.object({
                path: z.string().describe('Path to the file to lint')
            }),
            execute: async ({ path }) => {
                if (!verilator) {
                    throw new Error('Verilator not available');
                }
                return await verilator.lint(path);
            }
        }),

        run_simulation: tool({
            description: 'Run a simulation with Verilator.',
            inputSchema: z.object({
                top: z.string().describe('Top module name'),
                testbench: z.string().optional().describe('Testbench file path'),
                timeout: z.number().optional().describe('Timeout in ms')
            }),
            execute: async ({ top, testbench, timeout }) => {
                if (!verilator) {
                    throw new Error('Verilator not available');
                }
                return await verilator.simulate(top, { testbench, timeout });
            }
        }),

        get_project_stats: tool({
            description: 'Get project statistics.',
            inputSchema: z.object({}),
            execute: async () => {
                return indexer.getStats();
            }
        })
    };
}

/**
 * Get tool definitions for documentation
 */
export function getToolDefinitions(): ToolDefinition[] {
    // This can be expanded to include metadata about each tool
    return [
        {
            name: 'read_file',
            description: 'Read the contents of a file',
            category: 'read',
            inputSchema: z.object({
                path: z.string(),
                startLine: z.number().optional(),
                endLine: z.number().optional()
            }),
            preconditions: ['File exists or path is valid'],
            postconditions: ['File content returned'],
            examples: [{
                input: { path: 'src/counter.sv' },
                output: { content: 'module counter...', lines: 50 },
                description: 'Read entire file'
            }]
        }
        // Add more tool definitions as needed
    ];
}

