/**
 * File Record Types for SystemVerilog Indexer
 *
 * This module defines types for tracking source files themselves.
 * Before we can parse a file's contents, we need to track:
 * - Where the file is
 * - What's in it (hash for change detection)
 * - Line index for fast lookups
 *
 * @module types/file
 */

import type { LineOffsets } from './location.js';

// ============================================================================
// FileRecord - Metadata about a source file
// ============================================================================

/**
 * Complete metadata about a single source file.
 *
 * This is created when we first read a file and stored for:
 * - Change detection (compare hash to see if file changed)
 * - Fast line lookups (using lineOffsets array)
 * - Statistics and reporting
 *
 * @example
 * ```typescript
 * const file: FileRecord = {
 *   id: 'file:a1b2c3d4e5f6g7h8',
 *   path: '/home/user/project/rtl/counter.sv',
 *   hash: 'sha256-abcdef1234567890...',
 *   size: 2048,
 *   lineCount: 150,
 *   lineOffsets: [0, 45, 89, 134, ...],  // 150 entries
 *   lastModified: 1704067200000,
 *   encoding: 'utf-8'
 * };
 * ```
 */
export interface FileRecord {
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * Unique identifier for this file.
   * Format: "file:<16-char-hash>"
   *
   * The hash is derived from the file path to ensure consistency.
   * Even if a file moves, its content-based declarations get new IDs.
   */
  id: string;

  /**
   * Absolute path to the file.
   * Always normalized (forward slashes, no trailing slash).
   */
  path: string;

  // -------------------------------------------------------------------------
  // Content Information
  // -------------------------------------------------------------------------

  /**
   * SHA-256 hash of file content.
   * Used for change detection - if hash differs, file changed.
   */
  hash: string;

  /**
   * File size in bytes.
   * Useful for progress reporting and memory estimation.
   */
  size: number;

  /**
   * Total number of lines in the file.
   * Equal to lineOffsets.length.
   */
  lineCount: number;

  // -------------------------------------------------------------------------
  // Line Index for Fast Lookups
  // -------------------------------------------------------------------------

  /**
   * Byte offset where each line starts.
   *
   * lineOffsets[i] = byte offset where line (i+1) begins
   * lineOffsets[0] = 0 (first line starts at byte 0)
   *
   * Used for O(log n) line number lookup from regex match offsets.
   *
   * @example
   * ```typescript
   * // To find which line contains byte offset 500:
   * // Binary search lineOffsets for largest index where offset <= 500
   * ```
   */
  lineOffsets: LineOffsets;

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  /**
   * Last modification timestamp (milliseconds since epoch).
   * From fs.stat().mtimeMs.
   */
  lastModified: number;

  /**
   * Character encoding of the file.
   * Usually 'utf-8', but could be 'latin1' for legacy files.
   */
  encoding: string;
}

// ============================================================================
// FileReadResult - What we get when reading a file
// ============================================================================

/**
 * Result of reading and processing a source file.
 *
 * This bundles the FileRecord with the actual content string
 * so parsers can work with both.
 *
 * @example
 * ```typescript
 * const { file, content } = await readSourceFile('/path/to/file.sv');
 * // file: FileRecord with metadata
 * // content: string with file contents
 * ```
 */
export interface FileReadResult {
  /** File metadata */
  file: FileRecord;

  /** Raw file content as string */
  content: string;
}
