/**
 * Verilator Integration
 * Lint, compile, and simulate SystemVerilog with Verilator
 */
import type { EventBus } from '../events/index.js';
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
export declare class Verilator {
    private bus;
    private config;
    private useWsl;
    private wslPath;
    constructor(bus: EventBus, config?: Partial<VerilatorConfig>);
    /**
     * Build command for execution (handles WSL)
     */
    private buildCommand;
    /**
     * Convert Windows path to WSL path
     */
    private toWslPath;
    /**
     * Convert WSL path to Windows path
     */
    private fromWslPath;
    /**
     * Parse Verilator error/warning output
     */
    private parseVerilatorOutput;
    /**
     * Check if Verilator is installed and get version
     */
    checkInstallation(): Promise<{
        installed: boolean;
        version?: string;
        path?: string;
        error?: string;
    }>;
    /**
     * Run lint on a file
     */
    lint(filePath: string, options?: {
        includePaths?: string[];
        topModule?: string;
    }): Promise<LintResult>;
    /**
     * Compile for simulation
     */
    compile(files: string[], topModule: string, options?: {
        trace?: boolean;
        optimize?: boolean;
        includePaths?: string[];
    }): Promise<{
        success: boolean;
        errors: LintError[];
        warnings: LintError[];
        outputDir: string;
        executable?: string;
        duration: number;
    }>;
    /**
     * Run simulation
     */
    simulate(topModule: string, options?: {
        testbench?: string;
        args?: string[];
        timeout?: number;
        vcdFile?: string;
    }): Promise<SimulationResult>;
    /**
     * Clean work directory
     */
    clean(): Promise<void>;
    /**
     * Get work directory path
     */
    getWorkDir(): string;
}
