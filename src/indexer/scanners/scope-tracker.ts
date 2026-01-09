/**
 * Scope Tracker Module
 *
 * Tracks the current scope (nesting) during parsing.
 *
 * In SystemVerilog, entities are nested:
 * ```
 * package my_pkg;          // Enter package scope
 *   class driver;          // Enter class scope (inside package)
 *     function foo();      // Enter function scope (inside class)
 *     endfunction          // Exit function scope
 *   endclass               // Exit class scope
 * endpackage               // Exit package scope
 * ```
 *
 * The ScopeTracker maintains a stack of active scopes, allowing us to:
 * - Know what scope a declaration belongs to
 * - Build proper scope chains for declaration IDs
 * - Track parent-child relationships
 *
 * @module scanners/scope-tracker
 */

import type { DeclarationKind } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents an entry in the scope stack.
 */
export interface ScopeEntry {
  /** Kind of scope (module, class, function, etc.) */
  kind: DeclarationKind;
  /** Name of the scope */
  name: string;
  /** Declaration ID of this scope (if assigned) */
  id?: string;
  /** Line number where scope started */
  startLine: number;
  /** Additional data for the scope */
  data?: Record<string, unknown>;
}

/**
 * Guard condition for conditional compilation.
 */
export interface GuardCondition {
  /** Macro name in the condition */
  macro: string;
  /** Whether this is an ifndef (inverted condition) */
  inverted: boolean;
  /** Line where the guard started */
  startLine: number;
}

// ============================================================================
// Scope Tracker Class
// ============================================================================

/**
 * Options for configuring ScopeTracker behavior.
 */
export interface ScopeTrackerOptions {
  /** Whether to suppress scope mismatch warnings (default: false in dev, true in prod) */
  suppressWarnings?: boolean;
}

/**
 * Tracks the current scope during parsing.
 *
 * Usage:
 * ```typescript
 * const tracker = new ScopeTracker();
 *
 * // When entering a module
 * tracker.enter('module', 'counter', 10);
 *
 * // When finding a port inside the module
 * const scope = tracker.getScope();  // ['counter']
 * const parent = tracker.getParentId();  // ID of 'counter'
 *
 * // When exiting the module
 * tracker.exit('module');
 * ```
 */
export class ScopeTracker {
  /** Stack of active scopes */
  private stack: ScopeEntry[] = [];

  /** Stack of active ifdef guards */
  private guards: GuardCondition[] = [];

  /** Whether to suppress warnings */
  private suppressWarnings: boolean;

  constructor(options?: ScopeTrackerOptions) {
    // Suppress warnings in production by default
    this.suppressWarnings =
      options?.suppressWarnings ??
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production');
  }

  /**
   * Set whether to suppress scope mismatch warnings.
   *
   * @param suppress - True to suppress warnings
   */
  setSuppressWarnings(suppress: boolean): void {
    this.suppressWarnings = suppress;
  }

  // --------------------------------------------------------------------------
  // Scope Management
  // --------------------------------------------------------------------------

  /**
   * Enter a new scope.
   *
   * @param kind - Kind of scope being entered
   * @param name - Name of the scope
   * @param startLine - Line number where scope starts
   * @param id - Optional declaration ID for this scope
   * @param data - Optional additional data
   *
   * @example
   * ```typescript
   * // Entering a module
   * tracker.enter('module', 'counter', 5);
   *
   * // Entering a class inside the module
   * tracker.enter('class', 'my_class', 20);
   * ```
   */
  enter(
    kind: DeclarationKind,
    name: string,
    startLine: number,
    id?: string,
    data?: Record<string, unknown>
  ): void {
    this.stack.push({ kind, name, id, startLine, data });
  }

  /**
   * Exit the current scope.
   *
   * @param expectedKind - Optional kind to validate (for error detection)
   * @returns The exited scope entry, or undefined if stack was empty
   *
   * @example
   * ```typescript
   * // Exiting a module
   * const scope = tracker.exit('module');
   * console.log(scope.name);  // 'counter'
   *
   * // Exit with validation
   * tracker.exit('class');  // Would warn if current scope isn't a class
   * ```
   */
  exit(expectedKind?: DeclarationKind): ScopeEntry | undefined {
    const entry = this.stack.pop();

    // Optional validation (suppressed in production)
    if (expectedKind && entry && entry.kind !== expectedKind && !this.suppressWarnings) {
      console.warn(
        `Scope mismatch: expected ${expectedKind}, got ${entry.kind} (${entry.name})`
      );
    }

    return entry;
  }

  /**
   * Update the ID of the current scope.
   *
   * Call this after generating a declaration ID for the current scope.
   *
   * @param id - Declaration ID to assign
   */
  setCurrentId(id: string): void {
    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].id = id;
    }
  }

  // --------------------------------------------------------------------------
  // Scope Queries
  // --------------------------------------------------------------------------

  /**
   * Get the current scope chain (list of scope names).
   *
   * @returns Array of scope names from outermost to innermost
   *
   * @example
   * ```typescript
   * // Inside: package my_pkg > class driver > function foo
   * tracker.getScope();  // ['my_pkg', 'driver', 'foo']
   *
   * // At top level
   * tracker.getScope();  // []
   * ```
   */
  getScope(): string[] {
    return this.stack.map((s) => s.name);
  }

  /**
   * Get the parent scope (excluding current).
   *
   * Useful for determining what contains the current entity.
   *
   * @returns Array of parent scope names
   *
   * @example
   * ```typescript
   * // Inside: module counter > always_ff
   * tracker.getParentScope();  // ['counter']
   * ```
   */
  getParentScope(): string[] {
    return this.stack.slice(0, -1).map((s) => s.name);
  }

  /**
   * Get the declaration ID of the parent scope.
   *
   * @returns Parent's declaration ID, or undefined if at top level
   */
  getParentId(): string | undefined {
    if (this.stack.length === 0) {
      return undefined;
    }
    return this.stack[this.stack.length - 1].id;
  }

  /**
   * Get the current scope entry.
   *
   * @returns Current scope entry, or undefined if at top level
   */
  getCurrent(): ScopeEntry | undefined {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined;
  }

  /**
   * Get the current scope kind.
   *
   * @returns Current scope kind, or undefined if at top level
   */
  getCurrentKind(): DeclarationKind | undefined {
    return this.getCurrent()?.kind;
  }

  /**
   * Get the current scope name.
   *
   * @returns Current scope name, or undefined if at top level
   */
  getCurrentName(): string | undefined {
    return this.getCurrent()?.name;
  }

  /**
   * Get the depth of the scope stack.
   *
   * @returns Number of active scopes
   */
  getDepth(): number {
    return this.stack.length;
  }

  /**
   * Check if currently at top level (no active scopes).
   *
   * @returns True if at top level
   */
  isAtTopLevel(): boolean {
    return this.stack.length === 0;
  }

  /**
   * Check if currently inside a specific scope kind.
   *
   * @param kind - Scope kind to check for
   * @returns True if inside that kind of scope
   *
   * @example
   * ```typescript
   * // Inside a class
   * tracker.isInside('class');  // true
   * tracker.isInside('module');  // maybe true (class could be in module)
   * ```
   */
  isInside(kind: DeclarationKind): boolean {
    return this.stack.some((s) => s.kind === kind);
  }

  /**
   * Find the nearest enclosing scope of a specific kind.
   *
   * @param kind - Scope kind to find
   * @returns The scope entry, or undefined if not found
   *
   * @example
   * ```typescript
   * // Inside: module top > always_ff > if block
   * const mod = tracker.findEnclosing('module');
   * console.log(mod.name);  // 'top'
   * ```
   */
  findEnclosing(kind: DeclarationKind): ScopeEntry | undefined {
    // Search from innermost to outermost
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].kind === kind) {
        return this.stack[i];
      }
    }
    return undefined;
  }

  // --------------------------------------------------------------------------
  // Guard (ifdef) Management
  // --------------------------------------------------------------------------

  /**
   * Push a new ifdef/ifndef guard condition.
   *
   * @param macro - Macro name being checked
   * @param inverted - True for ifndef (inverted condition)
   * @param startLine - Line where guard started
   */
  pushGuard(macro: string, inverted: boolean, startLine: number): void {
    this.guards.push({ macro, inverted, startLine });
  }

  /**
   * Pop the current guard condition.
   *
   * @returns The popped guard, or undefined if no guards active
   */
  popGuard(): GuardCondition | undefined {
    return this.guards.pop();
  }

  /**
   * Get the current guard condition.
   *
   * Returns a combined condition string representing all active guards.
   *
   * @returns Guard condition string, or undefined if no guards active
   *
   * @example
   * ```typescript
   * // Inside: `ifdef A > `ifndef B
   * tracker.getGuard();  // 'A && !B'
   *
   * // No guards
   * tracker.getGuard();  // undefined
   * ```
   */
  getGuard(): { condition: string; inverted: boolean } | undefined {
    if (this.guards.length === 0) {
      return undefined;
    }

    // Build combined condition
    const parts = this.guards.map((g) => (g.inverted ? `!${g.macro}` : g.macro));
    const condition = parts.join(' && ');

    // Consider inverted if the innermost guard is inverted
    const inverted = this.guards[this.guards.length - 1].inverted;

    return { condition, inverted };
  }

  /**
   * Check if any guards are active.
   *
   * @returns True if inside an ifdef/ifndef block
   */
  hasGuard(): boolean {
    return this.guards.length > 0;
  }

  /**
   * Get the depth of the guard stack.
   *
   * @returns Number of active guards
   */
  getGuardDepth(): number {
    return this.guards.length;
  }

  // --------------------------------------------------------------------------
  // Reset
  // --------------------------------------------------------------------------

  /**
   * Reset the tracker to initial state.
   *
   * Call this before parsing a new file.
   */
  reset(): void {
    this.stack = [];
    this.guards = [];
  }

  // --------------------------------------------------------------------------
  // Debug
  // --------------------------------------------------------------------------

  /**
   * Get a debug representation of current state.
   *
   * @returns String showing current scope and guard state
   */
  debug(): string {
    const scopeStr =
      this.stack.length > 0
        ? this.stack.map((s) => `${s.kind}:${s.name}`).join(' > ')
        : '(top level)';

    const guardStr =
      this.guards.length > 0
        ? this.guards.map((g) => (g.inverted ? `!${g.macro}` : g.macro)).join(' && ')
        : '(no guards)';

    return `Scope: ${scopeStr}\nGuards: ${guardStr}`;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new scope tracker.
 *
 * @returns Fresh ScopeTracker instance
 */
export function createScopeTracker(): ScopeTracker {
  return new ScopeTracker();
}

// ============================================================================
// Scope Lookup Utilities
// ============================================================================

/**
 * Scope range representing where a scope is active.
 */
export interface ScopeRange {
  /** Scope name (e.g., module name) */
  name: string;
  /** Start line (1-based, inclusive) */
  startLine: number;
  /** End line (1-based, inclusive) - 0 means EOF/unknown */
  endLine: number;
  /** Kind of scope */
  kind: string;
}

/**
 * A function that looks up the scope for a given line number.
 */
export type ScopeLookup = (line: number) => string[];

/**
 * Build a scope lookup function from declarations.
 *
 * This creates a fast lookup that returns the scope chain for any line number.
 * Uses the declarations' start lines and endLine data (if available) to
 * determine scope boundaries.
 *
 * @param declarations - Array of declarations to build scope from
 * @returns Function that takes a line number and returns scope chain
 *
 * @example
 * ```typescript
 * const lookup = buildScopeLookup(declarations);
 *
 * // Get scope at line 50
 * const scope = lookup(50);  // ['my_module'] if line 50 is inside my_module
 * ```
 */
export function buildScopeLookup(
  declarations: Array<{
    kind: string;
    name: string;
    location: { line: number };
    data?: unknown;
  }>
): ScopeLookup {
  // Build scope ranges from scope-defining declarations
  const scopeKinds = new Set([
    'module', 'interface', 'package', 'class', 'program', 'checker',
    'function', 'task', 'generate', 'covergroup', 'clocking',
  ]);

  const ranges: ScopeRange[] = [];

  for (const decl of declarations) {
    if (!scopeKinds.has(decl.kind)) continue;

    // Extract endLine from data if available (data is unknown, so we cast safely)
    const data = decl.data as { endLine?: number } | undefined;
    const endLine = typeof data?.endLine === 'number' ? data.endLine : 0;

    ranges.push({
      name: decl.name,
      kind: decl.kind,
      startLine: decl.location.line,
      endLine,
    });
  }

  // Sort by start line for binary search
  ranges.sort((a, b) => a.startLine - b.startLine);

  // Return the lookup function
  return (line: number): string[] => {
    const scope: string[] = [];

    for (const range of ranges) {
      // If this scope starts after our line, it can't contain us
      if (range.startLine > line) continue;

      // If we have an end line, check if we're within it
      if (range.endLine > 0 && range.endLine < line) continue;

      // If no end line, use heuristic: scope extends to next scope start of same level
      // For now, we only include scopes that definitely contain this line
      if (range.endLine === 0) {
        // Without end line, we can only be sure about immediate containment
        // This is a limitation - properly tracking end lines would be better
        scope.push(range.name);
      } else {
        scope.push(range.name);
      }
    }

    return scope;
  };
}

/**
 * Build scope ranges from declarations (alternative to lookup function).
 *
 * Returns the raw ranges for custom processing.
 *
 * @param declarations - Array of declarations
 * @returns Array of scope ranges
 */
export function buildScopeRanges(
  declarations: Array<{
    kind: string;
    name: string;
    location: { line: number };
    data?: unknown;
  }>
): ScopeRange[] {
  const scopeKinds = new Set([
    'module', 'interface', 'package', 'class', 'program', 'checker',
    'function', 'task', 'generate', 'covergroup', 'clocking',
  ]);

  const ranges: ScopeRange[] = [];

  for (const decl of declarations) {
    if (!scopeKinds.has(decl.kind)) continue;

    // Extract endLine from data if available (data is unknown, so we cast safely)
    const data = decl.data as { endLine?: number } | undefined;
    const endLine = typeof data?.endLine === 'number' ? data.endLine : 0;

    ranges.push({
      name: decl.name,
      kind: decl.kind,
      startLine: decl.location.line,
      endLine,
    });
  }

  return ranges.sort((a, b) => a.startLine - b.startLine);
}
