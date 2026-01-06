/**
 * Verilator Integration
 * Lint, compile, and simulate SystemVerilog with Verilator
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { EventBus } from '../events/index.js';

/**
 * Execute a command using spawn (safe from shell injection)
 * Returns a promise with stdout/stderr
 */
function spawnAsync(
    command: string,
    args: string[],
    options?: { timeout?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let timeoutId: NodeJS.Timeout | undefined;

        const proc = spawn(command, args, {
            cwd: options?.cwd,
            shell: false, // Explicitly disable shell for security
            windowsHide: true
        });

        if (options?.timeout) {
            timeoutId = setTimeout(() => {
                proc.kill();
                reject(new Error(`Command timed out after ${options.timeout}ms`));
            }, options.timeout);
        }

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (timeoutId) clearTimeout(timeoutId);
            resolve({ stdout, stderr, code: code ?? 0 });
        });

        proc.on('error', (error) => {
            if (timeoutId) clearTimeout(timeoutId);
            reject(error);
        });
    });
}

/**
 * Execute a command in WSL using spawn (safe from shell injection)
 */
function spawnWslAsync(
    command: string,
    args: string[],
    options?: { timeout?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string; code: number }> {
    // Use wsl.exe with command and args passed separately
    return spawnAsync('wsl', [command, ...args], options);
}

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
            // Get version using spawn (safe from shell injection)
            const versionResult = this.useWsl
                ? await spawnWslAsync(this.wslPath, ['--version'])
                : await spawnAsync(this.config.binary, ['--version']);

            const match = versionResult.stdout.match(/Verilator (\d+\.\d+(?:\.\d+)?)/);

            // Get path using which/where
            let whichResult: { stdout: string };
            if (this.useWsl) {
                whichResult = await spawnWslAsync('which', [this.wslPath]);
            } else if (process.platform === 'win32') {
                whichResult = await spawnAsync('where', [this.config.binary]);
            } else {
                whichResult = await spawnAsync('which', [this.config.binary]);
            }

            return {
                installed: true,
                version: match ? match[1] : 'unknown',
                path: whichResult.stdout.trim().split('\n')[0]
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
            // Use spawn with args array (safe from shell injection)
            const result = this.useWsl
                ? await spawnWslAsync(this.wslPath, args, { timeout: this.config.timeout })
                : await spawnAsync(this.config.binary, args, { timeout: this.config.timeout });

            const allOutput = result.stdout + result.stderr;
            const parsed = this.parseVerilatorOutput(allOutput);
            const errors = parsed.filter(e => e.type === 'error');

            // Verilator may exit non-zero with only warnings. Success should be based on error count, not exit code.
            return {
                success: errors.length === 0,
                errors,
                warnings: parsed.filter(e => e.type === 'warning'),
                exitCode: result.code,
                duration: Date.now() - startTime
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const parsed = this.parseVerilatorOutput(errorMsg);
            const errors = parsed.filter(e => e.type === 'error');

            return {
                success: errors.length === 0,
                errors,
                warnings: parsed.filter(e => e.type === 'warning'),
                exitCode: 1,
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
            // Use spawn with args array (safe from shell injection)
            const result = this.useWsl
                ? await spawnWslAsync(this.wslPath, args, {
                    timeout: this.config.timeout * 2,
                    cwd: outputDir
                })
                : await spawnAsync(this.config.binary, args, {
                    timeout: this.config.timeout * 2,
                    cwd: outputDir
                });

            const allOutput = result.stdout + result.stderr;
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
            } catch {
                // Executable not found, that's fine if there were errors
            }

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

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const parsed = this.parseVerilatorOutput(errorMsg);

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
                } catch {
                    // VCD file wasn't generated - simulation may not have tracing enabled
                }

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
        } catch {
            // Work directory may not exist or already cleaned - safe to ignore
        }
    }

    /**
     * Get work directory path
     */
    getWorkDir(): string {
        return this.config.workDir;
    }
}

