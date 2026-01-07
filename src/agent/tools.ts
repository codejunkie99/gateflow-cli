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
import type { ToolRegistry, ContextFileManager, TerminalSessionManager } from '../context/index.js';
import type { MemoryManager } from '../memory/manager.js';

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
    // Dynamic context discovery (optional for backwards compatibility)
    toolRegistry?: ToolRegistry;
    contextFileManager?: ContextFileManager;
    terminalSessionManager?: TerminalSessionManager;
    memoryManager?: MemoryManager;
    sessionId?: string;
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
                const summary = await ctx.contextFileManager.getSummary(ref);

                return {
                    success: result.success,
                    errorCount: result.errors.length,
                    warningCount: result.warnings.length,
                    errors: result.errors.slice(0, 10),  // First 10 inline
                    warnings: result.warnings.slice(0, 5), // First 5 inline
                    contextFile: ref.path,
                    note: `Full details (${totalIssues} issues) stored in context file. Use read_context_output to view more.`
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
                const summary = await ctx.contextFileManager.getSummary(ref);

                // Return summary with context file reference
                return {
                    success: result.success,
                    exitCode: result.exitCode,
                    vcdPath: result.vcdPath,
                    waveformAnalysis,
                    // Provide first/last lines inline
                    stdoutPreview: result.stdout.slice(0, 500),
                    stderrPreview: result.stderr.slice(0, 500),
                    contextFile: ref.path,
                    outputSize: `${(totalOutputSize / 1024).toFixed(1)} KB`,
                    note: `Full output stored in context file. Use read_context_output to view more.`
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
            const readline = await import('readline');

            return new Promise((resolve) => {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });

                let prompt = `\n${args.question}`;
                if (args.options && args.options.length > 0) {
                    prompt += `\n  Options: ${args.options.join(' / ')}`;
                }
                if (args.default) {
                    prompt += ` [${args.default}]`;
                }
                prompt += '\n> ';

                // Emit event so renderer knows we're waiting for input
                ctx.bus.emit({
                    type: 'status',
                    phase: 'tool',
                    label: 'Waiting for user input...'
                });

                rl.question(prompt, (answer) => {
                    rl.close();
                    const response = answer.trim() || args.default || '';

                    // Normalize yes/no responses
                    const normalized = response.toLowerCase();
                    const isYes = ['y', 'yes', 'yeah', 'yep', 'ok', 'sure'].includes(normalized);
                    const isNo = ['n', 'no', 'nope', 'nah'].includes(normalized);

                    resolve({
                        response,
                        isYes,
                        isNo,
                        selectedOption: args.options?.find(o =>
                            o.toLowerCase() === normalized ||
                            o.toLowerCase().startsWith(normalized)
                        )
                    });
                });
            });
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
            description: 'Compile and run a simulation with Verilator. Returns stdout, stderr, VCD path, and optional waveform analysis. Set analyzeWaveform=true to automatically parse and analyze the VCD output.',
            parameters: runSimSchema
        },
        open_waveform: {
            description: 'Open an interactive terminal-based waveform viewer for a VCD file. Supports keyboard navigation, zoom, pan, and signal inspection. Blocks until the viewer is closed.',
            parameters: openWaveformSchema
        },
        get_project_stats: {
            description: 'Get statistics about the project: file count, modules, packages, etc.',
            parameters: z.object({})
        },
        find_all_sv_files: {
            description: 'Find all SystemVerilog (.sv) files in the project. Returns a list of all .sv file paths.',
            parameters: findAllSvFilesSchema
        },
        analyze_waveform: {
            description: 'Analyze a VCD waveform file from simulation. Detects clocks, checks for X/Z anomalies, and calculates signal coverage. Returns signal list, timing info, and analysis summary.',
            parameters: analyzeWaveformSchema
        },
        ask_user: {
            description: 'Ask the user a question and wait for their response. Use this for human-in-the-loop confirmations, like asking if they want to view waveforms after simulation. Returns the user response with isYes/isNo flags for easy checking.',
            parameters: askUserSchema
        },
        find_vcd_files: {
            description: 'Search for VCD waveform files in the project. ALWAYS use this tool first when user mentions a VCD file by name to find its full path before opening. Returns list of matching files with paths.',
            parameters: findVcdFilesSchema
        },

        // Dynamic Context Discovery Tools
        describe_tool: {
            description: 'Get full description and parameters for a tool. Use this to understand how to use any tool.',
            parameters: describeToolSchema
        },
        read_context_output: {
            description: 'Read a portion of tool output stored in a context file. Use head/tail for quick inspection.',
            parameters: readContextOutputSchema
        },
        search_history: {
            description: 'Search archived conversation history for relevant context from earlier in the session.',
            parameters: searchHistorySchema
        },
        search_terminal: {
            description: 'Search terminal/simulation output for patterns. Find specific errors or output from commands.',
            parameters: searchTerminalSchema
        }
    };
}

