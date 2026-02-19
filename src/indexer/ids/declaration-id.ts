/**
 * Declaration ID Generation
 *
 * Declaration IDs uniquely identify WHAT something is across the codebase.
 * They're computed from: file path + kind + name + scope
 *
 * Format: "decl:<16-char-hex-hash>"
 *
 * Use cases:
 * - Finding the definition of something
 * - Connecting references to their declarations
 * - Connecting instances to their module definitions
 * - Building the module hierarchy tree
 *
 * Key difference from Location ID:
 * - Location ID: WHERE something is (file:line:col)
 * - Declaration ID: WHAT something is (file:kind:name:scope)
 *
 * A declaration at a different location but with the same identity
 * (e.g., after file edit that moves code) keeps the same declaration ID.
 *
 * @example
 * ```typescript
 * // Same module = same declaration ID (even if line changes)
 * const id1 = declarationId('/path/counter.sv', 'module', 'counter', []);
 * // After editing file and module moves to different line
 * const id2 = declarationId('/path/counter.sv', 'module', 'counter', []);
 * console.log(id1 === id2);  // true - same module
 *
 * // Different scope = different declaration ID
 * const id3 = declarationId('/path/pkg.sv', 'class', 'driver', ['my_pkg']);
 * const id4 = declarationId('/path/pkg.sv', 'class', 'driver', ['other_pkg']);
 * console.log(id3 === id4);  // false - different packages
 * ```
 *
 * @module ids/declaration-id
 */

import { createHash } from 'crypto';
import { isLocationId } from './location-id.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Prefix for all declaration IDs.
 * Makes it easy to identify ID type at a glance.
 */
const DECLARATION_ID_PREFIX = 'decl:';

/**
 * Length of the hash portion of the ID.
 * 16 hex chars = 64 bits = extremely low collision probability
 */
const HASH_LENGTH = 16;

/**
 * Separator used to join scope components.
 * Using null byte (\0) to prevent collision attacks.
 * Null bytes cannot appear in SystemVerilog identifiers or file paths.
 *
 * Previous bug: Using '::' caused ['a::b'] to collide with ['a', 'b']
 */
const SCOPE_SEPARATOR = '\0';

/**
 * Separator used between fields (file, kind, name, scope).
 * Using null byte to prevent collisions when fields contain special chars.
 *
 * Previous bug: Using ':' caused kind='a:b' to collide with name='a:b'
 */
const FIELD_SEPARATOR = '\0';

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate a unique declaration ID from file, kind, name, and scope.
 *
 * The ID is a hash of these components, providing:
 * - Consistent results (same input = same output)
 * - Stability across edits (moving code doesn't change ID)
 * - Unique identification within the codebase
 *
 * @param file - Absolute file path where declaration appears (must be non-empty string)
 * @param kind - Kind of declaration (module, class, function, etc.) (must be non-empty string)
 * @param name - Name of the declared entity (must be non-empty string)
 * @param scope - Scope chain (e.g., ['package_name', 'class_name']) (must be array)
 * @returns Declaration ID in format "decl:abcdef1234567890"
 * @throws {Error} If file, kind, or name is not a non-empty string, or scope is not an array
 *
 * @example
 * ```typescript
 * // Top-level module
 * const modId = declarationId('/rtl/counter.sv', 'module', 'counter', []);
 * // "decl:a1b2c3d4e5f6g7h8"
 *
 * // Class inside a package
 * const classId = declarationId('/tb/my_pkg.sv', 'class', 'driver', ['my_pkg']);
 * // "decl:b2c3d4e5f6g7h8i9"
 *
 * // Function inside a class inside a package
 * const funcId = declarationId(
 *   '/tb/my_pkg.sv',
 *   'function',
 *   'get_data',
 *   ['my_pkg', 'driver']
 * );
 * // "decl:c3d4e5f6g7h8i9j0"
 *
 * // Port inside a module
 * const portId = declarationId('/rtl/counter.sv', 'port', 'clk', ['counter']);
 * // "decl:d4e5f6g7h8i9j0k1"
 * ```
 */
export function declarationId(
  file: string,
  kind: string,
  name: string,
  scope: string[]
): string {
  // Validate file is a non-empty string
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error('declarationId: file must be a non-empty string');
  }

  // Validate kind is a non-empty string
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new Error('declarationId: kind must be a non-empty string');
  }

  // Validate name is a non-empty string
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('declarationId: name must be a non-empty string');
  }

  // Validate scope is an array
  if (!Array.isArray(scope)) {
    throw new Error('declarationId: scope must be an array');
  }

  // Filter scope array - remove empty strings, null, undefined
  // This prevents collisions like [] vs [''] or [null, 'a'] vs ['', 'a']
  const cleanScope = scope.filter(
    (s): s is string => typeof s === 'string' && s.length > 0
  );

  // Join scope components with null byte separator
  // Null bytes can't appear in identifiers, preventing collision attacks
  const scopeStr = cleanScope.join(SCOPE_SEPARATOR);

  // Build the input string that uniquely identifies this declaration
  // Using null byte as field separator to prevent collisions
  const input = [file, kind, name, scopeStr].join(FIELD_SEPARATOR);

  // Hash with SHA-256 for good distribution
  const hash = createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, HASH_LENGTH);

  // Return prefixed ID
  return `${DECLARATION_ID_PREFIX}${hash}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a string is a valid declaration ID.
 *
 * @param id - String to check
 * @returns True if it's a valid declaration ID
 *
 * @example
 * ```typescript
 * isDeclarationId('decl:a1b2c3d4e5f6g7h8');  // true
 * isDeclarationId('loc:a1b2c3d4e5f6g7h8');   // false (location ID)
 * isDeclarationId('invalid');                 // false
 * ```
 */
export function isDeclarationId(id: string): boolean {
  // Guard against null/undefined
  if (typeof id !== 'string') {
    return false;
  }

  // Must start with prefix
  if (!id.startsWith(DECLARATION_ID_PREFIX)) {
    return false;
  }

  // Must have correct length
  const hash = id.slice(DECLARATION_ID_PREFIX.length);
  if (hash.length !== HASH_LENGTH) {
    return false;
  }

  // Must be valid hex
  return /^[0-9a-f]+$/.test(hash);
}

/**
 * Extract the hash portion from a declaration ID.
 *
 * @param id - Declaration ID
 * @returns Hash portion, or null if invalid
 *
 * @example
 * ```typescript
 * extractDeclarationHash('decl:a1b2c3d4e5f6g7h8');  // "a1b2c3d4e5f6g7h8"
 * extractDeclarationHash('invalid');                 // null
 * ```
 */
function extractDeclarationHash(id: string): string | null {
  if (!isDeclarationId(id)) {
    return null;
  }
  return id.slice(DECLARATION_ID_PREFIX.length);
}

/**
 * Check if an ID is either a location ID or declaration ID.
 *
 * @param id - String to check
 * @returns Object with type information
 *
 * @example
 * ```typescript
 * identifyIdType('decl:a1b2c3d4e5f6g7h8');
 * // { valid: true, type: 'declaration' }
 *
 * identifyIdType('loc:a1b2c3d4e5f6g7h8');
 * // { valid: true, type: 'location' }
 *
 * identifyIdType('invalid');
 * // { valid: false, type: 'unknown' }
 * ```
 */
function identifyIdType(id: string): {
  valid: boolean;
  type: 'declaration' | 'location' | 'unknown';
} {
  // Guard against null/undefined
  if (typeof id !== 'string') {
    return { valid: false, type: 'unknown' };
  }

  if (isDeclarationId(id)) {
    return { valid: true, type: 'declaration' };
  }

  // Use imported isLocationId instead of duplicating logic
  if (isLocationId(id)) {
    return { valid: true, type: 'location' };
  }

  return { valid: false, type: 'unknown' };
}
