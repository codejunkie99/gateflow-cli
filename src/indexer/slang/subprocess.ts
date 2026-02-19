/**
 * Slang Subprocess Execution
 *
 * Handles spawning and managing slang processes.
 * Provides robust error handling, timeouts, and output parsing.
 *
 * @module slang/subprocess
 */

import { spawn, type ChildProcess } from 'child_process';
import { findSlangBinary } from './binary-manager.js';
import type { SlangParseResult, SlangCompilation, SlangDesignRoot, SlangDiagnostic } from './slang-types.js';
import type { Recipe } from '../recipe/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for slang subprocess execution.
 */
export interface SlangExecOptions {
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;

  /** Working directory */
  cwd?: string;

  /** Additional environment variables */
  env?: Record<string, string>;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Top module for elaboration */
  topModule?: string;

  /** Include detailed type information */
  detailedTypes?: boolean;
}

/**
 * Arguments for building slang command line.
 */
interface SlangCommandArgs {
  /** Files to compile (absolute paths, in order) */
  files: string[];

  /** Include paths */
  includePaths: string[];

  /** Defines (name -> value, empty string for valueless defines) */
  defines: Record<string, string>;

  /** Top module for elaboration (optional) */
  topModule?: string;

  /** Include detailed types (optional) */
  detailedTypes?: boolean;
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

const DEFAULT_TIMEOUT = 60000; // 60 seconds

// ============================================================================
// Command Building
// ============================================================================

/**
 * Build slang command line arguments from recipe.
 *
 * @param args - Command arguments
 * @returns Array of command line arguments
 *
 * @example
 * ```typescript
 * const args = buildSlangArgs({
 *   files: ['/path/to/file1.sv', '/path/to/file2.sv'],
 *   includePaths: ['/path/to/include'],
 *   defines: { DEBUG: '', WIDTH: '32' },
 *   topModule: 'top',
 * });
 * // Results in: ['--ast-json', '-', '--ast-json-source-info', '-DDEBUG', '-DWIDTH=32', '-I/path/to/include', '--top', 'top', '/path/to/file1.sv', '/path/to/file2.sv']
 * ```
 */
function buildSlangArgs(args: SlangCommandArgs): string[] {
  const cmdArgs: string[] = [
    // JSON output to stdout
    '--ast-json',
    '-',
    // Include source location info
    '--ast-json-source-info',
  ];

  // Detailed types if requested
  if (args.detailedTypes) {
    cmdArgs.push('--ast-json-detailed-types');
  }

  // Add defines (-DNAME or -DNAME=VALUE)
  for (const [name, value] of Object.entries(args.defines)) {
    if (value === '' || value === undefined) {
      cmdArgs.push(`-D${name}`);
    } else {
      cmdArgs.push(`-D${name}=${value}`);
    }
  }

  // Add include paths (-Ipath)
  for (const incPath of args.includePaths) {
    cmdArgs.push(`-I${incPath}`);
  }

  // Add top module if specified
  if (args.topModule) {
    cmdArgs.push('--top', args.topModule);
  }

  // Add files (must be last)
  cmdArgs.push(...args.files);

  return cmdArgs;
}

/**
 * Build slang command arguments from a Recipe.
 *
 * @param recipe - Parsed recipe/filelist
 * @param options - Additional options
 * @returns Command arguments structure
 */
function recipeToSlangArgs(recipe: Recipe, options?: SlangExecOptions): SlangCommandArgs {
  return {
    files: recipe.files,
    includePaths: recipe.includePaths,
    defines: recipe.defines,
    topModule: options?.topModule,
    detailedTypes: options?.detailedTypes,
  };
}

// ============================================================================
// Core Subprocess Function
// ============================================================================

/**
 * Execute slang with the given arguments.
 *
 * @param args - Command line arguments (after binary name)
 * @param options - Execution options
 * @returns Subprocess result
 */
async function execSlang(
  args: string[],
  options: SlangExecOptions = {}
): Promise<SubprocessResult> {
  const { timeout = DEFAULT_TIMEOUT, cwd, env, signal } = options;

  // Find binary path
  const location = await findSlangBinary();
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
    const abortHandler = () => {
      killed = true;
      proc.kill('SIGTERM');
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler);
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
      if (signal) signal.removeEventListener('abort', abortHandler);
      reject(new Error(`Failed to execute slang: ${err.message}`));
    });

    // Handle completion
    proc.on('close', (exitCode) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', abortHandler);

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
// Parse Functions
// ============================================================================

/**
 * Run slang on a recipe and parse the JSON output.
 *
 * @param recipe - Parsed recipe/filelist
 * @param options - Execution options
 * @returns Parse result with AST and diagnostics
 */
export async function runSlangForRecipe(
  recipe: Recipe,
  options: SlangExecOptions = {}
): Promise<SlangParseResult> {
  const cmdArgs = recipeToSlangArgs(recipe, options);
  return runSlang(cmdArgs, options);
}

/**
 * Run slang with command arguments and parse the JSON output.
 *
 * @param cmdArgs - Command arguments
 * @param options - Execution options
 * @returns Parse result with AST and diagnostics
 */
async function runSlang(
  cmdArgs: SlangCommandArgs,
  options: SlangExecOptions = {}
): Promise<SlangParseResult> {
  const args = buildSlangArgs(cmdArgs);

  const result = await execSlang(args, options);

  // Handle timeout/abort
  if (result.killed) {
    return {
      success: false,
      diagnostics: [
        {
          severity: 'error',
          message: 'slang operation timed out or was aborted',
          location: undefined,
        },
      ],
    };
  }

  // Parse JSON output
  try {
    if (result.stdout.trim()) {
      const json = JSON.parse(result.stdout);
      return parseSlangJsonOutput(json, result.stderr);
    } else {
      // No output - check stderr for errors
      return {
        success: false,
        diagnostics: parseStderrDiagnostics(result.stderr),
        rawJson: result.stdout,
      };
    }
  } catch (err) {
    return {
      success: false,
      diagnostics: [
        {
          severity: 'error',
          message: `Failed to parse slang JSON output: ${err instanceof Error ? err.message : String(err)}`,
        },
        ...parseStderrDiagnostics(result.stderr),
      ],
      rawJson: result.stdout,
    };
  }
}

/**
 * Run slang on specific files (not a full recipe).
 *
 * @param files - Files to analyze
 * @param options - Execution options
 * @returns Parse result
 */
export async function runSlangOnFiles(
  files: string[],
  options: SlangExecOptions & {
    includePaths?: string[];
    defines?: Record<string, string>;
  } = {}
): Promise<SlangParseResult> {
  return runSlang(
    {
      files,
      includePaths: options.includePaths ?? [],
      defines: options.defines ?? {},
      topModule: options.topModule,
      detailedTypes: options.detailedTypes,
    },
    options
  );
}

// ============================================================================
// Output Parsing Helpers
// ============================================================================

/**
 * Validate that an object has the expected shape for a design root.
 */
function isValidDesignRoot(obj: unknown): obj is SlangDesignRoot {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    o.kind === 'Root' &&
    typeof o.name === 'string' &&
    Array.isArray(o.members)
  );
}

/**
 * Validate that an object has the expected shape for a compilation.
 */
function isValidCompilation(obj: unknown): obj is SlangCompilation {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  // design is optional, but if present must be valid
  if ('design' in o && o.design !== undefined) {
    return isValidDesignRoot(o.design);
  }
  return true; // Empty compilation is valid
}

/**
 * Parse slang's JSON output into our result type.
 */
function parseSlangJsonOutput(json: unknown, stderr: string): SlangParseResult {
  // Slang can output different structures
  let compilation: SlangCompilation | undefined;

  if (typeof json === 'object' && json !== null) {
    const obj = json as Record<string, unknown>;

    // Check for different JSON structures slang might output
    if ('design' in obj && isValidDesignRoot(obj.design)) {
      // Full compilation with design
      compilation = { design: obj.design };
    } else if (isValidDesignRoot(json)) {
      // Direct design root
      compilation = { design: json };
    } else if ('members' in obj && Array.isArray(obj.members)) {
      // Might be a direct member list - wrap it
      compilation = {
        design: {
          kind: 'Root',
          name: '$root',
          members: obj.members as SlangDesignRoot['members'],
        },
      };
    }
  }

  // Parse diagnostics from stderr
  const diagnostics = parseStderrDiagnostics(stderr);

  // Check if there were fatal errors
  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  return {
    success: !hasErrors && compilation !== undefined,
    compilation,
    diagnostics,
    rawJson: JSON.stringify(json),
  };
}

/**
 * Parse diagnostic messages from stderr.
 */
function parseStderrDiagnostics(stderr: string): SlangDiagnostic[] {
  if (!stderr.trim()) {
    return [];
  }

  const diagnostics: SlangDiagnostic[] = [];
  const lines = stderr.split('\n');

  // Pattern: file:line:col: severity: message
  const diagPattern = /^(.+?):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/i;

  for (const line of lines) {
    const match = line.match(diagPattern);
    if (match) {
      const [, file, lineNum, colNum, severity, message] = match;
      diagnostics.push({
        severity: severity.toLowerCase() as 'error' | 'warning' | 'note',
        message: message.trim(),
        location: {
          file,
          line: parseInt(lineNum, 10),
          column: parseInt(colNum, 10),
        },
      });
    } else if (line.trim() && !line.startsWith('note:')) {
      // Generic message without location
      const severityMatch = line.match(/^(error|warning|note):\s*(.+)$/i);
      if (severityMatch) {
        diagnostics.push({
          severity: severityMatch[1].toLowerCase() as 'error' | 'warning' | 'note',
          message: severityMatch[2].trim(),
        });
      } else if (line.includes('error') || line.includes('Error')) {
        diagnostics.push({
          severity: 'error',
          message: line.trim(),
        });
      }
    }
  }

  return diagnostics;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if slang can be executed.
 *
 * @returns true if slang can be run
 */
async function canRunSlang(): Promise<boolean> {
  try {
    await findSlangBinary();
    return true;
  } catch {
    return false;
  }
}
