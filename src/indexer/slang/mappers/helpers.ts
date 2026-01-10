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
 */
export function mapLocation(slangLoc: SlangLocation | undefined): Location | null {
  if (!slangLoc || !slangLoc.file) {
    return null;
  }

  return {
    file: slangLoc.file,
    line: slangLoc.line,
    col: slangLoc.column,
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
