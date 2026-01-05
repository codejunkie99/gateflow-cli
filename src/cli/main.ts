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
    versionCommand,
    type GlobalOptions
} from './commands.js';

// Load environment variables from multiple locations
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config(); // cwd/.env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') }); // parent (for running from cli/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // relative to script
dotenv.config({ path: path.resolve(__dirname, '../../../.env') }); // for dist/

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
${chalk.cyan('                AI-powered SystemVerilog Assistant')}
${chalk.yellow('                (Debug Build: Fixes A, B, C, D, E Applied)')}
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
    .hook('preAction', () => {
        // Show banner unless JSON mode
        const opts = program.opts();
        if (!opts.json) {
            console.log(BANNER);
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

