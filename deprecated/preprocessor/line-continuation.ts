/**
 * Line Continuation Handler Module
 *
 * Handles backslash line continuation in SystemVerilog.
 *
 * In SystemVerilog (and Verilog), a backslash at the end of a line
 * continues the logical line onto the next physical line. This is
 * particularly important for:
 *
 * - Multi-line macro definitions:
 *   ```systemverilog
 *   `define COMPLEX_MACRO(a, b) \
 *     do_something(a); \
 *     do_more(b)
 *   ```
 *
 * - Long statements split across lines:
 *   ```systemverilog
 *   assign very_long_signal_name = \
 *     condition_a ? value_a : \
 *     condition_b ? value_b : default_value;
 *   ```
 *
 * Processing Strategy:
 * - Replace `\\n` (or `\\\r\n` on Windows) with a space
 * - Preserve overall structure for error reporting
 *
 * @module preprocessor/line-continuation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a line continuation.
 */
export interface LineContinuation {
  /** Byte offset of the backslash */
  offset: number;
  /** Original line number (1-based) */
  originalLine: number;
  /** Type of line ending that was joined */
  lineEnding: 'lf' | 'crlf' | 'cr';
}

/**
 * Result from processing line continuations.
 */
export interface LineContinuationResult {
  /** Content with line continuations processed */
  processed: string;
  /** List of all continuations found */
  continuations: LineContinuation[];
  /** Mapping from new line numbers to original line numbers */
  lineMapping?: Map<number, number>;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Process line continuations in SystemVerilog code.
 *
 * Replaces backslash-newline sequences with a space character.
 * This joins logical lines that were split across physical lines.
 *
 * @param content - Original code content
 * @param trackContinuations - If true, record where continuations were found
 * @returns Object with processed content and continuation info
 *
 * @example
 * ```typescript
 * const code = '`define FOO(a) \\\n  bar(a)';
 * const { processed } = handleLineContinuation(code);
 *
 * console.log(processed);
 * // '`define FOO(a)   bar(a)'
 * //               ^^ backslash-newline replaced with space
 * ```
 */
export function handleLineContinuation(
  content: string,
  trackContinuations = false
): LineContinuationResult {
  const continuations: LineContinuation[] = [];
  let result = '';
  let i = 0;
  let currentLine = 1;

  while (i < content.length) {
    // Check for backslash followed by line ending
    if (content[i] === '\\') {
      // Check for \r\n (Windows) or \n (Unix) or \r (old Mac)
      if (content[i + 1] === '\r' && content[i + 2] === '\n') {
        // Windows: \r\n
        if (trackContinuations) {
          continuations.push({
            offset: i,
            originalLine: currentLine,
            lineEnding: 'crlf',
          });
        }
        // Replace \\\r\n with space
        result += ' ';
        i += 3;
        currentLine++;
        continue;
      } else if (content[i + 1] === '\n') {
        // Unix: \n
        if (trackContinuations) {
          continuations.push({
            offset: i,
            originalLine: currentLine,
            lineEnding: 'lf',
          });
        }
        // Replace \\\n with space
        result += ' ';
        i += 2;
        currentLine++;
        continue;
      } else if (content[i + 1] === '\r') {
        // Old Mac: \r
        if (trackContinuations) {
          continuations.push({
            offset: i,
            originalLine: currentLine,
            lineEnding: 'cr',
          });
        }
        // Replace \\\r with space
        result += ' ';
        i += 2;
        currentLine++;
        continue;
      }
      // Backslash not followed by newline - keep as-is
    }

    // Track line numbers
    if (content[i] === '\n') {
      currentLine++;
    } else if (content[i] === '\r') {
      if (content[i + 1] !== '\n') {
        // Standalone \r counts as newline
        currentLine++;
      }
    }

    // Copy character as-is
    result += content[i];
    i++;
  }

  return {
    processed: result,
    continuations,
  };
}

// ============================================================================
// Alternative: Simple Replacement
// ============================================================================

/**
 * Simple line continuation handler using regex.
 *
 * This is faster but doesn't track where continuations occurred.
 * Use this for simple cases where tracking isn't needed.
 *
 * @param content - Original code content
 * @returns Content with line continuations replaced with spaces
 *
 * @example
 * ```typescript
 * const code = '`define FOO \\\n  bar';
 * const processed = handleLineContinuationSimple(code);
 * // '`define FOO   bar'
 * ```
 */
export function handleLineContinuationSimple(content: string): string {
  // Handle Windows (\r\n) and Unix (\n) line endings
  return content.replace(/\\\r?\n/g, ' ');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a position is inside a continued line.
 *
 * @param continuations - List of continuation points
 * @param line - Line number to check (1-based)
 * @returns True if this line was joined from a previous line
 */
export function isContinuedLine(
  continuations: LineContinuation[],
  line: number
): boolean {
  // A line is "continued" if it follows a line that had a continuation
  return continuations.some((c) => c.originalLine === line - 1);
}

/**
 * Get the original line number for a line in processed content.
 *
 * When lines are joined by continuations, the "logical" line number
 * in the processed content differs from the "physical" line number
 * in the original file.
 *
 * @param continuations - List of continuation points
 * @param processedLine - Line number in processed content (1-based)
 * @returns Original physical line number (1-based)
 *
 * @example
 * ```typescript
 * // Original:     Processed:
 * // Line 1: a \   Line 1: a   b
 * // Line 2:   b
 * // Line 3: c     Line 2: c
 *
 * // If we're on "Line 2" in processed, that's actually Line 3 original
 * getOriginalLineNumber(continuations, 2);  // 3
 * ```
 */
export function getOriginalLineNumber(
  continuations: LineContinuation[],
  processedLine: number
): number {
  // Count how many continuations occurred before this line
  // Each continuation "removes" a physical line
  let offset = 0;
  for (const cont of continuations) {
    // Continuation on line N removes line N+1 from physical count
    // So if processed line is >= N+1, add 1 to offset
    if (cont.originalLine < processedLine + offset) {
      offset++;
    }
  }
  return processedLine + offset;
}

/**
 * Count how many physical lines a logical line spans.
 *
 * @param content - Original content
 * @param startLine - Starting line number (1-based)
 * @returns Number of physical lines this logical line spans
 *
 * @example
 * ```typescript
 * const code = 'a \\\n  b \\\n  c';
 * countPhysicalLines(code, 1);  // 3 (lines 1, 2, 3 are one logical line)
 * ```
 */
export function countPhysicalLines(content: string, startLine: number): number {
  const lines = content.split(/\r?\n/);
  let count = 1;
  let currentLine = startLine - 1; // 0-based index

  while (currentLine < lines.length) {
    const line = lines[currentLine];
    if (line.endsWith('\\')) {
      count++;
      currentLine++;
    } else {
      break;
    }
  }

  return count;
}
