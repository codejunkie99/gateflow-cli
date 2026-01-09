/**
 * Comment Stripper Module
 *
 * Removes comments from SystemVerilog code while preserving:
 * - Line structure (newlines are kept so line numbers stay valid)
 * - String literals (comments inside strings are kept)
 * - Character positions (comments replaced with spaces)
 *
 * Comment types handled:
 * - Line comments: // ... newline
 * - Block comments: slash-star ... star-slash
 * - Nested block comment markers inside line comments
 *
 * String types handled:
 * - Double-quoted strings: "..."
 * - Escape sequences: backslash-quote inside strings
 *
 * @example
 * ```typescript
 * const code = 'module foo; // comment\nendmodule';
 * const { cleaned, commentMap } = stripComments(code);
 * // cleaned has comments replaced with spaces
 * // commentMap records where comments were
 * ```
 *
 * @module preprocessor/comment-stripper
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a removed comment.
 */
export interface CommentRange {
  /** Byte offset where comment starts */
  start: number;
  /** Byte offset where comment ends (exclusive) */
  end: number;
  /** Type of comment */
  kind: 'line' | 'block';
  /** Original comment text (including delimiters) */
  text?: string;
}

/**
 * Map of all comments found in the file.
 */
export interface CommentMap {
  /** All comment ranges found */
  ranges: CommentRange[];
  /** Total characters removed */
  totalChars: number;
}

/**
 * Result from stripping comments.
 */
export interface StripCommentsResult {
  /** Code with comments removed */
  cleaned: string;
  /** Information about removed comments */
  commentMap: CommentMap;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Strip comments from SystemVerilog code.
 *
 * Comments are replaced with spaces to preserve byte offsets and line structure.
 * String literals are preserved - comments inside strings are not stripped.
 *
 * @param content - Original code content
 * @param preserveText - If true, store original comment text in map (slower)
 * @returns Object with cleaned code and comment map
 *
 * @example
 * ```typescript
 * const code = 'wire a; // comment\nwire b;';
 * const { cleaned, commentMap } = stripComments(code);
 *
 * console.log(cleaned);
 * // 'wire a;           \nwire b;'
 * //          ^^^^^^^^^ spaces replace comment
 *
 * console.log(commentMap.ranges);
 * // [{ start: 8, end: 18, kind: 'line' }]
 * ```
 */
export function stripComments(
  content: string,
  preserveText = false
): StripCommentsResult {
  const ranges: CommentRange[] = [];
  const chars: string[] = [];
  let totalChars = 0;
  let i = 0;

  while (i < content.length) {
    // Check for line comment: //
    if (content[i] === '/' && content[i + 1] === '/') {
      const start = i;

      // Skip to end of line
      while (i < content.length && content[i] !== '\n') {
        i++;
      }

      // Record the comment
      const text = preserveText ? content.slice(start, i) : undefined;
      ranges.push({ start, end: i, kind: 'line', text });
      totalChars += i - start;

      // Replace with spaces (preserve column positions)
      for (let j = start; j < i; j++) {
        chars.push(' ');
      }

      // Keep the newline
      if (content[i] === '\n') {
        chars.push('\n');
        i++;
      }
      continue;
    }

    // Check for block comment: /*
    if (content[i] === '/' && content[i + 1] === '*') {
      const start = i;
      i += 2; // Skip /*

      // Find closing */
      while (i < content.length) {
        if (i + 1 < content.length && content[i] === '*' && content[i + 1] === '/') {
          i += 2; // Skip */
          break;
        }
        i++;
      }
      // If loop exits without finding */, i === content.length (unterminated comment)

      // Record the comment
      const text = preserveText ? content.slice(start, i) : undefined;
      ranges.push({ start, end: i, kind: 'block', text });
      totalChars += i - start;

      // Replace with spaces, but preserve newlines for line numbers
      for (let j = start; j < i; j++) {
        if (content[j] === '\n') {
          chars.push('\n');
        } else if (content[j] === '\r') {
          chars.push('\r');
        } else {
          chars.push(' ');
        }
      }
      continue;
    }

    // Check for string literal: "..."
    if (content[i] === '"') {
      chars.push(content[i]);
      i++;

      // Scan to end of string, handling escapes
      while (i < content.length && content[i] !== '"') {
        if (content[i] === '\\' && i + 1 < content.length) {
          // Escape sequence - copy both characters
          chars.push(content[i]);
          chars.push(content[i + 1]);
          i += 2;
        } else if (content[i] === '\n') {
          // Newline in string (shouldn't happen, but handle it)
          chars.push(content[i]);
          i++;
          break;
        } else {
          chars.push(content[i]);
          i++;
        }
      }

      // Copy closing quote
      if (content[i] === '"') {
        chars.push(content[i]);
        i++;
      }
      continue;
    }

    // Regular character - copy as-is
    chars.push(content[i]);
    i++;
  }

  return {
    cleaned: chars.join(''),
    commentMap: { ranges, totalChars },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a byte offset is inside a comment.
 *
 * @param commentMap - Comment map from stripComments
 * @param offset - Byte offset to check
 * @returns The comment range if inside a comment, undefined otherwise
 *
 * @example
 * ```typescript
 * const { commentMap } = stripComments('a // b\nc');
 * isInComment(commentMap, 0);  // undefined (before comment)
 * isInComment(commentMap, 3);  // { start: 2, end: 6, kind: 'line' }
 * isInComment(commentMap, 7);  // undefined (after comment)
 * ```
 */
export function isInComment(
  commentMap: CommentMap,
  offset: number
): CommentRange | undefined {
  // Binary search could be used for large comment counts,
  // but linear scan is fine for typical file sizes
  for (const range of commentMap.ranges) {
    if (offset >= range.start && offset < range.end) {
      return range;
    }
    // Comments are sorted by position, so we can early exit
    if (range.start > offset) {
      break;
    }
  }
  return undefined;
}

/**
 * Get all line comments in the file.
 *
 * @param commentMap - Comment map from stripComments
 * @returns Array of line comment ranges
 */
export function getLineComments(commentMap: CommentMap): CommentRange[] {
  return commentMap.ranges.filter((r) => r.kind === 'line');
}

/**
 * Get all block comments in the file.
 *
 * @param commentMap - Comment map from stripComments
 * @returns Array of block comment ranges
 */
export function getBlockComments(commentMap: CommentMap): CommentRange[] {
  return commentMap.ranges.filter((r) => r.kind === 'block');
}

/**
 * Restore original content from cleaned content and comment map.
 *
 * Only works if preserveText was true when stripping.
 *
 * @param cleaned - Cleaned content
 * @param commentMap - Comment map with text preserved
 * @returns Original content
 */
export function restoreComments(
  cleaned: string,
  commentMap: CommentMap
): string {
  // Work backwards to avoid offset shifts
  let result = cleaned;

  for (let i = commentMap.ranges.length - 1; i >= 0; i--) {
    const range = commentMap.ranges[i];
    if (range.text) {
      // Replace spaces back with original comment
      result =
        result.slice(0, range.start) + range.text + result.slice(range.end);
    }
  }

  return result;
}
