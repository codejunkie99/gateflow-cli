/**
 * Declaration Index Module
 *
 * Provides fast lookup of declarations by various keys:
 * - By ID (unique)
 * - By name (may have duplicates across files)
 * - By kind (module, class, etc.)
 * - By file (all declarations in a file)
 *
 * This is the central data structure for cross-file resolution.
 *
 * @module resolver/declaration-index
 */

import type { Declaration, DeclarationKind } from '../types/index.js';

// ============================================================================
// Declaration Index Class
// ============================================================================

/**
 * Index for fast declaration lookup.
 *
 * @example
 * ```typescript
 * const index = new DeclarationIndex();
 *
 * // Add declarations from parsed files
 * for (const decl of result.declarations) {
 *   index.add(decl);
 * }
 *
 * // Lookup by name
 * const counters = index.getByName('counter');
 *
 * // Lookup by kind
 * const modules = index.getByKind('module');
 *
 * // Find a specific module
 * const counter = index.getByNameAndKind('counter', 'module');
 * ```
 */
export class DeclarationIndex {
  /** Map from declaration ID to declaration */
  private byId: Map<string, Declaration> = new Map();

  /** Map from name to declarations (may have duplicates) */
  private byName: Map<string, Declaration[]> = new Map();

  /** Map from kind to declarations */
  private byKind: Map<DeclarationKind, Declaration[]> = new Map();

  /** Map from file path to declarations */
  private byFile: Map<string, Declaration[]> = new Map();

  /** Map from location ID to declaration */
  private byLocationId: Map<string, Declaration> = new Map();

  // --------------------------------------------------------------------------
  // Adding Declarations
  // --------------------------------------------------------------------------

  /**
   * Add a declaration to the index.
   *
   * @param decl - Declaration to add
   */
  add(decl: Declaration): void {
    // Index by ID
    this.byId.set(decl.id, decl);

    // Index by location ID
    this.byLocationId.set(decl.locationId, decl);

    // Index by name
    const byName = this.byName.get(decl.name) || [];
    byName.push(decl);
    this.byName.set(decl.name, byName);

    // Index by kind
    const byKind = this.byKind.get(decl.kind) || [];
    byKind.push(decl);
    this.byKind.set(decl.kind, byKind);

    // Index by file
    const file = decl.location.file;
    const byFile = this.byFile.get(file) || [];
    byFile.push(decl);
    this.byFile.set(file, byFile);
  }

  /**
   * Add multiple declarations to the index.
   *
   * @param declarations - Array of declarations to add
   */
  addAll(declarations: Declaration[]): void {
    for (const decl of declarations) {
      this.add(decl);
    }
  }

  // --------------------------------------------------------------------------
  // Lookup Methods
  // --------------------------------------------------------------------------

  /**
   * Get a declaration by its ID.
   *
   * @param id - Declaration ID
   * @returns Declaration, or undefined if not found
   */
  getById(id: string): Declaration | undefined {
    return this.byId.get(id);
  }

  /**
   * Get a declaration by its location ID.
   *
   * @param locationId - Location ID
   * @returns Declaration, or undefined if not found
   */
  getByLocationId(locationId: string): Declaration | undefined {
    return this.byLocationId.get(locationId);
  }

  /**
   * Get all declarations with a given name.
   *
   * @param name - Declaration name
   * @returns Array of declarations (may be empty)
   */
  getByName(name: string): Declaration[] {
    return this.byName.get(name) || [];
  }

  /**
   * Get a declaration by name and kind.
   *
   * Returns the first match if there are duplicates.
   *
   * @param name - Declaration name
   * @param kind - Declaration kind
   * @returns Declaration, or undefined if not found
   */
  getByNameAndKind(name: string, kind: DeclarationKind): Declaration | undefined {
    const candidates = this.byName.get(name) || [];
    return candidates.find((d) => d.kind === kind);
  }

  /**
   * Get all declarations by name and kind.
   *
   * @param name - Declaration name
   * @param kind - Declaration kind
   * @returns Array of matching declarations
   */
  getAllByNameAndKind(name: string, kind: DeclarationKind): Declaration[] {
    const candidates = this.byName.get(name) || [];
    return candidates.filter((d) => d.kind === kind);
  }

  /**
   * Get all declarations of a specific kind.
   *
   * @param kind - Declaration kind
   * @returns Array of declarations (may be empty)
   */
  getByKind(kind: DeclarationKind): Declaration[] {
    return this.byKind.get(kind) || [];
  }

  /**
   * Get all declarations in a specific file.
   *
   * @param file - File path
   * @returns Array of declarations (may be empty)
   */
  getByFile(file: string): Declaration[] {
    return this.byFile.get(file) || [];
  }

  // --------------------------------------------------------------------------
  // Query Methods
  // --------------------------------------------------------------------------

  /**
   * Find declarations matching a predicate.
   *
   * @param predicate - Function to test declarations
   * @returns Array of matching declarations
   */
  find(predicate: (decl: Declaration) => boolean): Declaration[] {
    const results: Declaration[] = [];
    for (const decl of this.byId.values()) {
      if (predicate(decl)) {
        results.push(decl);
      }
    }
    return results;
  }

  /**
   * Find the first declaration matching a predicate.
   *
   * @param predicate - Function to test declarations
   * @returns First matching declaration, or undefined
   */
  findFirst(predicate: (decl: Declaration) => boolean): Declaration | undefined {
    for (const decl of this.byId.values()) {
      if (predicate(decl)) {
        return decl;
      }
    }
    return undefined;
  }

  /**
   * Check if a declaration with the given ID exists.
   *
   * @param id - Declaration ID
   * @returns True if exists
   */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Check if any declaration with the given name exists.
   *
   * @param name - Declaration name
   * @returns True if exists
   */
  hasName(name: string): boolean {
    const decls = this.byName.get(name);
    return decls !== undefined && decls.length > 0;
  }

  // --------------------------------------------------------------------------
  // Scoped Lookup
  // --------------------------------------------------------------------------

  /**
   * Find a declaration by name within a specific scope.
   *
   * Searches from innermost to outermost scope.
   *
   * @param name - Declaration name
   * @param scope - Scope chain (e.g., ['my_pkg', 'my_class'])
   * @returns Declaration, or undefined if not found
   */
  getByNameInScope(name: string, scope: string[]): Declaration | undefined {
    const candidates = this.byName.get(name) || [];

    // Try to find in current scope first, then parent scopes
    for (let i = scope.length; i >= 0; i--) {
      const targetScope = scope.slice(0, i);

      const match = candidates.find((d) => scopesEqual(d.scope, targetScope));
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  /**
   * Get all declarations visible from a given scope.
   *
   * Includes declarations in the scope and all parent scopes.
   *
   * @param scope - Scope chain
   * @returns Array of visible declarations
   */
  getVisibleFrom(scope: string[]): Declaration[] {
    const visible: Declaration[] = [];

    for (const decl of this.byId.values()) {
      // Declaration is visible if its scope is a prefix of the target scope
      if (isPrefix(decl.scope, scope)) {
        visible.push(decl);
      }
    }

    return visible;
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Get the total number of declarations.
   */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Get statistics about the index.
   */
  getStats(): DeclarationIndexStats {
    const byKindCounts: Record<string, number> = {};
    for (const [kind, decls] of this.byKind.entries()) {
      byKindCounts[kind] = decls.length;
    }

    return {
      totalDeclarations: this.byId.size,
      uniqueNames: this.byName.size,
      fileCount: this.byFile.size,
      byKind: byKindCounts,
    };
  }

  // --------------------------------------------------------------------------
  // Iteration
  // --------------------------------------------------------------------------

  /**
   * Iterate over all declarations.
   */
  *[Symbol.iterator](): Iterator<Declaration> {
    yield* this.byId.values();
  }

  /**
   * Get all declarations as an array.
   */
  all(): Declaration[] {
    return Array.from(this.byId.values());
  }

  /**
   * Get all declaration IDs.
   */
  allIds(): string[] {
    return Array.from(this.byId.keys());
  }

  /**
   * Get all unique names.
   */
  allNames(): string[] {
    return Array.from(this.byName.keys());
  }

  /**
   * Get all files that have declarations.
   */
  allFiles(): string[] {
    return Array.from(this.byFile.keys());
  }

  // --------------------------------------------------------------------------
  // Clear
  // --------------------------------------------------------------------------

  /**
   * Clear all declarations from the index.
   */
  clear(): void {
    this.byId.clear();
    this.byLocationId.clear();
    this.byName.clear();
    this.byKind.clear();
    this.byFile.clear();
  }

  /**
   * Remove all declarations from a specific file.
   *
   * @param file - File path
   */
  removeFile(file: string): void {
    const decls = this.byFile.get(file) || [];

    for (const decl of decls) {
      // Remove from byId
      this.byId.delete(decl.id);

      // Remove from byLocationId
      this.byLocationId.delete(decl.locationId);

      // Remove from byName
      const byName = this.byName.get(decl.name);
      if (byName) {
        const idx = byName.indexOf(decl);
        if (idx >= 0) byName.splice(idx, 1);
        if (byName.length === 0) this.byName.delete(decl.name);
      }

      // Remove from byKind
      const byKind = this.byKind.get(decl.kind);
      if (byKind) {
        const idx = byKind.indexOf(decl);
        if (idx >= 0) byKind.splice(idx, 1);
        if (byKind.length === 0) this.byKind.delete(decl.kind);
      }
    }

    // Remove from byFile
    this.byFile.delete(file);
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Statistics about the declaration index.
 */
export interface DeclarationIndexStats {
  totalDeclarations: number;
  uniqueNames: number;
  fileCount: number;
  byKind: Record<string, number>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if two scopes are equal.
 */
function scopesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Check if array `prefix` is a prefix of array `arr`.
 */
function isPrefix(prefix: string[], arr: string[]): boolean {
  if (prefix.length > arr.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== arr[i]) return false;
  }
  return true;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new declaration index.
 *
 * @returns New DeclarationIndex instance
 */
export function createDeclarationIndex(): DeclarationIndex {
  return new DeclarationIndex();
}
