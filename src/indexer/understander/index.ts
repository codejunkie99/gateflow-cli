/**
 * Understander Module - Main File Parser
 *
 * The Understander module provides the main entry point for parsing
 * SystemVerilog files and extracting all entities using Verible.
 *
 * ## What It Does
 *
 * The FileUnderstander uses Verible's production-grade parser to extract:
 * - Declarations (modules, classes, functions, etc.)
 * - References (imports, type usages, etc.)
 * - Instances (module instantiations)
 * - Directives (preprocessor directives)
 *
 * ## Output
 *
 * Returns a `FileUnderstanderResult` containing:
 * - `file`: FileRecord with path, hash, line offsets
 * - `declarations`: All declarations (modules, classes, etc.)
 * - `references`: All references (imports, type usages, etc.)
 * - `instances`: All module instantiations
 * - `directives`: All preprocessor directives
 * - `errors`: Any parse errors or warnings
 * - `stats`: Parse statistics (time, counts)
 *
 * @example
 * ```typescript
 * import {
 *   FileUnderstander,
 *   understandFiles
 * } from './understander/index.js';
 *
 * // Parse a single file
 * const understander = new FileUnderstander();
 * const result = await understander.understand('/path/to/counter.sv');
 *
 * // Access results
 * console.log(`File: ${result.file.path}`);
 * console.log(`Declarations: ${result.declarations.length}`);
 * console.log(`Instances: ${result.instances.length}`);
 * console.log(`Parse time: ${result.stats.parseTimeMs}ms`);
 *
 * // Parse multiple files in parallel
 * const results = await understandFiles([
 *   '/path/file1.sv',
 *   '/path/file2.sv',
 *   '/path/file3.sv'
 * ]);
 *
 * // Get all modules from all files
 * const modules = results
 *   .filter(r => r.success)
 *   .flatMap(r => r.result.declarations)
 *   .filter(d => d.kind === 'module');
 * ```
 *
 * @module understander
 */

// ============================================================================
// Main Exports
// ============================================================================

export {
  // Main class
  FileUnderstander,
  createFileUnderstander,

  // Batch processing
  understandFiles,
  type UnderstandFilesResult,

  // Options and types
  type FileUnderstanderOptions,
} from './file-understander.js';
