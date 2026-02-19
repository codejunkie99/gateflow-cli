/**
 * Line Index Utilities
 *
 * A line index is an array of byte offsets where each line starts.
 * This enables O(log n) line number lookups from byte offsets,
 * which is essential for converting regex match positions to line:col.
 *
 * How it works:
 * ```
 * Content: "module foo;\n  wire a;\nendmodule\n"
 *          ^          ^  ^        ^
 * Offset:  0          12 14       25
 *
 * Line offsets: [0, 12, 25, 34]
 *               L1  L2  L3  (end)
 * ```
 *
 * To find line number for offset 14:
 * - Binary search finds largest offset ≤ 14
 * - That's index 1 (offset 12)
 * - So it's line 2 (1-based)
 *
 * @module reader/line-index
 */

import type { LineOffsets } from '../types/index.js';

// ============================================================================
// Build Line Index
// ============================================================================

/**
 * Build a line offset index from file content.
 *
 * The index maps line numbers to byte offsets.
 * - Index 0 = offset of line 1 (always 0)
 * - Index 1 = offset of line 2
 * - etc.
 *
 * Handles both Unix (\n) and Windows (\r\n) line endings.
 *
 * @param content - File content as string
 * @returns Array of byte offsets for each line start
 *
 * @example
 * ```typescript
 * const content = "line 1\nline 2\nline 3";
 * const offsets = buildLineIndex(content);
 * // offsets = [0, 7, 14]
 * // Line 1 starts at byte 0
 * // Line 2 starts at byte 7 (after "line 1\n")
 * // Line 3 starts at byte 14 (after "line 1\nline 2\n")
 * ```
 */
export function buildLineIndex(content: string): LineOffsets {
  // Line 1 always starts at offset 0
  const offsets: LineOffsets = [0];

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '\n') {
      // Unix line ending: next line starts after \n
      offsets.push(i + 1);
    } else if (char === '\r') {
      // Check for Windows \r\n
      if (content[i + 1] === '\n') {
        // Windows line ending: next line starts after \r\n
        offsets.push(i + 2);
        i++; // Skip the \n
      } else {
        // Old Mac line ending (just \r): next line starts after \r
        offsets.push(i + 1);
      }
    }
  }

  return offsets;
}

// ============================================================================
// Line Number Lookup
// ============================================================================

/**
 * Get the 1-based line number for a byte offset.
 *
 * Uses binary search for O(log n) performance.
 *
 * @param offsets - Line offset index from buildLineIndex
 * @param byteOffset - Byte offset in the content
 * @returns 1-based line number
 *
 * @example
 * ```typescript
 * const content = "line 1\nline 2\nline 3";
 * const offsets = buildLineIndex(content);
 * // offsets = [0, 7, 14]
 *
 * getLineNumber(offsets, 0);   // 1 (start of line 1)
 * getLineNumber(offsets, 5);   // 1 (middle of line 1)
 * getLineNumber(offsets, 7);   // 2 (start of line 2)
 * getLineNumber(offsets, 14);  // 3 (start of line 3)
 * getLineNumber(offsets, 20);  // 3 (middle of line 3)
 * ```
 */
export function getLineNumber(offsets: LineOffsets, byteOffset: number): number {
  // Handle edge cases
  if (offsets.length === 0) {
    return 1;
  }

  if (byteOffset < 0) {
    return 1;
  }

  // Binary search: find largest offset ≤ byteOffset
  let lo = 0;
  let hi = offsets.length - 1;

  while (lo < hi) {
    // Use ceiling division to avoid infinite loop
    const mid = Math.ceil((lo + hi) / 2);

    if (offsets[mid] <= byteOffset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  // Return 1-based line number
  return lo + 1;
}

// ============================================================================
// Column Number Lookup
// ============================================================================

/**
 * Get the 1-based column number for a byte offset.
 *
 * Column = offset - start_of_line + 1
 *
 * @param offsets - Line offset index from buildLineIndex
 * @param byteOffset - Byte offset in the content
 * @returns 1-based column number
 *
 * @example
 * ```typescript
 * const content = "line 1\nline 2\nline 3";
 * const offsets = buildLineIndex(content);
 * // offsets = [0, 7, 14]
 *
 * getColumnNumber(offsets, 0);   // 1 (first char of line 1)
 * getColumnNumber(offsets, 5);   // 6 (sixth char of line 1)
 * getColumnNumber(offsets, 7);   // 1 (first char of line 2)
 * getColumnNumber(offsets, 10);  // 4 (fourth char of line 2)
 * ```
 */
function getColumnNumber(offsets: LineOffsets, byteOffset: number): number {
  // Handle edge cases
  if (offsets.length === 0 || byteOffset < 0) {
    return 1;
  }

  // Get line number (0-based index into offsets)
  const lineIndex = getLineNumber(offsets, byteOffset) - 1;

  // Column = offset from line start + 1
  const lineStart = offsets[lineIndex] ?? 0;
  return byteOffset - lineStart + 1;
}

// ============================================================================
// Location Lookup (Combined)
// ============================================================================

/**
 * Get both line and column numbers for a byte offset.
 *
 * More efficient than calling getLineNumber and getColumnNumber separately.
 *
 * @param offsets - Line offset index from buildLineIndex
 * @param byteOffset - Byte offset in the content
 * @returns Object with 1-based line and column numbers
 *
 * @example
 * ```typescript
 * const content = "module foo;\n  wire a;\nendmodule";
 * const offsets = buildLineIndex(content);
 *
 * getLocation(offsets, 0);   // { line: 1, col: 1 }
 * getLocation(offsets, 7);   // { line: 1, col: 8 }
 * getLocation(offsets, 14);  // { line: 2, col: 3 }
 * ```
 */
export function getLocation(
  offsets: LineOffsets,
  byteOffset: number
): { line: number; col: number } {
  // Handle edge cases
  if (offsets.length === 0 || byteOffset < 0) {
    return { line: 1, col: 1 };
  }

  // Binary search for line
  let lo = 0;
  let hi = offsets.length - 1;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid] <= byteOffset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  // Calculate line and column
  const lineStart = offsets[lo];
  return {
    line: lo + 1,
    col: byteOffset - lineStart + 1,
  };
}

// ============================================================================
// Range Utilities
// ============================================================================

/**
 * Get the byte offset for a line number.
 *
 * @param offsets - Line offset index
 * @param lineNumber - 1-based line number
 * @returns Byte offset of line start, or -1 if line doesn't exist
 *
 * @example
 * ```typescript
 * const offsets = [0, 7, 14];
 * getLineOffset(offsets, 1);  // 0
 * getLineOffset(offsets, 2);  // 7
 * getLineOffset(offsets, 3);  // 14
 * getLineOffset(offsets, 4);  // -1 (no line 4)
 * ```
 */
function getLineOffset(offsets: LineOffsets, lineNumber: number): number {
  const index = lineNumber - 1;

  if (index < 0 || index >= offsets.length) {
    return -1;
  }

  return offsets[index];
}

/**
 * Get the byte range for a line (start inclusive, end exclusive).
 *
 * @param offsets - Line offset index
 * @param lineNumber - 1-based line number
 * @param contentLength - Total content length (for last line)
 * @returns Object with start and end byte offsets, or null if line doesn't exist
 *
 * @example
 * ```typescript
 * const content = "line 1\nline 2\nline 3";
 * const offsets = buildLineIndex(content);
 *
 * getLineRange(offsets, 1, content.length);  // { start: 0, end: 7 }
 * getLineRange(offsets, 2, content.length);  // { start: 7, end: 14 }
 * getLineRange(offsets, 3, content.length);  // { start: 14, end: 20 }
 * ```
 */
function getLineRange(
  offsets: LineOffsets,
  lineNumber: number,
  contentLength: number
): { start: number; end: number } | null {
  const index = lineNumber - 1;

  if (index < 0 || index >= offsets.length) {
    return null;
  }

  const start = offsets[index];
  const end = index + 1 < offsets.length ? offsets[index + 1] : contentLength;

  return { start, end };
}

/**
 * Extract a range of lines from content.
 *
 * @param content - File content
 * @param offsets - Line offset index
 * @param startLine - 1-based start line (inclusive)
 * @param endLine - 1-based end line (inclusive)
 * @returns Extracted text, or empty string if range is invalid
 *
 * @example
 * ```typescript
 * const content = "line 1\nline 2\nline 3";
 * const offsets = buildLineIndex(content);
 *
 * extractLines(content, offsets, 1, 1);  // "line 1\n"
 * extractLines(content, offsets, 2, 3);  // "line 2\nline 3"
 * extractLines(content, offsets, 1, 3);  // "line 1\nline 2\nline 3"
 * ```
 */
function extractLines(
  content: string,
  offsets: LineOffsets,
  startLine: number,
  endLine: number
): string {
  // Validate range
  if (startLine < 1 || endLine < startLine || startLine > offsets.length) {
    return '';
  }

  // Get byte range
  const startOffset = offsets[startLine - 1];
  const endOffset =
    endLine < offsets.length ? offsets[endLine] : content.length;

  return content.slice(startOffset, endOffset);
}
