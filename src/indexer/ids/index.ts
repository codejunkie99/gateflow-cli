/**
 * IDs Module - Unique Identification System
 *
 * This module provides two types of IDs for tracking entities:
 *
 * ## Location IDs (loc:)
 * Identify WHERE something is in source code.
 * - Computed from: file + line + column
 * - Use for: Every occurrence (references, instances, directives)
 * - Property: Same location = same ID
 *
 * ## Declaration IDs (decl:)
 * Identify WHAT something is (its identity).
 * - Computed from: file + kind + name + scope
 * - Use for: Declarations only (the "birth certificate")
 * - Property: Same entity = same ID (even if line changes)
 *
 * @example
 * ```typescript
 * import {
 *   locationId,
 *   declarationId,
 *   isLocationId,
 *   isDeclarationId,
 *   identifyIdType
 * } from './ids/index.js';
 *
 * // Generate a location ID for a reference at line 10, col 5
 * const refLocId = locationId('/path/file.sv', 10, 5);
 * // "loc:a1b2c3d4e5f6g7h8"
 *
 * // Generate a declaration ID for a module
 * const modDeclId = declarationId('/path/file.sv', 'module', 'counter', []);
 * // "decl:b2c3d4e5f6g7h8i9"
 *
 * // Check ID types
 * console.log(isLocationId(refLocId));      // true
 * console.log(isDeclarationId(modDeclId));  // true
 *
 * // Identify unknown ID
 * const info = identifyIdType(someId);
 * if (info.type === 'declaration') {
 *   // Handle declaration ID
 * }
 * ```
 *
 * @module ids
 */

// ============================================================================
// Location ID Exports
// ============================================================================

export {
  // Main function
  locationId,

  // Utilities
  isLocationId,
  extractLocationHash,
} from './location-id.js';

// ============================================================================
// Declaration ID Exports
// ============================================================================

export {
  // Main function
  declarationId,

  // Utilities
  isDeclarationId,
  extractDeclarationHash,
  identifyIdType,
} from './declaration-id.js';
