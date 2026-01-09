/**
 * Understander Module - Main File Parser
 *
 * The Understander module provides the main entry point for parsing
 * SystemVerilog files and extracting all entities.
 *
 * ## What It Does
 *
 * The FileUnderstander orchestrates a 7-step pipeline:
 *
 * 1. **Read File** - Load content, compute hash, build line index
 * 2. **Line Continuation** - Join lines ending with backslash
 * 3. **Strip Comments** - Remove // and block comments
 * 4. **Scan Directives** - Extract define, include, ifdef, etc.
 * 5. **Scan Declarations** - Extract module, class, function, etc.
 * 6. **Scan References** - Extract imports, type usages, etc.
 * 7. **Scan Instances** - Extract module instantiations
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
} from './file-understander.js';
