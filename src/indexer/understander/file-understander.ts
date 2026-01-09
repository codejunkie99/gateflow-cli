/**
 * File Understander Module
 *
 * The FileUnderstander is the main orchestrator that parses a single
 * SystemVerilog file and extracts all entities from it.
 *
 * ## 7-Step Pipeline
 *
 * 1. **Read File** - Read content, compute hash, build line index
 * 2. **Line Continuation** - Join backslash-continued lines
 * 3. **Strip Comments** - Remove // and block comments
 * 4. **Scan Directives** - Find define, include, ifdef, etc.
 * 5. **Scan Declarations** - Find module, class, function, etc.
 * 6. **Scan References** - Find imports, type usages, etc.
 * 7. **Scan Instances** - Find module instantiations
 *
 * The result contains:
 * - FileRecord with metadata
 * - All declarations found
 * - All references found
 * - All instances found
 * - All directives found
 * - Any parse errors
 * - Performance statistics
 *
 * @module understander/file-understander
 */

import { createHash } from 'crypto';
import type {
  FileUnderstanderResult,
  FileRecord,
  Declaration,
  Reference,
  Instance,
  Directive,
  ParseError,
  ParseStats,
} from '../types/index.js';
import { readFile } from '../reader/index.js';
import { preprocess } from '../preprocessor/index.js';
import {
  scanDirectives,
  scanDeclarations,
  scanReferences,
  scanInstances,
  ScopeTracker,
  buildScopeLookup,
  buildGuardLookup,
} from '../scanners/index.js';

// ============================================================================
// FileUnderstander Class
// ============================================================================

/**
 * Parses SystemVerilog files and extracts all entities.
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
  // --------------------------------------------------------------------------
  // Main Method
  // --------------------------------------------------------------------------

  /**
   * Parse a file and extract all entities.
   *
   * @param filePath - Path to the SystemVerilog file
   * @returns Complete parse result with all entities
   */
  async understand(filePath: string): Promise<FileUnderstanderResult> {
    const errors: ParseError[] = [];
    const startTime = Date.now();

    // -------------------------------------------------------------------------
    // Step 1: Read File
    // -------------------------------------------------------------------------

    const { file, content } = await readFile(filePath);

    // -------------------------------------------------------------------------
    // Step 2 & 3: Preprocess (Line Continuation + Comment Stripping)
    // -------------------------------------------------------------------------

    const { cleaned, commentMap } = preprocess(content);

    // -------------------------------------------------------------------------
    // Step 4: Scan Directives
    // -------------------------------------------------------------------------

    const scopeTracker = new ScopeTracker();
    const { directives, ifdefState } = scanDirectives(
      cleaned,
      filePath,
      file.lineOffsets,
      scopeTracker
    );

    // -------------------------------------------------------------------------
    // Step 5: Scan Declarations
    // -------------------------------------------------------------------------

    const { declarations } = scanDeclarations(cleaned, filePath, file.lineOffsets);

    // -------------------------------------------------------------------------
    // Build Lookup Functions
    // -------------------------------------------------------------------------

    const scopeLookup = buildScopeLookup(declarations);
    const guardLookup = buildGuardLookup(ifdefState);

    // -------------------------------------------------------------------------
    // Step 6: Scan References
    // -------------------------------------------------------------------------

    const { references } = scanReferences(
      cleaned,
      filePath,
      file.lineOffsets,
      declarations,
      scopeLookup,
      guardLookup
    );

    // -------------------------------------------------------------------------
    // Step 7: Scan Instances
    // -------------------------------------------------------------------------

    const { instances } = scanInstances(
      cleaned,
      filePath,
      file.lineOffsets,
      declarations,
      scopeLookup,
      guardLookup
    );

    // -------------------------------------------------------------------------
    // Build Result
    // -------------------------------------------------------------------------

    const parseTimeMs = Date.now() - startTime;

    const stats: ParseStats = {
      parseTimeMs,
      declarationCount: declarations.length,
      referenceCount: references.length,
      instanceCount: instances.length,
      directiveCount: directives.length,
    };

    return {
      file,
      declarations,
      references,
      instances,
      directives,
      errors,
      stats,
    };
  }

  /**
   * Parse file content directly (without reading from disk).
   *
   * Useful for testing or when content is already in memory.
   *
   * @param content - File content as string
   * @param filePath - Path to use for the file record
   * @param fileRecord - Optional pre-built file record
   * @returns Complete parse result
   */
  understandContent(
    content: string,
    filePath: string,
    fileRecord?: Partial<FileRecord>
  ): FileUnderstanderResult {
    const errors: ParseError[] = [];
    const startTime = Date.now();

    // Build line offsets
    const lineOffsets = buildLineOffsets(content);

    // Create file record
    const file: FileRecord = {
      id: fileRecord?.id || `file:${hashString(filePath + content).slice(0, 16)}`,
      path: filePath,
      hash: fileRecord?.hash || hashString(content),
      size: fileRecord?.size || content.length,
      lineCount: lineOffsets.length,
      lineOffsets,
      lastModified: fileRecord?.lastModified || Date.now(),
      encoding: fileRecord?.encoding || 'utf-8',
    };

    // Preprocess
    const { cleaned } = preprocess(content);

    // Scan all entities
    const scopeTracker = new ScopeTracker();
    const { directives, ifdefState } = scanDirectives(cleaned, filePath, lineOffsets, scopeTracker);
    const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets);

    // Build lookup functions
    const scopeLookup = buildScopeLookup(declarations);
    const guardLookup = buildGuardLookup(ifdefState);

    const { references } = scanReferences(cleaned, filePath, lineOffsets, declarations, scopeLookup, guardLookup);
    const { instances } = scanInstances(cleaned, filePath, lineOffsets, declarations, scopeLookup, guardLookup);

    const parseTimeMs = Date.now() - startTime;

    return {
      file,
      declarations,
      references,
      instances,
      directives,
      errors,
      stats: {
        parseTimeMs,
        declarationCount: declarations.length,
        referenceCount: references.length,
        instanceCount: instances.length,
        directiveCount: directives.length,
      },
    };
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
// Helper Functions
// ============================================================================

/**
 * Build line offset index from content.
 */
function buildLineOffsets(content: string): number[] {
  const offsets: number[] = [0];

  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      offsets.push(i + 1);
    } else if (content[i] === '\r') {
      if (content[i + 1] === '\n') {
        offsets.push(i + 2);
        i++;
      } else {
        offsets.push(i + 1);
      }
    }
  }

  return offsets;
}

/**
 * Generate a SHA-256 hash for a string.
 * Uses Node.js crypto module for production-grade hashing.
 *
 * @param str - String to hash
 * @returns 32-character hex hash
 */
function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex').slice(0, 32);
}

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
