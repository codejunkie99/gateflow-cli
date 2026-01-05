/**
 * CLI Commands
 * Command implementations for GateFlow CLI
 */

import path from 'path';
import fs from 'fs/promises';
import readline from 'readline';
import chalk from 'chalk';
import { EventBus, ExitCodes, type ExitCode } from '../events/index.js';
import { PolicyEngine, initPolicyEngine } from '../approval/index.js';
import { FileTools, EditTools, createTools } from '../fileops/index.js';
import { DiffEngine } from '../diff/index.js';
import { ProjectIndexer } from '../indexer/index.js';
import { GateFlowAgent, type ToolContext, type PromptMode } from '../agent/index.js';
import { Verilator } from '../verification/index.js';
import { FixLoop } from '../verification/fix-loop.js';
import { WatchManager } from '../watch/index.js';
import { TerminalRenderer, createRenderer } from '../ui/index.js';

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
    indexer: ProjectIndexer;
    verilator: Verilator;
    renderer: TerminalRenderer;
    options: GlobalOptions;
    projectRoot: string;
}

// ============================================================================
// Context Setup
// ============================================================================

/**
 * Detect the project root by looking for common markers
 * Prefers directories with .sv files or HDL project markers
 */
async function detectProjectRoot(startDir: string): Promise<string> {
    let dir = path.resolve(startDir);
    
    // If we're in a 'cli' subdirectory, always go up to parent
    if (path.basename(dir) === 'cli') {
        const parent = path.dirname(dir);
        // Check if parent has HDL-related directories or .sv files
        const hdlMarkers = ['rtl', 'tb', 'src', '.git'];
        for (const marker of hdlMarkers) {
            try {
                await fs.access(path.join(parent, marker));
                console.log(`  Project root: ${parent}`);
                return parent;
            } catch {}
        }
        // Also check for .sv files directly in parent
        try {
            const files = await fs.readdir(parent);
            if (files.some(f => f.endsWith('.sv'))) {
                console.log(`  Project root: ${parent}`);
                return parent;
            }
        } catch {}
    }
    
    return dir;
}

export async function setupContext(options: GlobalOptions): Promise<CommandContext> {
    const projectRoot = await detectProjectRoot(options.cwd);
    
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

    // Create indexer
    const indexer = new ProjectIndexer(projectRoot, bus);

    // Create Verilator instance (use VERILATOR_PATH env var if set)
    const verilatorPath = process.env.VERILATOR_PATH;
    const verilator = new Verilator(bus, verilatorPath ? { binary: verilatorPath } : undefined);

    return {
        bus,
        policy,
        tools,
        diffEngine,
        indexer,
        verilator,
        renderer,
        options,
        projectRoot
    };
}

// ============================================================================
// Chat Command (REPL)
// ============================================================================

export async function chatCommand(
    ctx: CommandContext,
    initialQuery?: string
): Promise<ExitCode> {
    // Build tool context
    const toolContext: ToolContext = {
        bus: ctx.bus,
        policy: ctx.policy,
        fileTools: ctx.tools.file,
        editTools: ctx.tools.edit,
        indexer: ctx.indexer,
        diffEngine: ctx.diffEngine,
        verilator: ctx.verilator,
        projectRoot: ctx.projectRoot,
        dryRun: ctx.options.dryRun,
        autoApprove: ctx.options.yes
    };

    // Create agent
    const agent = new GateFlowAgent(ctx.bus, toolContext);

    // Build project index first (blocking)
    ctx.bus.emit({
        type: 'status',
        phase: 'indexing',
        label: 'Building project index...'
    });

    try {
        await ctx.indexer.buildIndex();
    } catch (error) {
        console.error('Indexing failed:', error);
    }
    
    const stats = ctx.indexer.getStats();
    agent.addContext(`Project indexed: ${stats.modules} modules, ${stats.packages} packages in ${stats.files} files.`);
    
    // Stop spinner
    ctx.bus.emit({ type: 'token_done' });

    // Handle initial query if provided (non-interactive mode)
    if (initialQuery) {
        try {
            // Try to detect mode from initial query context if possible
            // For now, we rely on the query text, but we could add CLI flags later
            await agent.run(initialQuery);
            return ExitCodes.SUCCESS;
        } catch (error) {
            ctx.bus.emit({
                type: 'error',
                message: String(error)
            });
            return ExitCodes.TOOL_ERROR;
        }
    }

    // Interactive REPL
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\n' + chalk.blue.bold('GateFlow') + ' - AI-powered SystemVerilog Assistant');
    console.log(`   Indexed ${stats.modules} modules in ${stats.files} files.`);
    console.log('   Type your questions or commands. Type "exit" to quit.\n');

    const promptUser = () => {
        // Simple prompt with dotted border
        const border = chalk.blue('─'.repeat(60));
        console.log(border);
        rl.question(chalk.blue('> '), async (input) => {
            console.log(border);
            console.log('');
            const trimmed = input.trim();

            if (!trimmed) {
                promptUser();
                return;
            }

            if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
                rl.close();
                return;
            }

            if (trimmed.toLowerCase() === '/clear') {
                agent.resetSession();
                console.log('Session cleared.\n');
                promptUser();
                return;
            }

            if (trimmed.toLowerCase() === '/stats') {
                const sessionStats = agent.getSessionStats();
                const indexStats = ctx.indexer.getStats();
                console.log('\nSession:', sessionStats);
                console.log('Index:', indexStats);
                console.log('');
                promptUser();
                return;
            }

            // Check if waiting for approval
            if (ctx.renderer.isWaitingForApproval()) {
                ctx.renderer.processApprovalInput(trimmed);
                promptUser();
                return;
            }

            try {
                await agent.run(trimmed);
            } catch (error) {
                ctx.bus.emit({
                    type: 'error',
                    message: String(error)
                });
            }

            console.log('');
            promptUser();
        });
    };

    promptUser();

    return new Promise((resolve) => {
        rl.on('close', () => {
            resolve(ExitCodes.SUCCESS);
        });
    });
}

// ============================================================================
// Scan Command
// ============================================================================

export async function scanCommand(ctx: CommandContext): Promise<ExitCode> {
    try {
        const index = await ctx.indexer.buildIndex();
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

        if (!result.success) {
            hasErrors = true;

            if (!ctx.options.json) {
                for (const err of result.errors) {
                    console.log(`${err.file}:${err.line}: error: ${err.message}`);
                }
            }
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
    // Build tool context
    const toolContext: ToolContext = {
        bus: ctx.bus,
        policy: ctx.policy,
        fileTools: ctx.tools.file,
        editTools: ctx.tools.edit,
        indexer: ctx.indexer,
        diffEngine: ctx.diffEngine,
        verilator: ctx.verilator,
        projectRoot: ctx.projectRoot,
        dryRun: ctx.options.dryRun,
        autoApprove: ctx.options.yes
    };

    const agent = new GateFlowAgent(ctx.bus, toolContext);
    const fixLoop = new FixLoop(ctx.bus, ctx.verilator, agent, ctx.tools.file, {
        requireApproval: !ctx.options.yes
    });

    const result = await fixLoop.run(file);

    if (ctx.options.json) {
        console.log(JSON.stringify(result));
    }

    return result.success ? ExitCodes.SUCCESS : ExitCodes.LINT_FAILED;
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

    watcher.start();

    console.log('\n' + chalk.blue.bold('Watching for changes. Press Ctrl+C to stop.\n'));

    // Keep running until interrupted
    return new Promise((resolve) => {
        process.on('SIGINT', async () => {
            console.log('\n\nStopping watch...');
            await watcher.stop();
            resolve(ExitCodes.SUCCESS);
        });
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
    // Build tool context
    const toolContext: ToolContext = {
        bus: ctx.bus,
        policy: ctx.policy,
        fileTools: ctx.tools.file,
        editTools: ctx.tools.edit,
        indexer: ctx.indexer,
        diffEngine: ctx.diffEngine,
        verilator: ctx.verilator,
        projectRoot: ctx.projectRoot,
        dryRun: ctx.options.dryRun,
        autoApprove: ctx.options.yes
    };

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
        const pkgPath = path.join(__dirname, '../../package.json');
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        console.log(`gateflow v${pkg.version}`);
    } catch {
        console.log('gateflow v1.0.0');
    }
    return ExitCodes.SUCCESS;
}

