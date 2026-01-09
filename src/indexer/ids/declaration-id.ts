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

import crypto from 'crypto';

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
 * Using '::' to match SystemVerilog's scope resolution operator.
 */
const SCOPE_SEPARATOR = '::';

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
 * @param file - Absolute file path where declaration appears
 * @param kind - Kind of declaration (module, class, function, etc.)
 * @param name - Name of the declared entity
 * @param scope - Scope chain (e.g., ['package_name', 'class_name'])
 * @returns Declaration ID in format "decl:abcdef1234567890"
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
  // Join scope components with separator
  // Empty scope becomes empty string
  const scopeStr = scope.join(SCOPE_SEPARATOR);

  // Build the input string that uniquely identifies this declaration
  // Format: "file:kind:name:scope"
  // Using colon as field separator (unlikely in names)
  const input = `${file}:${kind}:${name}:${scopeStr}`;

  // Hash with SHA-256 for good distribution
  const hash = crypto
    .createHash('sha256')
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
export function extractDeclarationHash(id: string): string | null {
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
export function identifyIdType(id: string): {
  valid: boolean;
  type: 'declaration' | 'location' | 'unknown';
} {
  if (isDeclarationId(id)) {
    return { valid: true, type: 'declaration' };
  }

  // Check for location ID format
  if (id.startsWith('loc:') && id.length === 4 + HASH_LENGTH) {
    const hash = id.slice(4);
    if (/^[0-9a-f]+$/.test(hash)) {
      return { valid: true, type: 'location' };
    }
  }

  return { valid: false, type: 'unknown' };
}
