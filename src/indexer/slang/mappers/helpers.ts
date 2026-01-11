/**
 * Slang Mapper Helpers
 *
 * Utility functions for mapping slang AST to indexer types.
 *
 * @module slang/mappers/helpers
 */

import type { SlangLocation } from '../slang-types.js';
import type { Location } from '../../types/location.js';

// ============================================================================
// Location Mapping
// ============================================================================

/**
 * Map slang location to our Location type.
 *
 * Validates all fields and normalizes invalid line/column values.
 */
export function mapLocation(slangLoc: SlangLocation | undefined): Location | null {
  // Require slangLoc and a valid file path
  if (!slangLoc || typeof slangLoc.file !== 'string' || slangLoc.file.length === 0) {
    return null;
  }

  // Normalize line: must be positive integer, default to 1
  const line =
    typeof slangLoc.line === 'number' &&
    Number.isInteger(slangLoc.line) &&
    slangLoc.line > 0
      ? slangLoc.line
      : 1;

  // Normalize column: must be positive integer, default to 1
  const col =
    typeof slangLoc.column === 'number' &&
    Number.isInteger(slangLoc.column) &&
    slangLoc.column > 0
      ? slangLoc.column
      : 1;

  return {
    file: slangLoc.file,
    line,
    col,
  };
}

// ============================================================================
// Lookup Keys
// ============================================================================

/**
 * Build a lookup key for declaration resolution.
 */
export function buildLookupKey(name: string, scope: string[]): string {
  if (scope.length === 0) {
    return name;
  }
  return `${scope.join('.')}.${name}`;
}

// ============================================================================
// Type Extraction
// ============================================================================

/**
 * Extract width from type string (e.g., "logic [7:0]" -> "[7:0]").
 */
export function extractWidth(typeStr: string): string | undefined {
  const match = typeStr.match(/\[.+\]/);
  return match ? match[0] : undefined;
}
