/**
 * Verible Subprocess Execution
 *
 * Handles spawning and managing Verible processes.
 * Provides robust error handling, timeouts, and output parsing.
 *
 * @module verible/subprocess
 */

import { spawn, type ChildProcess } from 'child_process';
import { findVeribleBinary, type VeribleBinary } from './binary-manager.js';
import type { VeribleParseResult, VeribleLintResult, VeribleError, VeribleNode, VeribleLintViolation } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for Verible subprocess execution.
 */
export interface VeribleExecOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Working directory */
  cwd?: string;

  /** Additional environment variables */
  env?: Record<string, string>;

  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Raw subprocess result.
 */
interface SubprocessResult {
  /** Exit code (null if killed) */
  exitCode: number | null;

  /** Standard output */
  stdout: string;

  /** Standard error */
  stderr: string;

  /** Whether the process was killed (timeout/abort) */
  killed: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 30000; // 30 seconds

// ============================================================================
// Core Subprocess Function
// ============================================================================

/**
 * Execute a Verible binary with arguments.
 *
 * @param binary - Which Verible binary to run
 * @param args - Command line arguments
 * @param options - Execution options
 * @returns Subprocess result
 */
async function execVerible(
  binary: VeribleBinary,
  args: string[],
  options: VeribleExecOptions = {}
): Promise<SubprocessResult> {
  const { timeout = DEFAULT_TIMEOUT, cwd, env, signal } = options;

  // Find binary path
  const location = await findVeribleBinary(binary);
  const binaryPath = location.path;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Spawn process
    const proc: ChildProcess = spawn(binaryPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Don't use shell to avoid command injection
      shell: false,
    });

    // Handle abort signal
    if (signal) {
      signal.addEventListener('abort', () => {
        killed = true;
        proc.kill('SIGTERM');
      });
    }

    // Set timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, timeout);
    }

    // Collect stdout
    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Collect stderr
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle errors
    proc.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error(`Failed to execute ${binary}: ${err.message}`));
    });

    // Handle completion
    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);

      resolve({
        exitCode,
        stdout,
        stderr,
        killed,
      });
    });
  });
}

// ============================================================================
// Parse Function
// ============================================================================

/**
 * Parse a SystemVerilog file using verible-verilog-syntax.
 *
 * @param filePath - Path to the file to parse
 * @param options - Execution options
 * @returns Parse result with CST and errors
 */
export async function parseFile(
  filePath: string,
  options: VeribleExecOptions = {}
): Promise<VeribleParseResult> {
  const args = ['--export_json', filePath];

  const result = await execVerible('verible-verilog-syntax', args, options);

  if (result.killed) {
    return {
      file: filePath,
      tree: null,
      errors: [
        {
          message: 'Parse operation timed out or was aborted',
          line: 1,
          column: 1,
          severity: 'error',
        },
      ],
    };
  }

  // Parse JSON output
  try {
    if (result.stdout.trim()) {
      const json = JSON.parse(result.stdout);
      return parseVeribleJsonOutput(filePath, json, result.stderr);
    } else {
      // No output - check stderr for errors
      return {
        file: filePath,
        tree: null,
        errors: parseStderrErrors(filePath, result.stderr),
      };
    }
  } catch (err) {
    return {
      file: filePath,
      tree: null,
      errors: [
        {
          message: `Failed to parse Verible output: ${err instanceof Error ? err.message : String(err)}`,
          line: 1,
          column: 1,
          severity: 'error',
        },
        ...parseStderrErrors(filePath, result.stderr),
      ],
    };
  }
}

/**
 * Parse multiple files in parallel.
 *
 * @param filePaths - Paths to files to parse
 * @param options - Execution options
 * @param concurrency - Max concurrent processes (default: 4)
 * @returns Array of parse results
 */
export async function parseFiles(
  filePaths: string[],
  options: VeribleExecOptions = {},
  concurrency = 4
): Promise<VeribleParseResult[]> {
  const results: VeribleParseResult[] = [];
  const queue = [...filePaths];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift();
      if (file) {
        const result = await parseFile(file, options);
        results.push(result);
      }
    }
  }

  // Create worker pool
  const workers = Array(Math.min(concurrency, filePaths.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);

  // Sort results to match input order
  const pathToIndex = new Map(filePaths.map((p, i) => [p, i]));
  results.sort((a, b) => (pathToIndex.get(a.file) ?? 0) - (pathToIndex.get(b.file) ?? 0));

  return results;
}

// ============================================================================
// Lint Function
// ============================================================================

/**
 * Lint a SystemVerilog file using verible-verilog-lint.
 *
 * @param filePath - Path to the file to lint
 * @param rules - Optional list of rules to enable/disable
 * @param options - Execution options
 * @returns Lint result with violations
 */
export async function lintFile(
  filePath: string,
  rules?: string[],
  options: VeribleExecOptions = {}
): Promise<VeribleLintResult> {
  const args = ['--parse_fatal=false'];

  // Add rule configuration
  if (rules && rules.length > 0) {
    args.push(`--rules=${rules.join(',')}`);
  }

  args.push(filePath);

  const result = await execVerible('verible-verilog-lint', args, options);

  if (result.killed) {
    return {
      file: filePath,
      violations: [],
    };
  }

  // Parse lint output (format: file:line:col: message [rule])
  const violations = parseLintOutput(result.stdout + result.stderr);

  return {
    file: filePath,
    violations,
  };
}

// ============================================================================
// Format Function
// ============================================================================

/**
 * Format a SystemVerilog file using verible-verilog-format.
 *
 * @param content - File content to format
 * @param options - Execution options
 * @returns Formatted content
 */
export async function formatContent(
  content: string,
  options: VeribleExecOptions = {}
): Promise<string> {
  const args = ['-'];

  const location = await findVeribleBinary('verible-verilog-format');

  return new Promise((resolve, reject) => {
    const proc = spawn(location.path, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to format: ${err.message}`));
    });

    proc.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Formatter failed: ${stderr}`));
      }
    });

    // Write content to stdin
    proc.stdin?.write(content);
    proc.stdin?.end();
  });
}

// ============================================================================
// Output Parsing Helpers
// ============================================================================

/**
 * Parse Verible's JSON output into our result type.
 */
function parseVeribleJsonOutput(
  filePath: string,
  json: unknown,
  stderr: string
): VeribleParseResult {
  // Handle different JSON structures Verible might output
  let tree: VeribleNode | null = null;

  if (typeof json === 'object' && json !== null) {
    // Check for tree in different locations
    if ('tree' in json) {
      tree = (json as { tree: VeribleNode }).tree;
    } else if ('tag' in json && 'children' in json) {
      // Direct tree node
      tree = json as VeribleNode;
    }
  }

  return {
    file: filePath,
    tree,
    errors: parseStderrErrors(filePath, stderr),
  };
}

/**
 * Parse error messages from stderr.
 */
function parseStderrErrors(filePath: string, stderr: string): VeribleError[] {
  if (!stderr.trim()) {
    return [];
  }

  const errors: VeribleError[] = [];
  const lines = stderr.split('\n');

  // Pattern: file:line:col: message
  const errorPattern = /^(.+?):(\d+):(\d+):\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(errorPattern);
    if (match) {
      const [, , lineNum, colNum, message] = match;
      errors.push({
        message: message.trim(),
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
        severity: message.toLowerCase().includes('error') ? 'error' : 'warning',
      });
    } else if (line.trim() && !line.startsWith('Note:')) {
      // Generic error without location
      errors.push({
        message: line.trim(),
        line: 1,
        column: 1,
        severity: 'error',
      });
    }
  }

  return errors;
}

/**
 * Parse lint output into violations.
 */
function parseLintOutput(output: string): VeribleLintViolation[] {
  const violations: VeribleLintViolation[] = [];
  const lines = output.split('\n');

  // Pattern: file:line:col: message [rule-name]
  const lintPattern = /^(.+?):(\d+):(\d+):\s*(.+?)\s*\[([^\]]+)\]$/;

  for (const line of lines) {
    const match = line.match(lintPattern);
    if (match) {
      const [, , lineNum, colNum, message, rule] = match;
      violations.push({
        rule,
        message: message.trim(),
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
        severity: 'warning',
      });
    }
  }

  return violations;
}
