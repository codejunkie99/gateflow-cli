/**
 * Preprocessor Module - Code Cleaning Before Parsing
 *
 * This module handles preprocessing SystemVerilog code before
 * the main parsing phase. Preprocessing includes:
 *
 * ## Comment Stripping
 * - Removes `// line comments`
 * - Removes `/* block comments *​/`
 * - Preserves string literals (comments inside strings kept)
 * - Preserves line structure (comments replaced with spaces)
 *
 * ## Line Continuation
 * - Handles backslash-newline sequences
 * - Joins multi-line macro definitions
 * - Joins split statements
 *
 * ## Why Preprocess?
 *
 * Preprocessing simplifies the main parsing phase:
 * - Regex patterns don't need to handle comments
 * - Scope tracking doesn't get confused by commented code
 * - Line continuations are normalized
 *
 * However, we preserve:
 * - Line numbers (by keeping newlines)
 * - Column positions (by replacing with spaces)
 * - Comment locations (for documentation extraction)
 *
 * @example
 * ```typescript
 * import {
 *   stripComments,
 *   handleLineContinuation
 * } from './preprocessor/index.js';
 *
 * // Read file content
 * const content = await readFile('module.sv');
 *
 * // Step 1: Handle line continuations
 * const { processed } = handleLineContinuation(content);
 *
 * // Step 2: Strip comments
 * const { cleaned, commentMap } = stripComments(processed);
 *
 * // Now 'cleaned' is ready for parsing
 * // Use commentMap to track where comments were
 * ```
 *
 * @module preprocessor
 */

// ============================================================================
// Comment Stripper Exports
// ============================================================================

export {
  // Main function
  stripComments,

  // Utilities
  isInComment,
  getLineComments,
  getBlockComments,
  restoreComments,

  // Types
  type CommentRange,
  type CommentMap,
  type StripCommentsResult,
} from './comment-stripper.js';

// ============================================================================
// Line Continuation Exports
// ============================================================================

export {
  // Main function
  handleLineContinuation,
  handleLineContinuationSimple,

  // Utilities
  isContinuedLine,
  getOriginalLineNumber,
  countPhysicalLines,

  // Types
  type LineContinuation,
  type LineContinuationResult,
} from './line-continuation.js';

// ============================================================================
// Combined Preprocessing
// ============================================================================

import { handleLineContinuation } from './line-continuation.js';
import { stripComments, type StripCommentsResult } from './comment-stripper.js';

/**
 * Result from full preprocessing.
 */
export interface PreprocessResult extends StripCommentsResult {
  /** Content after line continuation but before comment stripping */
  afterContinuation: string;
}

/**
 * Perform full preprocessing: line continuation + comment stripping.
 *
 * This is a convenience function that combines both preprocessing steps.
 *
 * @param content - Original file content
 * @returns Fully preprocessed content with metadata
 *
 * @example
 * ```typescript
 * const result = preprocess(fileContent);
 *
 * // Use cleaned content for parsing
 * scanDeclarations(result.cleaned);
 *
 * // Check if something was in a comment
 * if (isInComment(result.commentMap, offset)) {
 *   // Skip - it's a comment
 * }
 * ```
 */
export function preprocess(content: string): PreprocessResult {
  // Step 1: Handle line continuations
  const { processed: afterContinuation } = handleLineContinuation(content);

  // Step 2: Strip comments
  const { cleaned, commentMap } = stripComments(afterContinuation);

  return {
    cleaned,
    commentMap,
    afterContinuation,
  };
}
