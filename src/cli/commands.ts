/**
 * CLI Commands
 * Command implementations for GateFlow CLI
 */

import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { glob } from 'glob';
import { EventBus, ExitCodes, type ExitCode } from '../events/index.js';
import { PolicyEngine, initPolicyEngine } from '../approval/index.js';
import { createTools } from '../fileops/index.js';
import { DiffEngine } from '../diff/index.js';
import { SVIndexerAdapter } from '../indexer/sv-indexer-adapter.js';
import { GateFlowAgent, type ToolContext, type PromptMode } from '../agent/index.js';
import { Verilator } from '../verification/index.js';
import { FixLoop } from '../verification/fix-loop.js';
import { WatchManager } from '../watch/index.js';
import { TerminalRenderer, createRenderer, InputManager, initInputManager } from '../ui/index.js';
import { getConfigManager } from '../config/index.js';
import {
    getToolRegistry,
    getContextFileManager,
    getTerminalSessionManager,
    createDynamicContextManager,
    createTokenBudgetManager,
    createFileChunker,
    createSkillManager,
    createToolDescriptionManager,
    createSemanticSummarizer,
    type ToolRegistry,
    type ContextFileManager,
    type TerminalSessionManager,
    type DynamicContextManager,
    type TokenBudgetManager,
    type FileChunker,
    type SkillManager,
    type ToolDescriptionManager,
    type SemanticSummarizer
} from '../context/index.js';
import { createMemoryService, setGlobalMemoryService, type MemoryService } from '../memory/index.js';

// ============================================================================
// Types
// ============================================================================

export interface GlobalOptions {
    yes: boolean;
    dryRun: boolean;
    json: boolean;
    verbose: boolean;
    cwd: string;
}

export interface CommandContext {
    bus: EventBus;
    policy: PolicyEngine;
    tools: ReturnType<typeof createTools>;
    diffEngine: DiffEngine;
    indexer: SVIndexerAdapter;
    verilator: Verilator;
    renderer: TerminalRenderer;
    inputManager: InputManager;
    options: GlobalOptions;
    projectRoot: string;
    // Dynamic context discovery managers
    toolRegistry: ToolRegistry;
    contextFileManager: ContextFileManager;
    terminalSessionManager: TerminalSessionManager;
    sessionId: string;
    // Unified memory service (provides memoryManager + knowledgeStore + token budgeting)
    memoryService: MemoryService;
    // Phase 2: Context Window Management managers
    dynamicContextManager: DynamicContextManager;
    tokenBudgetManager: TokenBudgetManager;
    fileChunker: FileChunker;
    skillManager: SkillManager;
    toolDescriptionManager: ToolDescriptionManager;
    semanticSummarizer: SemanticSummarizer;
}

// ============================================================================
// Context Setup
// ============================================================================

export async function setupContext(options: GlobalOptions): Promise<CommandContext> {
    // Use the current working directory as project root (simple, predictable)
    const projectRoot = path.resolve(options.cwd);

    // Validate directory exists
    try {
        const stat = await fs.stat(projectRoot);
        if (!stat.isDirectory()) {
            throw new Error(`Not a directory: ${projectRoot}`);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`Directory not found: ${projectRoot}`);
        }
        throw error;
    }

    // Warn if no HDL files found (non-blocking)
    if (!options.json) {
        const hdlFiles = await glob('**/*.{sv,svh,v,vh}', {
            cwd: projectRoot,
            ignore: ['node_modules/**', 'dist/**', 'obj_dir/**'],
            nodir: true
        });
        if (hdlFiles.length === 0) {
            console.log(chalk.yellow('  Warning: No SystemVerilog files found in project root'));
        }
    }

    // Create event bus
    const bus = new EventBus();

    // Create renderer (unless JSON mode)
    const renderer = createRenderer(bus, {
        jsonMode: options.json,
        verbose: options.verbose
    });

    // Initialize policy engine
    const policy = initPolicyEngine({ projectRoot });

    // Create tools
    const tools = createTools(bus, policy, projectRoot);

    // Create diff engine
    const diffEngine = new DiffEngine(projectRoot);

    // Create indexer (using new SVIndexer via adapter)
    const indexer = new SVIndexerAdapter(projectRoot, bus);

    // Create Verilator instance (use VERILATOR_PATH env var if set)
    const verilatorPath = process.env.VERILATOR_PATH;
    const verilator = new Verilator(bus, verilatorPath ? { binary: verilatorPath } : undefined);

    // Dynamic context discovery managers
    const toolRegistry = getToolRegistry();
    const contextFileManager = getContextFileManager();
    const terminalSessionManager = getTerminalSessionManager();

    // Initialize context file manager
    await contextFileManager.initialize();

    // Generate unique session ID
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Load configuration (for optional LLM enrichment)
    const configManager = getConfigManager();
    const gateConfig = await configManager.load(projectRoot);
    const llmConfig = gateConfig.LLM ?? {};

    // Unified memory service for persistent context, knowledge, and token budgeting
    // Pass projectGetter so KnowledgeService can query indexer directly for structural knowledge
    const memoryService = createMemoryService(projectRoot, bus, {
        contextTokenBudget: 2000,  // Token budget for AI context injection
        projectGetter: () => indexer.getProject(),  // Enable KnowledgeService to query indexer
        tiering: {
            hotSize: 100,          // Keep 100 frequently-accessed items in memory
            warmThreshold: 3,      // Promote to hot after 3 accesses
            coldAgeDays: 30,       // Demote to cold after 30 days unused
            enabled: true
        },
        knowledge: {
            llm: {
                enabled: llmConfig.knowledgeEnabled ?? false,
                model: llmConfig.knowledgeModel ?? llmConfig.defaultModel,
                maxTokens: llmConfig.knowledgeMaxTokens ?? 512,
                temperature: llmConfig.knowledgeTemperature ?? 0.2,
                queryExpansion: llmConfig.knowledgeQueryExpansion ?? false,
                semanticTags: llmConfig.knowledgeSemanticTags ?? false
            }
        }
    });
    await memoryService.initialize();
    setGlobalMemoryService(memoryService);  // Make available globally for adapter

    // Phase 2: Context Window Management managers (Cursor's Dynamic Context Discovery)
    const dynamicContextManager = createDynamicContextManager(bus, { projectId: sessionId });
    await dynamicContextManager.initialize();

    const tokenBudgetManager = createTokenBudgetManager(bus);

    // FileChunker always uses indexer for accurate AST-based boundaries
    const fileChunker = createFileChunker({}, indexer);

    const skillManager = createSkillManager();
    await skillManager.initialize();

    const toolDescriptionManager = createToolDescriptionManager();
    await toolDescriptionManager.initialize();

    const semanticSummarizer = createSemanticSummarizer();

    // Initialize centralized input manager
    const inputManager = initInputManager(bus);
    
    // Connect input manager to renderer for pause/resume coordination
    inputManager.setPromptCallbacks(
        () => renderer.pauseForInput(),
        () => renderer.resumeAfterInput()
    );

    // Set auto-approve if -y flag
    if (options.yes) {
        inputManager.setApproveAll(true);
    }

    return {
        bus,
        policy,
        tools,
        diffEngine,
        indexer,
        verilator,
        renderer,
        inputManager,
        options,
        projectRoot,
        toolRegistry,
        contextFileManager,
        terminalSessionManager,
        sessionId,
        // Unified memory service
        memoryService,
        // Phase 2: Context Window Management
        dynamicContextManager,
        tokenBudgetManager,
        fileChunker,
        skillManager,
        toolDescriptionManager,
        semanticSummarizer
    };
}

/**
 * Build ToolContext from CommandContext
 */
function buildToolContext(ctx: CommandContext): ToolContext {
    return {
        bus: ctx.bus,
        policy: ctx.policy,
        fileTools: ctx.tools.file,
        editTools: ctx.tools.edit,
        indexer: ctx.indexer,
        diffEngine: ctx.diffEngine,
        verilator: ctx.verilator,
        projectRoot: ctx.projectRoot,
        dryRun: ctx.options.dryRun,
        autoApprove: ctx.options.yes,
        // Dynamic context discovery
        toolRegistry: ctx.toolRegistry,
        contextFileManager: ctx.contextFileManager,
        terminalSessionManager: ctx.terminalSessionManager,
        sessionId: ctx.sessionId,
        // Memory service and its accessors for backward compatibility with tool executors
        memoryService: ctx.memoryService,
        memoryManager: ctx.memoryService.memory,
        knowledgeStore: ctx.memoryService.knowledge,
        // Centralized input manager
        inputManager: ctx.inputManager,
        // Phase 2: Context Window Management (Cursor's Dynamic Context Discovery)
        dynamicContextManager: ctx.dynamicContextManager,
        tokenBudgetManager: ctx.tokenBudgetManager,
        fileChunker: ctx.fileChunker,
        skillManager: ctx.skillManager,
        toolDescriptionManager: ctx.toolDescriptionManager,
        semanticSummarizer: ctx.semanticSummarizer
    };
}

// ============================================================================
// Chat Command (REPL)
// ============================================================================

export async function chatCommand(
    ctx: CommandContext,
    initialQuery?: string
): Promise<ExitCode> {
    const toolContext = buildToolContext(ctx);

    // Create agent
    const agent = new GateFlowAgent(ctx.bus, toolContext);

    // Build project index first (blocking)
    ctx.bus.emit({
        type: 'status',
        phase: 'indexing',
        label: 'Building project index...'
    });

    let indexingFailed = false;
    try {
        await ctx.indexer.buildIndex();
    } catch (error) {
        indexingFailed = true;
        ctx.bus.emit({
            type: 'error',
            message: `Indexing failed: ${error}`
        });
    }

    const stats = ctx.indexer.getStats();
    if (indexingFailed) {
        agent.addContext('Warning: Project indexing failed. Some features may not work correctly.');
    } else {
        agent.addContext(`Project indexed: ${stats.modules} modules, ${stats.packages} packages in ${stats.files} files.`);
    }

    // Stop status
    ctx.bus.emit({ type: 'token_done' });

    console.log('\n' + chalk.blue.bold('GateFlow') + ' - AI-powered SystemVerilog Assistant');
    if (indexingFailed) {
        console.log(chalk.yellow('   Warning: Indexing failed. Some features may be limited.'));
    } else {
        console.log(`   Indexed ${stats.modules} modules in ${stats.files} files.`);
    }

    // Handle initial query if provided, then continue to REPL
    if (initialQuery) {
        console.log(chalk.dim(`\n> ${initialQuery}\n`));
        try {
            await agent.run(initialQuery);
        } catch (error) {
            ctx.bus.emit({
                type: 'error',
                message: String(error)
            });
        }
        console.log('');
    }
    console.log('   Type your questions or commands. Type "exit" to quit.\n');

    // Use centralized InputManager for REPL
    const { inputManager } = ctx;
    let running = true;

    while (running) {
        const border = chalk.blue('─'.repeat(60));
        console.log(border);

        try {
            const input = await inputManager.getLine(chalk.blue('> '));
            console.log(border);
            console.log('');
            
            const trimmed = input.trim();

            if (!trimmed) {
                continue;
            }

            if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
                running = false;
                break;
            }

            if (trimmed.toLowerCase() === '/clear') {
                agent.resetSession();
                console.log('Session cleared.\n');
                continue;
            }

            if (trimmed.toLowerCase() === '/stats') {
                const sessionStats = agent.getSessionStats();
                const indexStats = ctx.indexer.getStats();
                console.log('\nSession:', sessionStats);
                console.log('Index:', indexStats);
                console.log('');
                continue;
            }

            // Check if waiting for approval
            if (ctx.renderer.isWaitingForApproval()) {
                ctx.renderer.processApprovalInput(trimmed);
                continue;
            }

            await agent.run(trimmed);
            console.log('');
        } catch (error) {
            ctx.bus.emit({
                type: 'error',
                message: String(error)
            });
        }
    }

    inputManager.close();
    return ExitCodes.SUCCESS;
}

// ============================================================================
// Scan Command
// ============================================================================

export async function scanCommand(ctx: CommandContext): Promise<ExitCode> {
    try {
        await ctx.indexer.buildIndex();
        const stats = ctx.indexer.getStats();

        if (ctx.options.json) {
            console.log(JSON.stringify(ctx.indexer.export()));
        } else {
            console.log('\n' + chalk.blue.bold('Project Index Summary'));
            console.log(`   Files: ${stats.files}`);
            console.log(`   Modules: ${stats.modules}`);
            console.log(`   Packages: ${stats.packages}`);
            console.log(`   Interfaces: ${stats.interfaces}`);
            console.log('');
        }

        return ExitCodes.SUCCESS;
    } catch (error) {
        ctx.bus.emit({
            type: 'error',
            message: `Scan failed: ${error}`
        });
        return ExitCodes.TOOL_ERROR;
    }
}

// ============================================================================
// Lint Command
// ============================================================================

export async function lintCommand(
    ctx: CommandContext,
    files: string[]
): Promise<ExitCode> {
    // If no files specified, find all SV files
    if (files.length === 0) {
        const scanResult = await ctx.tools.file.scanProject(ctx.projectRoot);
        files = scanResult.files
            .filter(f => f.type === 'module' || f.type === 'testbench')
            .map(f => f.path);
    }

    let hasErrors = false;
    const results: { file: string; errors: number; warnings: number }[] = [];

    for (const file of files) {
        const result = await ctx.verilator.lint(file);
        
        results.push({
            file,
            errors: result.errors.length,
            warnings: result.warnings.length
        });

        if (!ctx.options.json) {
            // Display errors
            for (const err of result.errors) {
                console.log(chalk.red(`${err.file}:${err.line}: error: ${err.message}`));
            }
            // Display warnings
            for (const warn of result.warnings) {
                console.log(chalk.yellow(`${warn.file}:${warn.line}: warning: ${warn.message}`));
            }
        }

        if (!result.success) {
            hasErrors = true;
        }
    }

    if (ctx.options.json) {
        console.log(JSON.stringify(results));
    }

    return hasErrors ? ExitCodes.LINT_FAILED : ExitCodes.SUCCESS;
}

// ============================================================================
// Fix Command
// ============================================================================

export async function fixCommand(
    ctx: CommandContext,
    file: string
): Promise<ExitCode> {
    const toolContext = buildToolContext(ctx);
    const agent = new GateFlowAgent(ctx.bus, toolContext);

    // Pass KnowledgeStore for auto-load/persist of fix patterns
    const fixLoop = new FixLoop(
        ctx.bus,
        ctx.verilator,
        agent,
        ctx.tools.file,
        { requireApproval: !ctx.options.yes },
        ctx.memoryService.knowledge
    );

    // Initialize with historical patterns (auto-persist happens in run())
    await fixLoop.init(file);

    const result = await fixLoop.run(file);

    if (ctx.options.json) {
        console.log(JSON.stringify(result));
    }

    return result.success ? ExitCodes.SUCCESS : ExitCodes.LINT_FAILED;
}

// ============================================================================
// Watch Command - Knowledge Callback Setup
// ============================================================================

/**
 * Configure WatchManager to update active context on file changes
 *
 * When files are re-indexed, this callback updates the active context IDs
 * so that KnowledgeService queries reflect the current project state.
 *
 * NOTE: We no longer call extractFromIndex for structural data here because
 * KnowledgeService now queries the indexer directly for structural knowledge.
 * The WatchManager already handles re-indexing files when they change.
 *
 * @private
 */
function setupKnowledgeUpdateCallback(
    ctx: CommandContext,
    watcher: WatchManager
): void {
    // Check if memory service is available
    if (!ctx.memoryService) {
        return;  // No memory service, skip context updates
    }

    watcher.setKnowledgeUpdateCallback(async (filepath, _changeType) => {
        try {
            // Get the updated project from indexer
            const project = ctx.indexer.getProject();
            if (!project) {
                return;
            }

            // Update the active context IDs so KnowledgeService queries
            // use the correct define context and compile order
            if (project.defineContextId) {
                ctx.memoryService.setActiveContext(
                    project.defineContextId,
                    project.compileOrderId
                );
            }

            // Emit success event - structural knowledge is now queried live from indexer
            // via KnowledgeService, so no extraction needed
            ctx.bus.emit({
                type: 'tool_result',
                tool: 'knowledge_update',
                ok: true,
                summary: `Index updated for ${path.basename(filepath)}`
            });

        } catch (error) {
            // Non-fatal - just log
            console.warn(
                '[watchCommand] Context update failed:',
                error instanceof Error ? error.message : error
            );
        }
    });
}

// ============================================================================
// Watch Command
// ============================================================================

export async function watchCommand(
    ctx: CommandContext,
    patterns: string[]
): Promise<ExitCode> {
    const watchConfig = patterns.length > 0 ? { patterns } : undefined;

    const watcher = new WatchManager(
        ctx.projectRoot,
        ctx.bus,
        ctx.indexer,
        ctx.verilator,
        watchConfig
    );

    // Set up knowledge update callback for memory synchronization
    setupKnowledgeUpdateCallback(ctx, watcher);

    watcher.start();

    console.log('\n' + chalk.blue.bold('Watching for changes. Press Ctrl+C to stop.\n'));

    // Keep running until interrupted
    return new Promise((resolve) => {
        const cleanup = async () => {
            console.log('\n\nStopping watch...');
            await watcher.stop();
            resolve(ExitCodes.SUCCESS);
        };

        // Use 'once' to avoid handler leak, handle both SIGINT and SIGTERM
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
    });
}

// ============================================================================
// Generate Command
// ============================================================================

export async function generateCommand(
    ctx: CommandContext,
    type: 'module' | 'testbench' | 'package',
    name: string,
    options: { output?: string }
): Promise<ExitCode> {
    const toolContext = buildToolContext(ctx);
    const agent = new GateFlowAgent(ctx.bus, toolContext);

    // Build generation prompt and select mode
    const outputPath = options.output ?? `${name}.sv`;
    let prompt: string;
    let mode: PromptMode;

    switch (type) {
        case 'module':
            mode = 'generate';
            prompt = `Create a new SystemVerilog module named "${name}" and save it to "${outputPath}".

Requirements:
- Proper module declaration with explicit port types
- Clock (clk) and reset (rst) inputs
- Example internal logic demonstrating always_ff and always_comb
- Proper reset handling in sequential logic
- Inline comments explaining the module purpose and key signals`;
            break;

        case 'testbench':
            mode = 'testbench';
            prompt = `Create a testbench for module "${name}" and save it to "tb_${name}.sv".

Requirements:
- Read the DUT module first to understand its interface
- Instantiate DUT with explicit port connections
- Clock generation (~100MHz, 10ns period)
- Reset sequence (assert for 2+ cycles)
- Directed test stimulus covering basic functionality
- $display statements for monitoring
- $dumpfile/$dumpvars for waveform capture
- $finish at the end`;
            break;

        case 'package':
            mode = 'generate';
            prompt = `Create a SystemVerilog package named "${name}_pkg" and save it to "${name}_pkg.sv".

Requirements:
- Package declaration with proper naming
- Example typedefs (e.g., state_t enum, data structs)
- Example parameters/localparams for common constants
- Example utility function or task
- Comments describing intended usage`;
            break;
    }

    try {
        await agent.run(prompt, { mode });
        return ExitCodes.SUCCESS;
    } catch (error) {
        ctx.bus.emit({
            type: 'error',
            message: String(error)
        });
        return ExitCodes.TOOL_ERROR;
    }
}

// ============================================================================
// Setup Command
// ============================================================================

export async function setupCommand(ctx: CommandContext, tools?: string[]): Promise<ExitCode> {
    const { runToolSetupFlow } = await import('../indexer/setup/setup-flow.js');

    // Determine which tools to set up
    const toolsToSetup: ('verible' | 'slang')[] = [];
    if (!tools || tools.length === 0) {
        toolsToSetup.push('verible', 'slang');
    } else {
        for (const tool of tools) {
            if (tool === 'verible' || tool === 'slang') {
                toolsToSetup.push(tool);
            } else {
                console.error(chalk.red(`Unknown tool: ${tool}. Valid options: verible, slang`));
                return ExitCodes.CONFIG_ERROR;
            }
        }
    }

    console.log('\n' + chalk.blue.bold('SystemVerilog Tool Setup'));
    console.log(chalk.dim('   Setting up: ' + toolsToSetup.join(', ') + '\n'));

    try {
        const result = await runToolSetupFlow(
            ctx.bus,
            ctx.policy,
            ctx.projectRoot,
            { interactive: true, tools: toolsToSetup }
        );

        if (result.success) {
            console.log('\n' + chalk.green.bold('Setup Complete'));

            if (result.tools.verible) {
                const v = result.tools.verible;
                const status = v.action === 'installed' || v.action === 'existing'
                    ? chalk.green('✓') : chalk.yellow('○');
                console.log(`   ${status} Verible: ${v.action}${v.version ? ` (${v.version})` : ''}`);
            }

            if (result.tools.slang) {
                const s = result.tools.slang;
                const status = s.action === 'built' || s.action === 'existing'
                    ? chalk.green('✓') : chalk.yellow('○');
                console.log(`   ${status} Slang: ${s.action}${s.version ? ` (${s.version})` : ''}`);
            }

            console.log('');
            return ExitCodes.SUCCESS;
        } else {
            console.error(chalk.red('\nSetup failed: ' + (result.error || 'Unknown error')));
            return ExitCodes.TOOL_ERROR;
        }
    } catch (error) {
        console.error(chalk.red('\nSetup error: ' + String(error)));
        return ExitCodes.TOOL_ERROR;
    }
}

// ============================================================================
// Doctor Command
// ============================================================================

export async function doctorCommand(ctx: CommandContext): Promise<ExitCode> {
    console.log('\n' + chalk.blue.bold('GateFlow Environment Check\n'));

    const checks: { name: string; status: 'ok' | 'warn' | 'fail'; message: string }[] = [];

    // Check Verilator
    const verilatorCheck = await ctx.verilator.checkInstallation();
    checks.push({
        name: 'Verilator',
        status: verilatorCheck.installed ? 'ok' : 'fail',
        message: verilatorCheck.installed
            ? `v${verilatorCheck.version} at ${verilatorCheck.path}`
            : `Not found: ${verilatorCheck.error}`
    });

    // Check ANTHROPIC_API_KEY
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    checks.push({
        name: 'ANTHROPIC_API_KEY',
        status: hasApiKey ? 'ok' : 'fail',
        message: hasApiKey ? 'Set' : 'Not set - required for AI features'
    });

    // Check project root
    const hasProject = await ctx.tools.file.exists(ctx.projectRoot);
    checks.push({
        name: 'Project Root',
        status: hasProject ? 'ok' : 'warn',
        message: ctx.projectRoot
    });

    // Check for SV files
    const scanResult = await ctx.tools.file.scanProject(ctx.projectRoot);
    checks.push({
        name: 'SystemVerilog Files',
        status: scanResult.summary.totalFiles > 0 ? 'ok' : 'warn',
        message: `${scanResult.summary.totalFiles} files found`
    });

    // Check Git
    const isGit = await ctx.diffEngine.checkGitRepo();
    checks.push({
        name: 'Git Repository',
        status: isGit ? 'ok' : 'warn',
        message: isGit ? 'Yes' : 'No (git apply unavailable)'
    });

    // Output results
    for (const check of checks) {
        const statusIcon = check.status === 'ok' ? chalk.blue('✓') : check.status === 'warn' ? chalk.yellow('!') : chalk.red('✗');
        console.log(`${statusIcon} ${check.name}: ${check.message}`);
    }

    console.log('');

    const hasFails = checks.some(c => c.status === 'fail');
    return hasFails ? ExitCodes.CONFIG_ERROR : ExitCodes.SUCCESS;
}

// ============================================================================
// Version Command
// ============================================================================

export async function versionCommand(): Promise<ExitCode> {
    // Read package.json
    try {
        const { fileURLToPath } = await import('url');
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const pkgPath = path.join(currentDir, '../../package.json');
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        console.log(`gateflow v${pkg.version}`);
    } catch {
        console.log('gateflow v1.0.0');
    }
    return ExitCodes.SUCCESS;
}

// ============================================================================
// Wave Command
// ============================================================================

export async function waveCommand(ctx: CommandContext, vcdPath: string): Promise<ExitCode> {
    const { spawn } = await import('child_process');
    const { fileURLToPath } = await import('url');

    // Resolve path
    const resolvedPath = path.isAbsolute(vcdPath)
        ? vcdPath
        : path.join(ctx.projectRoot, vcdPath);

    // Check file exists
    try {
        await fs.access(resolvedPath);
    } catch {
        console.error(chalk.red(`File not found: ${resolvedPath}`));
        return ExitCodes.TOOL_ERROR;
    }

    // Check file extension
    if (!resolvedPath.endsWith('.vcd')) {
        console.log(chalk.yellow('Warning: File does not have .vcd extension'));
    }

    console.log(chalk.cyan(`Opening waveform viewer: ${resolvedPath}`));
    console.log(chalk.dim('Press q to quit\n'));

    // Check if we're in an interactive terminal
    if (process.stdin.isTTY) {
        // Direct mode - use viewer in current terminal
        const { WaveformViewer } = await import('../waveform/index.js');
        const viewer = new WaveformViewer();

        try {
            await viewer.open(resolvedPath);
            return ExitCodes.SUCCESS;
        } catch (error) {
            console.error(chalk.red(`Failed to open waveform: ${error}`));
            return ExitCodes.TOOL_ERROR;
        }
    } else {
        // Non-TTY mode - spawn new terminal window
        const cliPath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            'main.js'
        );

        console.log(chalk.yellow('Not in interactive terminal - opening in new window...'));

        return new Promise((resolve) => {
            (async () => {
                let child: ReturnType<typeof spawn> | undefined;

                if (process.platform === 'win32') {
                    // Windows: open new cmd window that stays open
                    // Use array args to avoid shell injection - each arg is passed separately
                    child = spawn('cmd', [
                        '/c', 'start', '', 'cmd', '/k',
                        'node', cliPath, 'wave', resolvedPath
                    ], {
                        detached: true,
                        stdio: 'ignore'
                    });
                } else if (process.platform === 'darwin') {
                    // macOS: open new Terminal window
                    // SECURITY: Validate paths to prevent shell/AppleScript injection
                    // Only allow safe characters in paths
                    const safePathRegex = /^[a-zA-Z0-9\-_./\\: ]+$/;
                    if (!safePathRegex.test(cliPath) || !safePathRegex.test(resolvedPath)) {
                        console.error(chalk.red('Invalid characters in file path.'));
                        resolve(ExitCodes.TOOL_ERROR);
                        return;
                    }
                    // Escape for AppleScript: backslash, double quote, dollar sign, backtick, newline
                    const escapeAppleScript = (s: string) =>
                        s.replace(/\\/g, '\\\\')
                         .replace(/"/g, '\\"')
                         .replace(/\$/g, '\\$')
                         .replace(/`/g, '\\`')
                         .replace(/\n/g, '');
                    const safeCliPath = escapeAppleScript(cliPath);
                    const safeResolvedPath = escapeAppleScript(resolvedPath);
                    child = spawn('osascript', ['-e',
                        `tell app "Terminal" to do script "node \\"${safeCliPath}\\" wave \\"${safeResolvedPath}\\""`
                    ], {
                        detached: true,
                        stdio: 'ignore'
                    });
                } else {
                    // Linux: try common terminal emulators
                    const terminals = ['gnome-terminal', 'xterm', 'konsole'];
                    for (const term of terminals) {
                        child = spawn(term, ['--', 'node', cliPath, 'wave', resolvedPath], {
                            detached: true,
                            stdio: 'ignore'
                        });
                        // Check if spawn succeeded by waiting briefly for error event
                        const spawnError = await new Promise<Error | null>((res) => {
                            child!.once('error', (err) => res(err));
                            setTimeout(() => res(null), 100);
                        });
                        if (!spawnError) {
                            break; // Terminal found and spawned successfully
                        }
                        child = undefined; // Reset and try next terminal
                    }
                }

                if (child) {
                    child.unref();
                    console.log(chalk.green('Waveform viewer opened in new terminal window.'));
                    resolve(ExitCodes.SUCCESS);
                } else {
                    console.error(chalk.red('Could not open terminal window.'));
                    console.log(chalk.dim(`Run manually: node "${cliPath}" wave "${resolvedPath}"`));
                    resolve(ExitCodes.TOOL_ERROR);
                }
            })();
        });
    }
}

// ============================================================================
// Wave Web Command - Browser-based viewer
// ============================================================================

export async function waveWebCommand(ctx: CommandContext, vcdPath: string, port: number = 3000): Promise<ExitCode> {
    const { spawn } = await import('child_process');

    // Resolve path
    const resolvedPath = path.isAbsolute(vcdPath)
        ? vcdPath
        : path.join(ctx.projectRoot, vcdPath);

    // Check file exists
    try {
        await fs.access(resolvedPath);
    } catch {
        console.error(chalk.red(`File not found: ${resolvedPath}`));
        return ExitCodes.TOOL_ERROR;
    }

    console.log(chalk.cyan(`Starting waveform web viewer...`));
    console.log(chalk.dim(`Loading: ${resolvedPath}\n`));

    try {
        const { startStandaloneServer } = await import('../waveform/web/index.js');

        // Start server
        await startStandaloneServer({
            port,
            vcdPath: resolvedPath
        });

        const url = `http://localhost:${port}`;

        // SECURITY: Validate URL format before passing to shell
        if (!/^https?:\/\/localhost:\d+$/.test(url)) {
            console.error(chalk.red('Invalid URL generated'));
            return ExitCodes.TOOL_ERROR;
        }

        console.log(chalk.green(`\nViewer running at: ${chalk.bold(url)}`));
        console.log(chalk.dim('Press Ctrl+C to stop\n'));

        // Open browser
        let openCmd: string;
        let openArgs: string[];

        if (process.platform === 'win32') {
            openCmd = 'cmd';
            openArgs = ['/c', 'start', url];
        } else if (process.platform === 'darwin') {
            openCmd = 'open';
            openArgs = [url];
        } else {
            openCmd = 'xdg-open';
            openArgs = [url];
        }

        const child = spawn(openCmd, openArgs, {
            detached: true,
            stdio: 'ignore'
        });

        child.once('error', (err) => {
            console.error(chalk.yellow(`Failed to open browser: ${err.message}`));
            console.log(chalk.dim(`Open manually: ${url}`));
        });

        // Small delay before unref to catch immediate spawn errors
        setTimeout(() => child.unref(), 100);

        // Keep process running until interrupted
        await new Promise<void>((resolve) => {
            process.once('SIGINT', () => {
                console.log('\nShutting down...');
                resolve();
            });
            process.once('SIGTERM', () => {
                resolve();
            });
        });

        return ExitCodes.SUCCESS;

    } catch (error) {
        console.error(chalk.red(`Failed to start viewer: ${error}`));
        return ExitCodes.TOOL_ERROR;
    }
}

