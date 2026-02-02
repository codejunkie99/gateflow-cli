/**
 * Tool Executors
 * Implementation of tool runtime behavior.
 */

import { z } from 'zod';
import { shouldAutoApprove } from '../../fileops/approval.js';
import { LEARNED_TYPES, type LearnedKnowledgeType } from '../../memory/knowledge-service/index.js';
import type { ToolContext } from './context.js';
import { TOOL_APPROVAL_CONFIG } from './approval-config.js';
import {
    readFileSchema,
    writeFileSchema,
    editLinesSchema,
    searchReplaceSchema,
    listFilesSchema,
    searchCodeSchema,
    findModuleSchema,
    getDependenciesSchema,
    lintFileSchema,
    runSimSchema,
    openWaveformSchema,
    findAllSvFilesSchema,
    analyzeWaveformSchema,
    askUserSchema,
    findVcdFilesSchema,
    describeToolSchema,
    readContextOutputSchema,
    searchHistorySchema,
    searchTerminalSchema,
    getTerminalFilePathSchema,
    searchSkillsSchema,
    getSkillSchema,
    runSkillScriptSchema,
    checkMcpStatusSchema,
    getMcpToolSchema,
    grepContextSchema,
    jqContextSchema,
    tailContextSchema,
    headContextSchema,
    listContextSchema,
    getFileChunkSchema,
    selectChunksSchema,
    searchKnowledgeSchema,
    getTokenBudgetSchema,
    requestContinuationSchema,
    checkToolStatusSchema,
    setupVeribleSchema,
    setupSlangSchema,
    helpSetupToolsSchema,
} from './schemas.js';

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
                const { VCDParser } = await import('../../waveform/index.js');

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
                const { WaveformViewer } = await import('../../waveform/index.js');
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
            const { VCDParser } = await import('../../waveform/index.js');
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
            const { getInputManager } = await import('../../ui/index.js');
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

                const limitedResults = results.slice(0, args.maxResults);
                return {
                    count: limitedResults.length,
                    query: args.query,
                    sessionOnly: args.sessionOnly,
                    results: limitedResults.map(r => ({
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
                const pattern = args.pattern ?? args.query;
                if (!pattern) {
                    return { error: 'Missing pattern for search_terminal' };
                }
                const hits = await ctx.terminalSessionManager.searchOutput(
                    ctx.sessionId,
                    pattern,
                    args.context
                );

                if (hits.length === 0) {
                    return {
                        count: 0,
                        message: `No matches found for pattern: ${pattern}`
                    };
                }

                const limitedHits = hits.slice(0, args.maxResults);
                return {
                    count: limitedHits.length,
                    pattern,
                    hits: limitedHits.map(hit => ({
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

            const skillName = args.skillName ?? args.name;
            const scriptPath = args.scriptPath ?? args.script;
            if (!skillName || !scriptPath) {
                return { error: 'skillName and scriptPath are required' };
            }

            // Check skill exists
            const skill = ctx.skillRegistry.getSkill(skillName);
            if (!skill) {
                return { error: `Skill not found: ${skillName}` };
            }

            // Check script is in skill's executables list
            const executables = skill.executables ?? [];
            if (!executables.includes(scriptPath)) {
                return {
                    error: `Script not found in skill: ${scriptPath}`,
                    availableScripts: executables
                };
            }

            const approval = await requestToolApproval('run_skill_script', {
                skillName,
                scriptPath
            });
            if (!approval.approved) {
                return { error: approval.reason ?? 'User denied run_skill_script' };
            }

            try {
                const result = await ctx.skillRegistry.executeScript(
                    skillName,
                    scriptPath,
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

            const serverName = args.serverName ?? args.server;

            if (serverName) {
                // Check specific server
                const servers = ctx.mcpToolSync.getAllServers();
                const server = servers.find(s => s.name === serverName);

                if (!server) {
                    return {
                        error: `Server not found: ${serverName}`,
                        availableServers: servers.map(s => s.name)
                    };
                }

                const tools = ctx.mcpToolSync.getServerTools(serverName);

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

            const serverName = args.serverName ?? args.server;
            const toolName = args.toolName ?? args.tool;
            if (!serverName || !toolName) {
                return { error: 'serverName and toolName are required' };
            }

            // Check availability first
            const availability = ctx.mcpToolSync.isToolAvailable(serverName, toolName);
            if (!availability.available) {
                return {
                    error: `Tool not available: ${availability.reason}`,
                    serverName,
                    toolName
                };
            }

            const tool = ctx.mcpToolSync.getTool(serverName, toolName);
            if (!tool) {
                return { error: `Tool not found: ${toolName} on server ${serverName}` };
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
                    const { binaryManager: veribleManager } = await import('../../indexer/verible/binary-manager.js');
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
                    const { slangBinaryManager } = await import('../../indexer/slang/binary-manager.js');
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
                const { binaryManager: veribleManager } = await import('../../indexer/verible/binary-manager.js');
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
                const { runToolSetupFlow } = await import('../../indexer/setup/setup-flow.js');
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
                const { slangBinaryManager } = await import('../../indexer/slang/binary-manager.js');
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
                const { runToolSetupFlow } = await import('../../indexer/setup/setup-flow.js');
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
            const { binaryManager: veribleManager } = await import('../../indexer/verible/binary-manager.js');
            const { slangBinaryManager } = await import('../../indexer/slang/binary-manager.js');

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
                const { runToolSetupFlow } = await import('../../indexer/setup/setup-flow.js');
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
                const pattern = args.pattern ?? args.query;
                if (!pattern) {
                    return { error: 'Missing pattern for grep_context' };
                }
                const results = await ctx.dynamicContextManager.grep(
                    args.filePattern,
                    pattern,
                    { context: args.context }
                );

                if (results.length === 0) {
                    return {
                        count: 0,
                        message: `No matches found for pattern: ${pattern} in ${args.filePattern}`
                    };
                }

                const limitedResults = results.slice(0, args.maxResults);
                return {
                    count: limitedResults.length,
                    pattern,
                    filePattern: args.filePattern,
                    results: limitedResults.map(r => ({
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
                const filePath = args.filePath ?? args.ref;
                if (!filePath) {
                    return { error: 'Missing filePath for jq_context' };
                }
                const result = await ctx.dynamicContextManager.jq(filePath, args.filter);
                return {
                    filePath,
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
                const filePath = args.filePath ?? args.ref;
                if (!filePath) {
                    return { error: 'Missing filePath for tail_context' };
                }
                const content = await ctx.dynamicContextManager.tail(filePath, args.lines);
                const lineCount = content.split('\n').length;

                return {
                    filePath,
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
                const filePath = args.filePath ?? args.ref;
                if (!filePath) {
                    return { error: 'Missing filePath for head_context' };
                }
                const content = await ctx.dynamicContextManager.head(filePath, args.lines);
                const lineCount = content.split('\n').length;

                return {
                    filePath,
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

                const requestedType = args.type === 'tool' ? 'tool_output' : args.type;
                // Filter by type if specified
                let entries = index.entries;
                if (requestedType !== 'all') {
                    entries = entries.filter(e => e.type === requestedType);
                }

                return {
                    sessionId: ctx.sessionId,
                    type: requestedType,
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
                const filePath = args.filePath ?? args.path;
                if (!filePath) {
                    return { error: 'Missing filePath for get_file_chunk' };
                }
                const index = await ctx.fileChunker.chunkFile(filePath);

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
                const filePath = args.filePath ?? args.path;
                if (!filePath) {
                    return { error: 'Missing filePath for select_chunks' };
                }
                const index = await ctx.fileChunker.chunkFile(filePath);
                const selection = ctx.fileChunker.selectRelevantChunks(
                    index.chunks,
                    args.query,
                    args.maxTokens
                );

                return {
                    filePath,
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
