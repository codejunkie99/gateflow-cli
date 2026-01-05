/**
 * CLI Commands
 * Command implementations for GateFlow CLI
 */
import { EventBus, type ExitCode } from '../events/index.js';
import { PolicyEngine } from '../policy/index.js';
import { createTools } from '../tools/index.js';
import { DiffEngine } from '../diff/index.js';
import { ProjectIndexer } from '../context/index.js';
import { Verilator } from '../verification/index.js';
import { TerminalRenderer } from '../ui/index.js';
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
export declare function setupContext(options: GlobalOptions): Promise<CommandContext>;
export declare function chatCommand(ctx: CommandContext, initialQuery?: string): Promise<ExitCode>;
export declare function scanCommand(ctx: CommandContext): Promise<ExitCode>;
export declare function lintCommand(ctx: CommandContext, files: string[]): Promise<ExitCode>;
export declare function fixCommand(ctx: CommandContext, file: string): Promise<ExitCode>;
export declare function watchCommand(ctx: CommandContext, patterns: string[]): Promise<ExitCode>;
export declare function generateCommand(ctx: CommandContext, type: 'module' | 'testbench' | 'package', name: string, options: {
    output?: string;
}): Promise<ExitCode>;
export declare function doctorCommand(ctx: CommandContext): Promise<ExitCode>;
export declare function versionCommand(): Promise<ExitCode>;
