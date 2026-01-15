#!/usr/bin/env node

/**
 * GateFlow CLI
 * AI-powered SystemVerilog development assistant
 */

import { Command } from 'commander';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
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
    type GlobalOptions
} from './commands.js';
import { startMCPServer } from '../waveform/mcp-server.js';

// Load environment variables from multiple locations
// Priority (first found wins): cwd/.env > parent/.env > script-relative
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load in reverse priority order (dotenv doesn't override existing vars)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // for dist/ (lowest priority)
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // relative to script
dotenv.config({ path: path.resolve(process.cwd(), '../.env') }); // parent (for running from cli/)
dotenv.config({ path: path.resolve(process.cwd(), '.env') }); // cwd/.env (highest priority)

/**
 * Validate required environment variables
 * Returns list of missing required vars
 */
function validateEnvVars(): { missing: string[]; warnings: string[] } {
    const missing: string[] = [];
    const warnings: string[] = [];

    // Required for AI functionality
    if (!process.env.ANTHROPIC_API_KEY) {
        missing.push('ANTHROPIC_API_KEY');
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
    .action(async (queryParts: string[]) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        
        const query = queryParts.length > 0 ? queryParts.join(' ') : undefined;
        const exitCode = await chatCommand(ctx, query);
        
        process.exit(exitCode);
    });

// Make chat the default command
program
    .argument('[query...]', 'Query to send to the assistant')
    .action(async (queryParts: string[]) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        
        const query = queryParts.length > 0 ? queryParts.join(' ') : undefined;
        const exitCode = await chatCommand(ctx, query);
        
        process.exit(exitCode);
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
        process.exit(exitCode);
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
        process.exit(exitCode);
    });

// ============================================================================
// Fix Command
// ============================================================================

program
    .command('fix <file>')
    .description('Auto-fix lint errors in a file using AI')
    .action(async (file: string) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await fixCommand(ctx, file);
        process.exit(exitCode);
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
        process.exit(exitCode);
    });

// ============================================================================
// Generate Command
// ============================================================================

program
    .command('gen <type> <name>')
    .description('Generate SystemVerilog code (module, testbench, or package)')
    .option('-o, --output <path>', 'Output file path')
    .action(async (type: string, name: string, cmdOpts: { output?: string }) => {
        if (!['module', 'testbench', 'package'].includes(type)) {
            console.error(`Invalid type: ${type}. Must be module, testbench, or package.`);
            process.exit(ExitCodes.CONFIG_ERROR);
        }
        
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await generateCommand(
            ctx,
            type as 'module' | 'testbench' | 'package',
            name,
            cmdOpts
        );
        process.exit(exitCode);
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
        process.exit(exitCode);
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
        process.exit(exitCode);
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
        process.exit(exitCode);
    });

program
    .command('wave-web <vcd-file>')
    .description('Open browser-based waveform viewer')
    .option('-p, --port <port>', 'Server port', '3000')
    .action(async (vcdFile: string, options: { port: string }) => {
        const opts = program.opts() as GlobalOptions;
        const ctx = await setupContext(opts);
        const exitCode = await waveWebCommand(ctx, vcdFile, parseInt(options.port, 10));
        process.exit(exitCode);
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

