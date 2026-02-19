/**
 * Macro Index Module
 *
 * Provides fast lookup of macro definitions (define directives) by name.
 * Similar to DeclarationIndex but for preprocessor macros.
 *
 * This enables:
 * - Resolving macro_usage references to their definitions
 * - Building file dependencies based on macro usage
 * - Finding all macros defined in a file
 *
 * @module resolver/macro-index
 */

import type { Directive } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a macro definition extracted from a `define directive.
 */
interface MacroDefinition {
  /** Macro name */
  name: string;
  /** File where the macro is defined */
  file: string;
  /** Line number of the definition */
  line: number;
  /** Parameters for function-like macros */
  params?: string[];
  /** Macro body/replacement text */
  body: string;
  /**
   * Original directive ID (declaration ID format: "decl:...")
   * Computed from file + 'macro' + name, enabling cross-file macro lookup.
   */
  directiveId: string;
}

// ============================================================================
// MacroIndex Class
// ============================================================================

/**
 * Index for fast lookup of macro definitions.
 *
 * @example
 * ```typescript
 * const macroIndex = new MacroIndex();
 *
 * // Add directives from parsed files
 * for (const directive of directives) {
 *   macroIndex.add(directive);
 * }
 *
 * // Look up a macro by name
 * const defs = macroIndex.getByName('WIDTH');
 * if (defs.length > 0) {
 *   console.log(`WIDTH defined in ${defs[0].file}`);
 * }
 * ```
 */
export class MacroIndex {
  /** Map from macro name to definitions (may have multiple across files) */
  private byName: Map<string, MacroDefinition[]> = new Map();

  /** Map from file path to macros defined in that file */
  private byFile: Map<string, MacroDefinition[]> = new Map();

  /** Map from directive ID to macro definition */
  private byId: Map<string, MacroDefinition> = new Map();

  // --------------------------------------------------------------------------
  // Adding Macros
  // --------------------------------------------------------------------------

  /**
   * Add a directive if it's a define.
   *
   * @param directive - Directive to potentially add
   */
  add(directive: Directive): void {
    if (directive.data.kind !== 'define') return;

    const data = directive.data;
    const def: MacroDefinition = {
      name: data.name,
      file: directive.location.file,
      line: directive.location.line,
      params: data.params,
      body: data.body || '',
      directiveId: directive.id,
    };

    // Index by name
    const byName = this.byName.get(data.name) || [];
    byName.push(def);
    this.byName.set(data.name, byName);

    // Index by file
    const byFile = this.byFile.get(directive.location.file) || [];
    byFile.push(def);
    this.byFile.set(directive.location.file, byFile);

    // Index by ID
    this.byId.set(directive.id, def);
  }

  /**
   * Add multiple directives.
   *
   * @param directives - Array of directives to potentially add
   */
  addAll(directives: Directive[]): void {
    for (const dir of directives) {
      this.add(dir);
    }
  }

  // --------------------------------------------------------------------------
  // Lookup Methods
  // --------------------------------------------------------------------------

  /**
   * Get all definitions of a macro by name.
   *
   * @param name - Macro name
   * @returns Array of macro definitions (may be empty)
   */
  getByName(name: string): MacroDefinition[] {
    return this.byName.get(name) || [];
  }

  /**
   * Get the first definition of a macro by name.
   *
   * Useful when you expect a single definition or just need any definition.
   *
   * @param name - Macro name
   * @returns First macro definition, or undefined if not found
   */
  getFirstByName(name: string): MacroDefinition | undefined {
    const defs = this.byName.get(name);
    return defs && defs.length > 0 ? defs[0] : undefined;
  }

  /**
   * Get a macro definition by its directive ID.
   *
   * @param id - Directive ID
   * @returns Macro definition, or undefined if not found
   */
  getById(id: string): MacroDefinition | undefined {
    return this.byId.get(id);
  }

  /**
   * Get all macros defined in a file.
   *
   * @param file - File path
   * @returns Array of macro definitions (may be empty)
   */
  getByFile(file: string): MacroDefinition[] {
    return this.byFile.get(file) || [];
  }

  /**
   * Check if a macro is defined.
   *
   * @param name - Macro name
   * @returns True if at least one definition exists
   */
  has(name: string): boolean {
    return this.byName.has(name) && this.byName.get(name)!.length > 0;
  }

  /**
   * Get all macro names.
   *
   * @returns Array of all defined macro names
   */
  getAllNames(): string[] {
    return Array.from(this.byName.keys());
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Get the number of unique macro names.
   */
  get size(): number {
    return this.byName.size;
  }

  /**
   * Get the total number of macro definitions (including duplicates).
   */
  get totalDefinitions(): number {
    let count = 0;
    for (const defs of this.byName.values()) {
      count += defs.length;
    }
    return count;
  }

  /**
   * Get the number of files with macro definitions.
   */
  get fileCount(): number {
    return this.byFile.size;
  }

  // --------------------------------------------------------------------------
  // Reset
  // --------------------------------------------------------------------------

  /**
   * Clear all indexed macros.
   */
  clear(): void {
    this.byName.clear();
    this.byFile.clear();
    this.byId.clear();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new macro index.
 *
 * @param directives - Optional initial directives to add
 * @returns New MacroIndex instance
 */
function createMacroIndex(directives?: Directive[]): MacroIndex {
  const index = new MacroIndex();
  if (directives) {
    index.addAll(directives);
  }
  return index;
}
