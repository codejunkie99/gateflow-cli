#!/usr/bin/env node

/**
 * GateFlow CLI
 * AI-powered SystemVerilog development assistant
 */

import '../env/bootstrap-env.js';
import { Command } from 'commander';
import { ExitCodes } from '../events/index.js';
import {
    setupContext,
    chatCommand,
    scanCommand,
    lintCommand,
    fixCommand,
    watchCommand,
    generateCommand,
    doctorCommand,
    setupCommand,
    versionCommand,
    waveCommand,
    waveWebCommand,
    getCurrentContext,
    type GlobalOptions
} from './commands.js';
import { startMCPServer } from '../waveform/mcp-server.js';

import { hasAnyProvider, PROVIDERS } from '../agent/model-provider.js';

// ============================================================================
// Global Shutdown Handler (Issue #15 fix)
// ============================================================================

let isShuttingDown = false;

/**
 * Clean up all resources gracefully
 */
async function gracefulShutdown(exitCode: number = 0): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    // Give a brief moment for any pending I/O
    await new Promise(resolve => setTimeout(resolve, 50));

    const currentContext = getCurrentContext();
    if (currentContext) {
        try {
            // Stop renderer (unsubscribes from bus, clears timers)
            currentContext.renderer?.stop();

            // Close input manager (closes readline)
            currentContext.inputManager?.close();

            // Shutdown memory service (flushes pending saves)
            await currentContext.memoryService?.shutdown();

            // Clear event bus (removes all listeners, clears pending approvals)
            currentContext.bus?.clear();
        } catch {
            // Ignore errors during shutdown
        }
    }

    process.exit(exitCode);
}

// Register global signal handlers
process.on('SIGINT', () => gracefulShutdown(0));
process.on('SIGTERM', () => gracefulShutdown(0));

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
    console.error('\nUncaught exception:', error.message);
    gracefulShutdown(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('\nUnhandled rejection:', reason);
    gracefulShutdown(1);
});

/**
 * Validate required environment variables
 * Returns list of missing required vars
 */
function validateEnvVars(): { missing: string[]; warnings: string[] } {
    const missing: string[] = [];
    const warnings: string[] = [];

    // Check for at least one AI provider API key
    if (!hasAnyProvider()) {
        const providerList = Object.entries(PROVIDERS)
            .map(([_, info]) => `  - ${info.envVar} (${info.name})`)
            .join('\n');
        missing.push(`At least one AI provider API key:\n${providerList}`);
    }

    // Optional but recommended
    if (!process.env.VERILATOR_PATH) {
        warnings.push('VERILATOR_PATH not set - will use system PATH');
    }

    return { missing, warnings };
}

// Validate env vars early
const envValidation = validateEnvVars();

// ============================================================================
// Banner
// ============================================================================

import chalk from 'chalk';

const BANNER = `
${chalk.blue.bold('  ██████╗  █████╗ ████████╗███████╗███████╗██╗      ██████╗ ██╗    ██╗')}
${chalk.blue.bold(' ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██╔════╝██║     ██╔═══██╗██║    ██║')}
${chalk.blue.bold(' ██║  ███╗███████║   ██║   █████╗  █████╗  ██║     ██║   ██║██║ █╗ ██║')}
${chalk.blue.bold(' ██║   ██║██╔══██║   ██║   ██╔══╝  ██╔══╝  ██║     ██║   ██║██║███╗██║')}
${chalk.blue.bold(' ╚██████╔╝██║  ██║   ██║   ███████╗██║     ███████╗╚██████╔╝╚███╔███╔╝')}
${chalk.blue.bold('  ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝')}
${chalk.cyan('                Founded & Built by Avidlive (Av1dlive) ')}
${chalk.cyan('             Founding Contributor - Manas (Menace_thakur) ')}
${chalk.cyan('                AI-powered SystemVerilog Assistant')}
`;

// ============================================================================
// CLI Program
// ============================================================================

const program = new Command();

program
    .name('gateflow')
    .description('AI-powered SystemVerilog development assistant')
    .version('1.0.0')
    .option('-y, --yes', 'Auto-approve all changes without prompting', false)
    .option('-n, --dry-run', 'Preview changes without applying them', false)
    .option('--json', 'Output results as JSON', false)
    .option('-v, --verbose', 'Enable verbose output', false)
    .option('-C, --cwd <path>', 'Set working directory', process.cwd())
    .option('-m, --model <spec>', 'Model to use (format: provider/model, e.g., openai/gpt-4o)')
    .hook('preAction', (thisCommand) => {
        const opts = program.opts();

        // MCP command needs clean stdin/stdout for JSON-RPC protocol
        // Check both the command name and raw args (for when preAction fires with program)
        const commandName = thisCommand.name();
        const isMcpCommand = commandName === 'mcp' || process.argv.includes('mcp');

        // Show banner unless JSON mode or MCP mode
        if (!opts.json && !isMcpCommand) {
            console.log(BANNER);
        }

        // Show env var warnings (unless JSON mode or MCP mode)
        if (!opts.json && !isMcpCommand && envValidation.warnings.length > 0) {
            for (const warning of envValidation.warnings) {
                console.log(chalk.yellow(`⚠ ${warning}`));
            }
        }

        // Check for missing required env vars (skip for non-AI commands)
        const aiCommands = ['chat', 'fix', 'gen'];
        const isAiCommand = aiCommands.includes(commandName) || thisCommand.args.length > 0;

        if (isAiCommand && envValidation.missing.length > 0) {
            if (opts.json) {
                console.log(JSON.stringify({
                    error: 'Missing required environment variables',
                    missing: envValidation.missing
                }));
            } else {
                console.error(chalk.red('\n✖ Missing required environment variables:'));
                for (const varName of envValidation.missing) {
                    console.error(chalk.red(`  - ${varName}`));
                }
                console.error(chalk.dim('\nSet these in your .env file or environment.\n'));
            }
            process.exit(ExitCodes.CONFIG_ERROR);
        }
    });

// ============================================================================
// Chat Command (default)
// ============================================================================

program
    .command('chat [query...]')
    .description('Start interactive chat session (or run a single query)')
    .option('-m, --model <spec>', 'Model to use (format: provider/model)')
    .action(async (queryParts: string[], cmdOpts: { model?: string }) => {
        const opts = program.opts() as GlobalOptions & { model?: string };
        const ctx = await setupContext(opts);

        const query = queryParts.length > 0 ? queryParts.join(' ') : undefined;
        const modelSpec = cmdOpts.model || opts.model; // Command option takes precedence
        const exitCode = await chatCommand(ctx, query, modelSpec);

        await gracefulShutdown(exitCode);
    });

// Make chat the default command
program
    .argument('[query...]', 'Query to send to the assistant')
    .action(async (queryParts: string[]) => {
        const opts = program.opts() as GlobalOptions & { model?: string };
        const ctx = await setupContext(opts);

        const query = queryParts.length > 0 ? queryParts.join(' ') : undefined;
        const exitCode = await chatCommand(ctx, query, opts.model);

        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Scan Command
// ============================================================================

program
    .command('scan')
    .description('Scan and index the project')
    .action(async () => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await scanCommand(ctx);
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Lint Command
// ============================================================================

program
    .command('lint [files...]')
    .description('Run Verilator lint on files (or all files if none specified)')
    .action(async (files: string[]) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await lintCommand(ctx, files);
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Fix Command
// ============================================================================

program
    .command('fix <file>')
    .description('Auto-fix lint errors in a file using AI')
    .option('-m, --model <spec>', 'Model to use (format: provider/model)')
    .action(async (file: string, cmdOpts: { model?: string }) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const modelSpec = cmdOpts.model || opts.model;
        const exitCode = await fixCommand(ctx, file, modelSpec);
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Watch Command
// ============================================================================

program
    .command('watch [patterns...]')
    .description('Watch files for changes and run lint')
    .action(async (patterns: string[]) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await watchCommand(ctx, patterns);
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Generate Command
// ============================================================================

program
    .command('gen <type> <name>')
    .description('Generate SystemVerilog code (module, testbench, or package)')
    .option('-o, --output <path>', 'Output file path')
    .option('-m, --model <spec>', 'Model to use (format: provider/model)')
    .action(async (type: string, name: string, cmdOpts: { output?: string; model?: string }) => {
        if (!['module', 'testbench', 'package'].includes(type)) {
            console.error(`Invalid type: ${type}. Must be module, testbench, or package.`);
            process.exit(ExitCodes.CONFIG_ERROR);
        }

        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const modelSpec = cmdOpts.model || opts.model;
        const exitCode = await generateCommand(
            ctx,
            type as 'module' | 'testbench' | 'package',
            name,
            cmdOpts,
            modelSpec
        );
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Doctor Command
// ============================================================================

program
    .command('doctor')
    .description('Check environment and dependencies')
    .action(async () => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await doctorCommand(ctx);
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Setup Command
// ============================================================================

program
    .command('setup [tools...]')
    .description('Set up SystemVerilog analysis tools (Verible, Slang)')
    .action(async (tools: string[]) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await setupCommand(ctx, tools);
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// Wave Command
// ============================================================================

program
    .command('wave <vcd-file>')
    .description('Open interactive waveform viewer for VCD file')
    .action(async (vcdFile: string) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await waveCommand(ctx, vcdFile);
        await gracefulShutdown(exitCode);
    });

program
    .command('wave-web <vcd-file>')
    .description('Open browser-based waveform viewer')
    .option('-p, --port <port>', 'Server port', '3000')
    .action(async (vcdFile: string, options: { port: string }) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await waveWebCommand(ctx, vcdFile, parseInt(options.port, 10));
        await gracefulShutdown(exitCode);
    });

// ============================================================================
// MCP Command
// ============================================================================

program
    .command('mcp')
    .description('Start MCP waveform server for Claude integration')
    .action(async () => {
        await startMCPServer();
    });

// ============================================================================
// Version Command
// ============================================================================

program
    .command('version')
    .description('Show version information')
    .action(async () => {
        await versionCommand();
    });

// ============================================================================
// Parse and Run
// ============================================================================

program.parse();

