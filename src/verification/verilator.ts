/**
 * Verilator Integration
 * Lint, compile, and simulate SystemVerilog with Verilator
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { EventBus } from '../events/index.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface LintError {
    type: 'error' | 'warning';
    code: string;
    file: string;
    line: number;
    column?: number;
    message: string;
    suggestion?: string;
}

export interface LintResult {
    success: boolean;
    errors: LintError[];
    warnings: LintError[];
    exitCode: number;
    duration: number;
}

export interface SimulationResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    vcdPath?: string;
    duration: number;
}

export interface VerilatorConfig {
    /** Path to verilator binary */
    binary: string;
    /** Include paths */
    includePaths: string[];
    /** Define macros */
    defines: Record<string, string>;
    /** Extra verilator flags */
    flags: string[];
    /** Working directory for compilation */
    workDir: string;
    /** Timeout for operations (ms) */
    timeout: number;
}

// ============================================================================
// Error Parser (now inside Class)
// ============================================================================

// (removed standalone function)

// ============================================================================
// Verilator Class
// ============================================================================

export class Verilator {
    private config: VerilatorConfig;
    private useWsl: boolean = false;
    private wslPath: string = '';

    constructor(
        private bus: EventBus,
        config?: Partial<VerilatorConfig>
    ) {
        // Auto-detect WSL if binary path starts with / (Unix path on Windows)
        const binaryPath = config?.binary ?? process.env.VERILATOR_PATH ?? 'verilator';
        const isWslPath = process.platform === 'win32' && binaryPath.startsWith('/');
        
        this.config = {
            binary: binaryPath,
            includePaths: config?.includePaths ?? [],
            defines: config?.defines ?? {},
            flags: config?.flags ?? [],
            workDir: config?.workDir ?? path.join(os.tmpdir(), 'gateflow-verilator'),
            timeout: config?.timeout ?? 60000
        };

        if (isWslPath) {
            this.useWsl = true;
            this.wslPath = binaryPath;
        }
    }

    /**
     * Build command for execution (handles WSL)
     */
    private buildCommand(cmd: string): string {
        if (this.useWsl) {
            // Convert Windows paths to WSL paths for file arguments
            // For now, just use wsl prefix
            return `wsl ${cmd}`;
        }
        return cmd;
    }

    /**
     * Convert Windows path to WSL path
     */
    private toWslPath(winPath: string): string {
        if (!this.useWsl) return winPath;
        
        // Convert C:\Users\... to /mnt/c/Users/...
        const normalized = path.resolve(winPath).replace(/\\/g, '/');
        const driveMatch = normalized.match(/^([a-zA-Z]):/);
        
        if (driveMatch) {
            const drive = driveMatch[1].toLowerCase();
            const rest = normalized.slice(2); // Remove C:
            return `/mnt/${drive}${rest}`;
        }
        
        return normalized;
    }

    /**
     * Convert WSL path to Windows path
     */
    private fromWslPath(wslPath: string): string {
        if (!this.useWsl) return wslPath;
        
        // Convert /mnt/c/Users/... to C:\Users\...
        const match = wslPath.match(/^\/mnt\/([a-z])\/(.*)$/i);
        if (match) {
            const drive = match[1].toUpperCase();
            const rest = match[2].replace(/\//g, '\\');
            return `${drive}:\\${rest}`;
        }
        return wslPath;
    }

    /**
     * Parse Verilator error/warning output
     */
    private parseVerilatorOutput(output: string): LintError[] {
        const errors: LintError[] = [];
        const lines = output.split('\n');

        // Pattern: %Error: file.sv:123:45: message
        // Pattern: %Warning-CODE: file.sv:123: message
        const errorPattern = /^%Error(?:-(\w+))?: ([^:]+):(\d+)(?::(\d+))?: (.+)$/;
        const warningPattern = /^%Warning-(\w+): ([^:]+):(\d+)(?::(\d+))?: (.+)$/;

        for (const line of lines) {
            let match = line.match(errorPattern);
            if (match) {
                errors.push({
                    type: 'error',
                    code: match[1] || 'ERROR',
                    file: this.fromWslPath(match[2]),
                    line: parseInt(match[3], 10),
                    column: match[4] ? parseInt(match[4], 10) : undefined,
                    message: match[5]
                });
                continue;
            }

            match = line.match(warningPattern);
            if (match) {
                errors.push({
                    type: 'warning',
                    code: match[1],
                    file: this.fromWslPath(match[2]),
                    line: parseInt(match[3], 10),
                    column: match[4] ? parseInt(match[4], 10) : undefined,
                    message: match[5]
                });
            }
        }

        return errors;
    }

    // ========================================================================
    // Check Installation
    // ========================================================================

    /**
     * Check if Verilator is installed and get version
     */
    async checkInstallation(): Promise<{
        installed: boolean;
        version?: string;
        path?: string;
        error?: string;
    }> {
        try {
            const cmd = this.useWsl 
                ? `wsl ${this.wslPath} --version`
                : `${this.config.binary} --version`;
            
            const { stdout } = await execAsync(cmd);
            const match = stdout.match(/Verilator (\d+\.\d+(?:\.\d+)?)/);
            
            // Get path
            let whichCmd: string;
            if (this.useWsl) {
                whichCmd = `wsl which ${this.wslPath}`;
            } else {
                whichCmd = process.platform === 'win32'
                    ? `where ${this.config.binary}`
                    : `which ${this.config.binary}`;
            }

            const { stdout: whichOutput } = await execAsync(whichCmd);

            return {
                installed: true,
                version: match ? match[1] : 'unknown',
                path: whichOutput.trim().split('\n')[0]
            };
        } catch (error) {
            return {
                installed: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // ========================================================================
    // Lint
    // ========================================================================

    /**
     * Run lint on a file
     */
    async lint(
        filePath: string,
        options?: {
            includePaths?: string[];
            topModule?: string;
        }
    ): Promise<LintResult> {
        const startTime = Date.now();
        const absolutePath = path.resolve(filePath);

        // Build command
        const args = [
            '--lint-only',
            '--sv',
            '-Wall',
            '-Wno-fatal'  // Don't exit on first error
        ];

        // Add include paths
        const includes = [...this.config.includePaths, ...(options?.includePaths ?? [])];
        for (const inc of includes) {
            const incPath = this.useWsl ? this.toWslPath(path.resolve(inc)) : path.resolve(inc);
            args.push('-I' + incPath);
        }

        // Add defines
        for (const [key, value] of Object.entries(this.config.defines)) {
            args.push(`-D${key}=${value}`);
        }

        // Add top module if specified
        if (options?.topModule) {
            args.push('--top-module', options.topModule);
        }

        // Add extra flags
        args.push(...this.config.flags);

        // Add file (convert to WSL path if needed)
        const fileArg = this.useWsl ? this.toWslPath(absolutePath) : absolutePath;
        args.push(fileArg);

        this.bus.emit({
            type: 'status',
            phase: 'verifying',
            label: `Linting ${path.basename(filePath)}...`
        });

        try {
            const binaryCmd = this.useWsl ? this.wslPath : this.config.binary;
            const fullCmd = this.useWsl 
                ? `wsl ${binaryCmd} ${args.join(' ')}`
                : `${binaryCmd} ${args.join(' ')}`;
            
            const { stdout, stderr } = await execAsync(
                fullCmd,
                { timeout: this.config.timeout }
            );

            const allOutput = stdout + stderr;
            const parsed = this.parseVerilatorOutput(allOutput);

            return {
                success: parsed.filter(e => e.type === 'error').length === 0,
                errors: parsed.filter(e => e.type === 'error'),
                warnings: parsed.filter(e => e.type === 'warning'),
                exitCode: 0,
                duration: Date.now() - startTime
            };

        } catch (error: any) {
            const stdout = error.stdout || '';
            const stderr = error.stderr || error.message || '';
            const allOutput = stdout + stderr;
            const parsed = this.parseVerilatorOutput(allOutput);
            const errors = parsed.filter(e => e.type === 'error');

            // FIX C: Verilator may exit non-zero with only warnings. Success should be based on error count, not exit code.
            return {
                success: errors.length === 0,
                errors: errors,
                warnings: parsed.filter(e => e.type === 'warning'),
                exitCode: error.code ?? 1,
                duration: Date.now() - startTime
            };
        }
    }

    // ========================================================================
    // Compile
    // ========================================================================

    /**
     * Compile for simulation
     */
    async compile(
        files: string[],
        topModule: string,
        options?: {
            trace?: boolean;
            optimize?: boolean;
            includePaths?: string[];
        }
    ): Promise<{
        success: boolean;
        errors: LintError[];
        warnings: LintError[];
        outputDir: string;
        executable?: string;
        duration: number;
    }> {
        const startTime = Date.now();
        const outputDir = path.join(this.config.workDir, topModule);

        // Ensure work directory exists
        await fs.mkdir(outputDir, { recursive: true });

        // Build command
        const args = [
            '--cc',
            '--sv',
            '-Wall',
            '--Mdir', outputDir,
            '--top-module', topModule,
            '--exe',
            '--build'  // Build executable directly
        ];

        // Add trace support
        if (options?.trace ?? true) {
            args.push('--trace');
        }

        // Add optimization
        if (options?.optimize) {
            args.push('-O3');
        }

        // Add include paths
        const includes = [...this.config.includePaths, ...(options?.includePaths ?? [])];
        for (const inc of includes) {
            args.push('-I' + path.resolve(inc));
        }

        // Add defines
        for (const [key, value] of Object.entries(this.config.defines)) {
            args.push(`-D${key}=${value}`);
        }

        // Add extra flags
        args.push(...this.config.flags);

        // Add files
        for (const file of files) {
            args.push(path.resolve(file));
        }

        this.bus.emit({
            type: 'sim_stage',
            stage: 'compile',
            status: 'started',
            message: `Compiling ${topModule}...`
        });

        try {
            const { stdout, stderr } = await execAsync(
                `${this.config.binary} ${args.join(' ')}`,
                {
                    timeout: this.config.timeout * 2,  // Compilation takes longer
                    cwd: outputDir
                }
            );

            const allOutput = stdout + stderr;
            const parsed = this.parseVerilatorOutput(allOutput);
            const errors = parsed.filter(e => e.type === 'error');

            // Check for executable
            const exeName = process.platform === 'win32'
                ? `V${topModule}.exe`
                : `V${topModule}`;
            const exePath = path.join(outputDir, exeName);
            
            let executable: string | undefined;
            try {
                await fs.access(exePath);
                executable = exePath;
            } catch {}

            this.bus.emit({
                type: 'sim_stage',
                stage: 'compile',
                status: errors.length > 0 ? 'failed' : 'completed',
                message: errors.length > 0
                    ? `${errors.length} compilation errors`
                    : 'Compilation successful'
            });

            return {
                success: errors.length === 0,
                errors,
                warnings: parsed.filter(e => e.type === 'warning'),
                outputDir,
                executable,
                duration: Date.now() - startTime
            };

        } catch (error: any) {
            const stderr = error.stderr || error.message || '';
            const parsed = this.parseVerilatorOutput(stderr);

            this.bus.emit({
                type: 'sim_stage',
                stage: 'compile',
                status: 'failed',
                message: 'Compilation failed'
            });

            return {
                success: false,
                errors: parsed.filter((e: LintError) => e.type === 'error'),
                warnings: parsed.filter((e: LintError) => e.type === 'warning'),
                outputDir,
                duration: Date.now() - startTime
            };
        }
    }

    // ========================================================================
    // Simulate
    // ========================================================================

    /**
     * Run simulation
     */
    async simulate(
        topModule: string,
        options?: {
            testbench?: string;
            args?: string[];
            timeout?: number;
            vcdFile?: string;
        }
    ): Promise<SimulationResult> {
        const startTime = Date.now();
        const timeout = options?.timeout ?? this.config.timeout;

        // Find or compile executable
        const outputDir = path.join(this.config.workDir, topModule);
        const exeName = process.platform === 'win32'
            ? `V${topModule}.exe`
            : `V${topModule}`;
        const exePath = path.join(outputDir, exeName);

        // Check if executable exists
        try {
            await fs.access(exePath);
        } catch {
            return {
                success: false,
                stdout: '',
                stderr: `Executable not found: ${exePath}. Run compile first.`,
                exitCode: 1,
                duration: Date.now() - startTime
            };
        }

        this.bus.emit({
            type: 'sim_stage',
            stage: 'simulate',
            status: 'started',
            message: `Running ${topModule}...`
        });

        // Build command args
        const simArgs = [...(options?.args ?? [])];
        
        // Set VCD output if requested
        const vcdPath = options?.vcdFile ?? path.join(outputDir, `${topModule}.vcd`);

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';

            const proc = spawn(exePath, simArgs, {
                cwd: outputDir,
                env: {
                    ...process.env,
                    VERILATOR_ROOT: process.env.VERILATOR_ROOT
                }
            });

            const timeoutId = setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    stdout,
                    stderr: stderr + '\nSimulation timed out',
                    exitCode: -1,
                    duration: Date.now() - startTime
                });
            }, timeout);

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', async (code) => {
                clearTimeout(timeoutId);

                // Check for VCD file
                let vcdExists = false;
                try {
                    await fs.access(vcdPath);
                    vcdExists = true;
                } catch {}

                this.bus.emit({
                    type: 'sim_stage',
                    stage: 'simulate',
                    status: code === 0 ? 'completed' : 'failed',
                    message: code === 0 ? 'Simulation complete' : `Exit code: ${code}`
                });

                resolve({
                    success: code === 0,
                    stdout,
                    stderr,
                    exitCode: code ?? 1,
                    vcdPath: vcdExists ? vcdPath : undefined,
                    duration: Date.now() - startTime
                });
            });

            proc.on('error', (error) => {
                clearTimeout(timeoutId);
                resolve({
                    success: false,
                    stdout,
                    stderr: error.message,
                    exitCode: -1,
                    duration: Date.now() - startTime
                });
            });
        });
    }

    // ========================================================================
    // Utility
    // ========================================================================

    /**
     * Clean work directory
     */
    async clean(): Promise<void> {
        try {
            await fs.rm(this.config.workDir, { recursive: true, force: true });
        } catch {}
    }

    /**
     * Get work directory path
     */
    getWorkDir(): string {
        return this.config.workDir;
    }
}

