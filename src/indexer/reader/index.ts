/**
 * Reader Module - File Reading and Line Index Utilities
 *
 * This module handles reading SystemVerilog files from disk and provides
 * utilities for fast line/column lookups using byte offset indexes.
 *
 * ## Components
 *
 * ### File Reader
 * - `readFile()` - Read a file and create a FileRecord with metadata
 * - `readFiles()` - Batch read multiple files with concurrency control
 * - `checkFileChanged()` - Quick change detection using mtime/size
 * - `checkHashChanged()` - Thorough change detection using content hash
 *
 * ### Line Index
 * - `buildLineIndex()` - Create byte offset index for a file
 * - `getLineNumber()` - O(log n) line number lookup from byte offset
 * - `getColumnNumber()` - Get column number from byte offset
 * - `getLocation()` - Get both line and column in one call
 * - `extractLines()` - Extract a range of lines from content
 *
 * @example
 * ```typescript
 * import {
 *   readFile,
 *   getLineNumber,
 *   getColumnNumber,
 *   getLocation
 * } from './reader/index.js';
 *
 * // Read a file
 * const { file, content } = await readFile('/path/to/counter.sv');
 *
 * // Use line index for location lookups
 * const regex = /module\s+(\w+)/g;
 * let match;
 * while ((match = regex.exec(content)) !== null) {
 *   const loc = getLocation(file.lineOffsets, match.index);
 *   console.log(`Found module at line ${loc.line}, column ${loc.col}`);
 * }
 * ```
 *
 * @module reader
 */

// ============================================================================
// File Reader Exports
// ============================================================================

export {
  // Main read functions
  readFile,
  
  

  // Change detection
  
  
  

  // File utilities
  
  
  
} from './file-reader.js';

// ============================================================================
// Line Index Exports
// ============================================================================

export {
  // Build index
  buildLineIndex,

  // Location lookups
  getLineNumber,
  
  getLocation,

  // Range utilities
  
  
  
} from './line-index.js';
