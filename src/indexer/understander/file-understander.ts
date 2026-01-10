/**
 * File Understander Module
 *
 * The FileUnderstander is the main orchestrator that parses a single
 * SystemVerilog file and extracts all entities from it.
 *
 * ## Two-Parser Architecture
 *
 * Uses both **Slang** and **Verible** in parallel:
 * - **Slang** (primary): Full SystemVerilog compiler with semantic analysis
 *   - Better type resolution, parameter evaluation, instance elaboration
 *   - Handles checker constructs, generate blocks, complex preprocessor
 * - **Verible** (directives): Production-grade parser for directive extraction
 *   - Only source for `define, `include, `ifdef directives
 *   - Slang evaluates preprocessor but doesn't report directives
 *
 * Both tools auto-download from GitHub releases if not installed.
 *
 * The result contains:
 * - FileRecord with metadata
 * - All declarations found (from Slang if available, else Verible)
 * - All references found (from Slang if available, else Verible)
 * - All instances found (from Slang if available, else Verible)
 * - All directives found (always from Verible)
 * - Any parse errors
 * - Performance statistics
 *
 * @module understander/file-understander
 */

import { readFile } from 'fs/promises';
import type {
  FileUnderstanderResult,
  Declaration,
  Reference,
  Instance,
  ParseError,
} from '../types/index.js';
import {
  VeribleAdapter,
  isVeribleAvailable,
} from '../verible/index.js';
import {
  canUseSlang,
  runSlangOnFiles,
  mapSlangAst,
} from '../slang/index.js';
import {
  FileResultCache,
  getFileResultCache,
  type FileResultCacheOptions,
} from '../cache/index.js';

/**
 * Result from Slang parsing with errors included.
 */
interface SlangParseResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  errors: ParseError[];
}

// ============================================================================
// Types
// ============================================================================

/**
 * Options for FileUnderstander.
 */
export interface FileUnderstanderOptions {
  /**
   * Include lint results when using Verible.
   */
  includeLint?: boolean;

  /**
   * Lint rules to enable (when includeLint is true).
   */
  lintRules?: string[];

  /**
   * Timeout for parser operations in milliseconds.
   */
  timeout?: number;

  /**
   * Enable caching (default: true).
   */
  caching?: boolean;

  /**
   * Custom cache instance (uses default if not provided).
   */
  cache?: FileResultCache;
}

// ============================================================================
// FileUnderstander Class
// ============================================================================

/**
 * Parses SystemVerilog files using Slang (primary) and Verible (directives).
 *
 * Both parsers run in parallel for best performance. Slang provides better
 * semantic analysis while Verible provides directive extraction.
 *
 * @example
 * ```typescript
 * const understander = new FileUnderstander();
 *
 * // Parse a single file
 * const result = await understander.understand('/path/to/counter.sv');
 *
 * console.log(`Found ${result.declarations.length} declarations`);
 * console.log(`Found ${result.instances.length} instances`);
 *
 * // Check for errors
 * if (result.errors.length > 0) {
 *   console.warn('Parse warnings:', result.errors);
 * }
 *
 * // Access statistics
 * console.log(`Parse time: ${result.stats.parseTimeMs}ms`);
 * ```
 */
export class FileUnderstander {
  private readonly options: FileUnderstanderOptions;
  private readonly cache: FileResultCache | null;
  private verible?: VeribleAdapter;
  private veribleChecked = false;
  private veribleAvailable = false;
  private slangChecked = false;
  private slangAvailable = false;

  constructor(options: FileUnderstanderOptions = {}) {
    this.options = options;

    // Initialize cache (default: enabled)
    this.cache = options.caching !== false
      ? (options.cache ?? getFileResultCache())
      : null;
  }

  // --------------------------------------------------------------------------
  // Main Method
  // --------------------------------------------------------------------------

  /**
   * Parse a file and extract all entities.
   *
   * Runs Slang and Verible in parallel:
   * - Slang: declarations, references, instances (better semantic analysis)
   * - Verible: directives (only source for preprocessor directives)
   *
   * @param filePath - Path to the SystemVerilog file
   * @returns Complete parse result with all entities
   * @throws Error if Verible is not available (required for directives)
   */
  async understand(filePath: string): Promise<FileUnderstanderResult> {
    // Check cache first (if enabled)
    if (this.cache) {
      const content = await readFile(filePath, 'utf-8');
      const contentHash = this.cache.hashContent(content);

      const cachedResult = this.cache.get(contentHash);
      if (cachedResult) {
        // Cache hit - rebuild lineOffsets if needed
        if (cachedResult.file.lineOffsets.length === 0) {
          cachedResult.file.lineOffsets = this.buildLineOffsets(content);
        }
        return cachedResult;
      }

      // Cache miss - parse and cache
      const result = await this.parseAndMerge(filePath);
      this.cache.set(contentHash, filePath, result);
      return result;
    }

    // Caching disabled - just parse
    return this.parseAndMerge(filePath);
  }

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
   * Parse a file using both parsers and merge results.
   */
  private async parseAndMerge(filePath: string): Promise<FileUnderstanderResult> {
    // Run both parsers in parallel - both auto-download if needed
    const [slangResult, veribleResult] = await Promise.allSettled([
      this.parseWithSlang(filePath),
      this.parseWithVerible(filePath),
    ]);

    // Extract results
    const slang = slangResult.status === 'fulfilled' ? slangResult.value : null;
    const verible = veribleResult.status === 'fulfilled' ? veribleResult.value : null;

    // Verible is required for directive extraction
    if (!verible) {
      const error = veribleResult.status === 'rejected' ? veribleResult.reason : 'Unknown error';
      throw new Error(
        `Verible parsing failed (required for directive extraction): ${error}\n` +
        'Install Verible: https://github.com/chipsalliance/verible/releases\n' +
        'Or use your package manager: brew install verible'
      );
    }

    // Simple merge: Slang for semantics, Verible for directives
    return {
      file: verible.file,
      // Prefer Slang results (better semantic analysis)
      declarations: slang?.declarations ?? verible.declarations,
      references: slang?.references ?? verible.references,
      instances: slang?.instances ?? verible.instances,
      // Only Verible provides directive tracking
      directives: verible.directives,
      // Combine errors from both parsers
      errors: [
        ...verible.errors,
        ...(slang?.errors ?? []),
      ],
      stats: {
        ...verible.stats,
        slangUsed: !!slang,
      },
    };
  }

  /**
   * Check if Verible is available.
   */
  async isVeribleAvailable(): Promise<boolean> {
    if (!this.veribleChecked) {
      this.veribleAvailable = await isVeribleAvailable();
      this.veribleChecked = true;
    }
    return this.veribleAvailable;
  }

  /**
   * Check if Slang is available.
   */
  async isSlangAvailable(): Promise<boolean> {
    if (!this.slangChecked) {
      this.slangAvailable = await canUseSlang();
      this.slangChecked = true;
    }
    return this.slangAvailable;
  }

  // --------------------------------------------------------------------------
  // Parser Methods
  // --------------------------------------------------------------------------

  /**
   * Parse a file using Slang.
   * Returns null if Slang is unavailable or parsing fails.
   */
  private async parseWithSlang(filePath: string): Promise<SlangParseResult | null> {
    try {
      const slangOutput = await runSlangOnFiles([filePath]);

      if (!slangOutput.success || !slangOutput.compilation) {
        return null;
      }

      const mapped = mapSlangAst(slangOutput.compilation);

      // Convert Slang diagnostics to our error format
      const errors: ParseError[] = slangOutput.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => ({
          message: d.message,
          location: {
            file: d.location?.file || filePath,
            line: d.location?.line || 0,
            col: d.location?.column || 0,
          },
          severity: 'error' as const,
        }));

      return {
        declarations: mapped.declarations,
        references: mapped.references,
        instances: mapped.instances,
        errors,
      };
    } catch {
      // Slang failed - will fall back to Verible
      return null;
    }
  }

  /**
   * Parse a file using Verible.
   */
  private async parseWithVerible(filePath: string) {
    if (!this.verible) {
      this.verible = new VeribleAdapter({
        timeout: this.options.timeout,
        includeLint: this.options.includeLint,
        lintRules: this.options.lintRules,
      });
    }

    return this.verible.parseFile(filePath);
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Parse multiple files in parallel.
 *
 * @param filePaths - Array of file paths to parse
 * @param concurrency - Max concurrent parses (default: 5)
 * @returns Array of results for each file
 *
 * @example
 * ```typescript
 * const results = await understandFiles([
 *   '/path/to/file1.sv',
 *   '/path/to/file2.sv',
 *   '/path/to/file3.sv'
 * ]);
 *
 * for (const result of results) {
 *   if (result.success) {
 *     console.log(`Parsed: ${result.result.file.path}`);
 *   } else {
 *     console.error(`Failed: ${result.path} - ${result.error}`);
 *   }
 * }
 * ```
 */
export async function understandFiles(
  filePaths: string[],
  concurrency = 5
): Promise<UnderstandFilesResult[]> {
  const understander = new FileUnderstander();
  const results: UnderstandFilesResult[] = [];

  // Process in batches
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((path) => understander.understand(path))
    );

    for (let j = 0; j < batch.length; j++) {
      const filePath = batch[j];
      const result = batchResults[j];

      if (result.status === 'fulfilled') {
        results.push({
          success: true,
          path: filePath,
          result: result.value,
        });
      } else {
        results.push({
          success: false,
          path: filePath,
          error: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        });
      }
    }
  }

  return results;
}

/**
 * Result from batch file understanding.
 */
export type UnderstandFilesResult =
  | {
      success: true;
      path: string;
      result: FileUnderstanderResult;
    }
  | {
      success: false;
      path: string;
      error: string;
    };

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new FileUnderstander instance.
 *
 * @returns New FileUnderstander
 */
export function createFileUnderstander(): FileUnderstander {
  return new FileUnderstander();
}
