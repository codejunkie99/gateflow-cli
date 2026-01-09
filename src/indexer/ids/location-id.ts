/**
 * Location ID Generation
 *
 * Location IDs uniquely identify WHERE something is in source code.
 * They're computed from: file path + line number + column number
 *
 * Format: "loc:<16-char-hex-hash>"
 *
 * Use cases:
 * - Finding all things at the same location
 * - Jump-to-location features
 * - Tracking references and instances
 *
 * Note: Two different things at the exact same location
 * (same file, line, column) will have the same location ID.
 * This is intentional - location IDs track WHERE, not WHAT.
 *
 * @module ids/location-id
 */

import crypto from 'crypto';

// ============================================================================
// Constants
// ============================================================================

/**
 * Prefix for all location IDs.
 * Makes it easy to identify ID type at a glance.
 */
const LOCATION_ID_PREFIX = 'loc:';

/**
 * Length of the hash portion of the ID.
 * 16 hex chars = 64 bits = extremely low collision probability
 */
const HASH_LENGTH = 16;

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate a unique location ID from file path, line, and column.
 *
 * The ID is a hash of the location components, providing:
 * - Consistent results (same input = same output)
 * - Compact representation (16 chars vs full path)
 * - Privacy (doesn't expose full file path in exports)
 *
 * @param file - Absolute file path
 * @param line - Line number (1-based)
 * @param col - Column number (1-based)
 * @returns Location ID in format "loc:abcdef1234567890"
 *
 * @example
 * ```typescript
 * // Same location = same ID
 * const id1 = locationId('/path/to/file.sv', 10, 5);
 * const id2 = locationId('/path/to/file.sv', 10, 5);
 * console.log(id1 === id2);  // true
 *
 * // Different location = different ID
 * const id3 = locationId('/path/to/file.sv', 10, 6);
 * console.log(id1 === id3);  // false
 *
 * // IDs are prefixed for easy identification
 * console.log(id1);  // "loc:a1b2c3d4e5f6g7h8"
 * ```
 */
export function locationId(file: string, line: number, col: number): string {
  // Build the input string that uniquely identifies this location
  // Using colon as separator (unlikely to appear in file paths)
  const input = `${file}:${line}:${col}`;

  // Hash with SHA-256 for good distribution
  const hash = crypto
    .createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, HASH_LENGTH);

  // Return prefixed ID
  return `${LOCATION_ID_PREFIX}${hash}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a string is a valid location ID.
 *
 * @param id - String to check
 * @returns True if it's a valid location ID
 *
 * @example
 * ```typescript
 * isLocationId('loc:a1b2c3d4e5f6g7h8');  // true
 * isLocationId('decl:a1b2c3d4e5f6g7h8'); // false
 * isLocationId('invalid');               // false
 * ```
 */
export function isLocationId(id: string): boolean {
  // Must start with prefix
  if (!id.startsWith(LOCATION_ID_PREFIX)) {
    return false;
  }

  // Must have correct length
  const hash = id.slice(LOCATION_ID_PREFIX.length);
  if (hash.length !== HASH_LENGTH) {
    return false;
  }

  // Must be valid hex
  return /^[0-9a-f]+$/.test(hash);
}

/**
 * Extract the hash portion from a location ID.
 *
 * @param id - Location ID
 * @returns Hash portion, or null if invalid
 *
 * @example
 * ```typescript
 * extractLocationHash('loc:a1b2c3d4e5f6g7h8');  // "a1b2c3d4e5f6g7h8"
 * extractLocationHash('invalid');               // null
 * ```
 */
export function extractLocationHash(id: string): string | null {
  if (!isLocationId(id)) {
    return null;
  }
  return id.slice(LOCATION_ID_PREFIX.length);
}
