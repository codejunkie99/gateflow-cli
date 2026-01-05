/**
 * CLI Agent Tools
 * Function tools using OpenAI Agents SDK for file operations, linting, etc.
 */
import { tool } from '@openai/agents-core';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
// ============================================================================
// File System Tools
// ============================================================================
/**
 * Read a file from the file system
 */
export const readFileTool = tool({
    name: 'read_file',
    description: 'Read the contents of a file. Use this to read SystemVerilog/Verilog source files.',
    parameters: z.object({
        filePath: z.string().describe('Absolute or relative path to the file to read')
    }),
    execute: async ({ filePath }) => {
        try {
            const absolutePath = path.resolve(filePath);
            const content = await fs.readFile(absolutePath, 'utf-8');
            return JSON.stringify({
                success: true,
                path: absolutePath,
                content,
                lines: content.split('\n').length
            });
        }
        catch (error) {
            return JSON.stringify({
                success: false,
                error: error.message
            });
        }
    }
});
/**
 * Write content to a file
 */
export const writeFileTool = tool({
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
    parameters: z.object({
        filePath: z.string().describe('Absolute or relative path to the file to write'),
        content: z.string().describe('The content to write to the file')
    }),
    execute: async ({ filePath, content }) => {
        try {
            const absolutePath = path.resolve(filePath);
            // Ensure directory exists
            const dir = path.dirname(absolutePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(absolutePath, content, 'utf-8');
            return JSON.stringify({
                success: true,
                path: absolutePath,
                bytesWritten: content.length
            });
        }
        catch (error) {
            return JSON.stringify({
                success: false,
                error: error.message
            });
        }
    }
});
/**
 * List files in a directory
 */
export const listFilesTool = tool({
    name: 'list_files',
    description: 'List files in a directory. Can filter by extension.',
    parameters: z.object({
        dirPath: z.string().describe('Path to the directory to list'),
        extensions: z.array(z.string()).optional().describe('File extensions to filter (e.g., [".sv", ".v"])')
    }),
    execute: async ({ dirPath, extensions }) => {
        try {
            const absolutePath = path.resolve(dirPath);
            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const files = [];
            for (const entry of entries) {
                const fullPath = path.join(absolutePath, entry.name);
                if (entry.isDirectory()) {
                    files.push({ name: entry.name, type: 'directory', path: fullPath });
                }
                else if (entry.isFile()) {
                    // Filter by extension if specified
                    if (extensions && extensions.length > 0) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (!extensions.includes(ext))
                            continue;
                    }
                    files.push({ name: entry.name, type: 'file', path: fullPath });
                }
            }
            return JSON.stringify({
                success: true,
                directory: absolutePath,
                files,
                count: files.length
            });
        }
        catch (error) {
            return JSON.stringify({
                success: false,
                error: error.message
            });
        }
    }
});
/**
 * Scan codebase recursively for SystemVerilog/Verilog files
 */
export const scanCodebaseTool = tool({
    name: 'scan_codebase',
    description: 'Recursively scan a directory for SystemVerilog/Verilog files (.sv, .v). Returns a summary of the codebase structure.',
    parameters: z.object({
        dirPath: z.string().describe('Root directory to scan'),
        maxDepth: z.number().optional().describe('Maximum recursion depth (default: 5)')
    }),
    execute: async ({ dirPath, maxDepth = 5 }) => {
        const absolutePath = path.resolve(dirPath);
        const files = [];
        async function scanDir(dir, depth) {
            if (depth > maxDepth)
                return;
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        // Skip common non-source directories
                        if (['node_modules', 'obj_dir', '.git', 'dist'].includes(entry.name))
                            continue;
                        await scanDir(fullPath, depth + 1);
                    }
                    else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (['.sv', '.v', '.svh', '.vh'].includes(ext)) {
                            // Determine type based on naming convention
                            const baseName = path.basename(entry.name, ext).toLowerCase();
                            let type = 'module';
                            if (baseName.startsWith('tb_') || baseName.endsWith('_tb') || baseName.includes('test')) {
                                type = 'testbench';
                            }
                            else if (baseName.endsWith('_pkg') || baseName.includes('package')) {
                                type = 'package';
                            }
                            files.push({
                                path: fullPath,
                                name: entry.name,
                                type
                            });
                        }
                    }
                }
            }
            catch (error) {
                // Skip directories we can't read
            }
        }
        await scanDir(absolutePath, 0);
        // Group by type
        const modules = files.filter(f => f.type === 'module');
        const testbenches = files.filter(f => f.type === 'testbench');
        const packages = files.filter(f => f.type === 'package');
        return JSON.stringify({
            success: true,
            rootPath: absolutePath,
            summary: {
                totalFiles: files.length,
                modules: modules.length,
                testbenches: testbenches.length,
                packages: packages.length
            },
            files
        });
    }
});
// ============================================================================
// Verilator Tools
// ============================================================================
/**
 * Convert Windows path to WSL path
 */
function convertToWSLPath(windowsPath) {
    const normalized = windowsPath.replace(/\\/g, '/');
    const match = normalized.match(/^([A-Z]):(\/.*)/i);
    if (match) {
        const [, drive, rest] = match;
        return `/mnt/${drive.toLowerCase()}${rest}`;
    }
    return normalized;
}
/**
 * Run a WSL command and capture output
 */
function runWSLCommand(args) {
    return new Promise((resolve) => {
        const proc = spawn('wsl', args);
        let output = '';
        let errorOutput = '';
        proc.stdout.on('data', (data) => output += data.toString());
        proc.stderr.on('data', (data) => errorOutput += data.toString());
        proc.on('close', (code) => {
            resolve({
                success: code === 0,
                output: output + errorOutput,
                exitCode: code ?? -1
            });
        });
        proc.on('error', (error) => {
            resolve({
                success: false,
                output: `Failed to run WSL command: ${error.message}`,
                exitCode: -1
            });
        });
    });
}
/**
 * Parse Verilator output to extract errors
 */
function parseVerilatorErrors(output) {
    const errors = [];
    const lines = output.replace(/\u001b\[\d+m/g, '').split('\n');
    for (const line of lines) {
        const match = line.match(/%(\w+):\s+([^:]+):(\d+)(?::(\d+))?: (.+)/);
        if (match) {
            const [, severity, file, lineNum, colNum, message] = match;
            errors.push({
                line: parseInt(lineNum, 10),
                column: colNum ? parseInt(colNum, 10) : undefined,
                message: message.trim(),
                severity: severity.toLowerCase() === 'error' ? 'error' : 'warning',
                file
            });
        }
    }
    return errors;
}
/**
 * Lint a SystemVerilog/Verilog file using Verilator
 */
export const lintFileTool = tool({
    name: 'lint_file',
    description: 'Lint a SystemVerilog/Verilog file using Verilator. Returns syntax errors and warnings.',
    parameters: z.object({
        filePath: z.string().describe('Path to the SystemVerilog/Verilog file to lint')
    }),
    execute: async ({ filePath }) => {
        try {
            const absolutePath = path.resolve(filePath);
            const wslPath = convertToWSLPath(absolutePath);
            const includeDir = convertToWSLPath(path.dirname(absolutePath));
            const args = [
                'verilator',
                '--lint-only',
                '-Wall',
                '-Wno-fatal',
                '-Wno-DECLFILENAME',
                '-Wno-EOFNEWLINE',
                `-I${includeDir}`,
                wslPath
            ];
            const result = await runWSLCommand(args);
            const errors = parseVerilatorErrors(result.output);
            const errorCount = errors.filter(e => e.severity === 'error').length;
            const warningCount = errors.filter(e => e.severity === 'warning').length;
            return JSON.stringify({
                success: result.success && errorCount === 0,
                errors,
                errorCount,
                warningCount,
                output: result.output
            });
        }
        catch (error) {
            return JSON.stringify({
                success: false,
                error: error.message
            });
        }
    }
});
// ============================================================================
// Human-in-the-Loop Tools
// ============================================================================
/**
 * Custom error for human input required
 */
export class HumanInputRequiredError extends Error {
    action;
    details;
    options;
    constructor(action, details, options) {
        super(`Human input required: ${action}`);
        this.action = action;
        this.details = details;
        this.options = options;
        this.name = 'HumanInputRequiredError';
    }
}
/**
 * Request approval from the user before performing an action
 */
export const requestApprovalTool = tool({
    name: 'request_approval',
    description: 'Request user approval before performing a critical action like writing files or making major changes.',
    parameters: z.object({
        action: z.string().describe('What action is being requested (e.g., "write file", "delete file")'),
        details: z.string().describe('Details about the action (e.g., file path, changes being made)'),
        options: z.array(z.string()).optional().describe('Options for user to choose from')
    }),
    execute: async ({ action, details, options }) => {
        // This will be caught by the orchestrator which will prompt the user
        throw new HumanInputRequiredError(action, details, options);
    }
});
// ============================================================================
// Export all tools
// ============================================================================
export const fileTools = [readFileTool, writeFileTool, listFilesTool, scanCodebaseTool];
export const lintTools = [lintFileTool];
export const humanLoopTools = [requestApprovalTool];
export const allTools = [...fileTools, ...lintTools, ...humanLoopTools];
