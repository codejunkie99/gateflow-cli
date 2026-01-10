/**
 * Verible Adapter
 *
 * High-level adapter that provides a clean interface for using Verible
 * to parse, lint, and format SystemVerilog files.
 *
 * This is the main entry point for Verible integration.
 *
 * @module verible/verible-adapter
 */

import { readFile } from 'fs/promises';
import { parseFile, parseFiles, lintFile, formatContent, type VeribleExecOptions } from './subprocess.js';
import { createCSTMapper, type CSTMapperResult } from './cst-mapper.js';
import { isVeribleAvailable, binaryManager } from './binary-manager.js';
import type { VeribleLintResult } from './types.js';
import type { FileRecord } from '../types/file.js';
import type { Declaration } from '../types/declaration.js';
import type { Reference } from '../types/reference.js';
import type { Instance } from '../types/instance.js';
import type { Directive } from '../types/directive.js';
import type { ParseError } from '../types/location.js';
import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for Verible adapter.
 */
export interface VeribleAdapterOptions {
  /** Timeout for Verible operations in milliseconds */
  timeout?: number;

  /** Whether to include lint results */
  includeLint?: boolean;

  /** Lint rules to enable (if includeLint is true) */
  lintRules?: string[];
}

/**
 * Result from parsing a file with Verible.
 */
export interface VeribleParseFileResult {
  /** File metadata */
  file: FileRecord;

  /** Extracted declarations */
  declarations: Declaration[];

  /** Extracted references */
  references: Reference[];

  /** Extracted instances */
  instances: Instance[];

  /** Extracted directives */
  directives: Directive[];

  /** Parse errors */
  errors: ParseError[];

  /** Lint violations (if linting was enabled) */
  lintViolations?: VeribleLintResult['violations'];

  /** Parse statistics */
  stats: {
    parseTimeMs: number;
    declarationCount: number;
    referenceCount: number;
    instanceCount: number;
    directiveCount: number;
  };

  /**
   * True if Verible returned null tree (complete parse failure).
   * Indicates Verible couldn't parse the file (e.g., checker constructs).
   */
  treeWasNull?: boolean;
}

// ============================================================================
// Verible Adapter Class
// ============================================================================

/**
 * Adapter for using Verible to process SystemVerilog files.
 *
 * @example
 * ```typescript
 * const adapter = new VeribleAdapter();
 *
 * // Check if Verible is available
 * if (await adapter.isAvailable()) {
 *   // Parse a file
 *   const result = await adapter.parseFile('/path/to/file.sv');
 *   console.log(`Found ${result.declarations.length} declarations`);
 *
 *   // Format content
 *   const formatted = await adapter.format(code);
 * }
 * ```
 */
export class VeribleAdapter {
  private readonly options: VeribleAdapterOptions;
  private readonly mapper = createCSTMapper();

  constructor(options: VeribleAdapterOptions = {}) {
    this.options = {
      timeout: 30000,
      includeLint: false,
      ...options,
    };
  }

  /**
   * Check if Verible is available on the system.
   */
  async isAvailable(): Promise<boolean> {
    return isVeribleAvailable();
  }

  /**
   * Get Verible version.
   */
  async getVersion(): Promise<string | undefined> {
    return binaryManager.getVersion();
  }

  /**
   * Parse a SystemVerilog file.
   *
   * @param filePath - Path to the file to parse
   * @returns Parse result with declarations, references, instances, etc.
   */
  async parseFile(filePath: string): Promise<VeribleParseFileResult> {
    const startTime = Date.now();

    // Read file content
    const content = await readFile(filePath, 'utf-8');
    const lineOffsets = this.buildLineOffsets(content);

    // Create file record
    const fileRecord = this.createFileRecord(filePath, content, lineOffsets);

    // Parse with Verible
    const execOptions: VeribleExecOptions = {
      timeout: this.options.timeout,
    };

    const parseResult = await parseFile(filePath, execOptions);

    // Map CST to our types
    const mapperResult = this.mapper.map(parseResult, content, lineOffsets);

    // Optionally lint
    let lintViolations: VeribleLintResult['violations'] | undefined;
    if (this.options.includeLint) {
      const lintResult = await lintFile(filePath, this.options.lintRules, execOptions);
      lintViolations = lintResult.violations;
    }

    const parseTimeMs = Date.now() - startTime;

    return {
      file: fileRecord,
      declarations: mapperResult.declarations,
      references: mapperResult.references,
      instances: mapperResult.instances,
      directives: mapperResult.directives,
      errors: mapperResult.errors,
      lintViolations,
      stats: {
        parseTimeMs,
        declarationCount: mapperResult.declarations.length,
        referenceCount: mapperResult.references.length,
        instanceCount: mapperResult.instances.length,
        directiveCount: mapperResult.directives.length,
      },
      treeWasNull: mapperResult.treeWasNull,
    };
  }

  /**
   * Parse multiple files in parallel.
   *
   * @param filePaths - Paths to files to parse
   * @param concurrency - Max concurrent parses (default: 4)
   * @returns Array of parse results
   */
  async parseFiles(filePaths: string[], concurrency = 4): Promise<VeribleParseFileResult[]> {
    const results: VeribleParseFileResult[] = [];
    const queue = [...filePaths];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (file) {
          try {
            const result = await this.parseFile(file);
            results.push(result);
          } catch (error) {
            // Create error result
            results.push(this.createErrorResult(file, error));
          }
        }
      }
    };

    // Create worker pool
    const workers = Array(Math.min(concurrency, filePaths.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);

    // Sort results to match input order
    const pathToIndex = new Map(filePaths.map((p, i) => [p, i]));
    results.sort((a, b) => (pathToIndex.get(a.file.path) ?? 0) - (pathToIndex.get(b.file.path) ?? 0));

    return results;
  }

  /**
   * Lint a SystemVerilog file.
   *
   * @param filePath - Path to the file to lint
   * @param rules - Optional rules to enable/disable
   * @returns Lint result with violations
   */
  async lint(filePath: string, rules?: string[]): Promise<VeribleLintResult> {
    const execOptions: VeribleExecOptions = {
      timeout: this.options.timeout,
    };
    return lintFile(filePath, rules, execOptions);
  }

  /**
   * Format SystemVerilog code.
   *
   * @param content - Code to format
   * @returns Formatted code
   */
  async format(content: string): Promise<string> {
    return formatContent(content, { timeout: this.options.timeout });
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Build line offset array from content.
   */
  private buildLineOffsets(content: string): number[] {
    const offsets: number[] = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  /**
   * Create a file record from content.
   */
  private createFileRecord(filePath: string, content: string, lineOffsets: number[]): FileRecord {
    const hash = createHash('sha256').update(content).digest('hex').substring(0, 16);

    return {
      id: `file:${hash}`,
      path: filePath,
      hash,
      size: Buffer.byteLength(content, 'utf-8'),
      lineCount: lineOffsets.length,
      lineOffsets,
      lastModified: Date.now(),
      encoding: 'utf-8',
    };
  }

  /**
   * Create an error result for a failed parse.
   */
  private createErrorResult(filePath: string, error: unknown): VeribleParseFileResult {
    const message = error instanceof Error ? error.message : String(error);

    return {
      file: {
        id: `file:error`,
        path: filePath,
        hash: '',
        size: 0,
        lineCount: 0,
        lineOffsets: [],
        lastModified: Date.now(),
        encoding: 'utf-8',
      },
      declarations: [],
      references: [],
      instances: [],
      directives: [],
      errors: [
        {
          message: `Failed to parse file: ${message}`,
          location: { file: filePath, line: 1, col: 1 },
          severity: 'error',
        },
      ],
      stats: {
        parseTimeMs: 0,
        declarationCount: 0,
        referenceCount: 0,
        instanceCount: 0,
        directiveCount: 0,
      },
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a Verible adapter with default options.
 */
export function createVeribleAdapter(options?: VeribleAdapterOptions): VeribleAdapter {
  return new VeribleAdapter(options);
}

/**
 * Parse a single file with Verible (convenience function).
 */
export async function parseWithVerible(filePath: string): Promise<VeribleParseFileResult> {
  const adapter = createVeribleAdapter();
  return adapter.parseFile(filePath);
}

/**
 * Format code with Verible (convenience function).
 */
export async function formatWithVerible(content: string): Promise<string> {
  const adapter = createVeribleAdapter();
  return adapter.format(content);
}

/**
 * Lint a file with Verible (convenience function).
 */
export async function lintWithVerible(filePath: string, rules?: string[]): Promise<VeribleLintResult> {
  const adapter = createVeribleAdapter();
  return adapter.lint(filePath, rules);
}
