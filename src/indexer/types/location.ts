/**
 * Location Types for SystemVerilog Indexer
 *
 * This module defines types for tracking WHERE things are in source code.
 * Every entity we extract needs to know its location for:
 * - "Go to definition" features
 * - Error reporting with line numbers
 * - Highlighting in editor
 *
 * @module types/location
 */

// ============================================================================
// Location - Where something is in a file
// ============================================================================

/**
 * Represents a position in source code.
 *
 * Used to track where declarations, references, and instances appear.
 * All line and column numbers are 1-based (first line is line 1, not 0).
 *
 * @example
 * ```typescript
 * // A module declaration at line 5, column 1
 * const loc: Location = {
 *   file: '/path/to/counter.sv',
 *   line: 5,
 *   col: 1,
 *   endLine: 50,  // Module ends at line 50
 *   endCol: 10    // "endmodule" ends at column 10
 * };
 * ```
 */
export interface Location {
  /** Absolute path to the source file */
  file: string;

  /** Line number where entity starts (1-based) */
  line: number;

  /** Column number where entity starts (1-based) */
  col: number;

  /** Line number where entity ends (for multi-line entities like modules) */
  endLine?: number;

  /** Column number where entity ends */
  endCol?: number;
}

// ============================================================================
// Guard - Conditional compilation context
// ============================================================================

/**
 * Represents which `ifdef/`ifndef block an entity is inside.
 *
 * SystemVerilog uses preprocessor directives for conditional compilation:
 * - `ifdef DEBUG     // Include if DEBUG is defined
 * - `ifndef SYNTH    // Include if SYNTH is NOT defined
 *
 * We track this so the indexer knows which code is active under
 * different compile configurations.
 *
 * @example
 * ```typescript
 * // Entity inside `ifdef DEBUG block
 * const guard: Guard = {
 *   condition: 'DEBUG',
 *   inverted: false  // `ifdef, not `ifndef
 * };
 *
 * // Entity inside `ifndef SYNTHESIS block
 * const guard2: Guard = {
 *   condition: 'SYNTHESIS',
 *   inverted: true  // `ifndef
 * };
 *
 * // Nested: inside both `ifdef A and `ifdef B
 * const nestedGuard: Guard = {
 *   condition: 'A && B',  // Combined condition
 *   inverted: false
 * };
 * ```
 */
export interface Guard {
  /**
   * The condition expression.
   * Simple: "DEBUG", "SYNTHESIS"
   * Compound: "A && B", "A || !B" for nested ifdefs
   */
  condition: string;

  /**
   * True if this is `ifndef (negated condition).
   * - false: code included when condition IS defined
   * - true: code included when condition is NOT defined
   */
  inverted: boolean;
}

// ============================================================================
// ParseError - Problems found during parsing
// ============================================================================

/**
 * Represents an error or warning encountered during parsing.
 *
 * The parser is designed to be resilient - it continues parsing even
 * after errors, collecting all problems to report at once.
 *
 * @example
 * ```typescript
 * const error: ParseError = {
 *   message: 'Unterminated string literal',
 *   location: { file: '/path/to/file.sv', line: 42, col: 15 },
 *   severity: 'error'
 * };
 *
 * const warning: ParseError = {
 *   message: 'Module "counter" redefined (previous at line 10)',
 *   location: { file: '/path/to/file.sv', line: 100, col: 1 },
 *   severity: 'warning'
 * };
 * ```
 */
export interface ParseError {
  /** Human-readable description of the problem */
  message: string;

  /** Where the error occurred */
  location: Location;

  /**
   * Severity level:
   * - 'error': Parse failure, entity may be incomplete
   * - 'warning': Suspicious but parseable (e.g., redefinition)
   */
  severity: 'error' | 'warning';
}

// ============================================================================
// LineIndex - Fast line number lookup
// ============================================================================

/**
 * Type for line offset array used for fast line number lookup.
 *
 * This is an array where index i contains the byte offset where line (i+1) starts.
 * Used to convert byte offsets from regex matches into line numbers.
 *
 * @example
 * ```typescript
 * // For content "line1\nline2\nline3"
 * // lineOffsets = [0, 6, 12]
 * //   - Line 1 starts at byte 0
 * //   - Line 2 starts at byte 6 (after "line1\n")
 * //   - Line 3 starts at byte 12 (after "line2\n")
 *
 * const lineOffsets: LineOffsets = [0, 6, 12];
 * ```
 */
export type LineOffsets = number[];
