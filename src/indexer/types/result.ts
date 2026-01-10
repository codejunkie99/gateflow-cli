/**
 * Result Types for SystemVerilog Indexer
 *
 * This module defines the output types from parsing operations.
 * When we parse a file, we get back a result containing all the
 * entities we found plus any errors encountered.
 *
 * @module types/result
 */

import type { FileRecord } from './file.js';
import type { Declaration } from './declaration.js';
import type { Reference } from './reference.js';
import type { Instance } from './instance.js';
import type { Directive } from './directive.js';
import type { ParseError } from './location.js';

// ============================================================================
// FileUnderstanderResult - Output from parsing a single file
// ============================================================================

/**
 * Complete result from parsing a single SystemVerilog file.
 *
 * This bundles everything we extracted from one file:
 * - File metadata (path, hash, line index)
 * - All declarations (modules, classes, etc.)
 * - All references (type usages, imports, etc.)
 * - All instances (module instantiations)
 * - All directives (`define, `include, etc.)
 * - Any parse errors encountered
 * - Statistics about what we found
 *
 * @example
 * ```typescript
 * const result = await understander.understand('/path/to/counter.sv');
 *
 * console.log(`Found ${result.declarations.length} declarations`);
 * console.log(`Found ${result.instances.length} instances`);
 *
 * if (result.errors.length > 0) {
 *   console.warn('Parse errors:', result.errors);
 * }
 *
 * // Get all modules in the file
 * const modules = result.declarations.filter(d => d.kind === 'module');
 * ```
 */
export interface FileUnderstanderResult {
  // -------------------------------------------------------------------------
  // File Metadata
  // -------------------------------------------------------------------------

  /**
   * Metadata about the parsed file.
   * Includes path, content hash, line index, etc.
   */
  file: FileRecord;

  // -------------------------------------------------------------------------
  // Extracted Entities
  // -------------------------------------------------------------------------

  /**
   * All declarations found in the file.
   *
   * Declarations are "birth certificates" - where things are DEFINED.
   * Includes: modules, packages, classes, functions, typedefs, ports, etc.
   */
  declarations: Declaration[];

  /**
   * All references found in the file.
   *
   * References are USAGES of things defined elsewhere.
   * Includes: type usages, imports, extends, macro usages, etc.
   */
  references: Reference[];

  /**
   * All instances found in the file.
   *
   * Instances are COPIES of modules/interfaces/checkers.
   * These form the design hierarchy.
   */
  instances: Instance[];

  /**
   * All preprocessor directives found in the file.
   *
   * Includes: `define, `include, `ifdef, `timescale, etc.
   */
  directives: Directive[];

  // -------------------------------------------------------------------------
  // Errors
  // -------------------------------------------------------------------------

  /**
   * Any errors or warnings encountered during parsing.
   *
   * The parser is resilient - it continues after errors.
   * Check this array to see what problems were found.
   */
  errors: ParseError[];

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /**
   * Statistics about parsing performance and results.
   */
  stats: ParseStats;
}

// ============================================================================
// ParseStats - Statistics from parsing
// ============================================================================

/**
 * Statistics about what was found during parsing.
 *
 * Useful for:
 * - Performance monitoring (parseTimeMs)
 * - Progress reporting (counts)
 * - Debugging
 */
export interface ParseStats {
  /** Time taken to parse the file (milliseconds) */
  parseTimeMs: number;

  /** Number of declarations found */
  declarationCount: number;

  /** Number of references found */
  referenceCount: number;

  /** Number of instances found */
  instanceCount: number;

  /** Number of directives found */
  directiveCount: number;
}

// ============================================================================
// SemanticIndex - Layer B semantic analysis results
// ============================================================================

/**
 * Results from semantic analysis (Layer B).
 *
 * This represents the output from slang or other semantic analyzers
 * that provide accurate resolution information not available from
 * syntactic parsing alone.
 *
 * @example
 * ```typescript
 * if (project.semantic) {
 *   console.log(`Semantic analysis from: ${project.semantic.source}`);
 *   console.log(`Resolved ${project.semantic.stats.resolvedCount} references`);
 * }
 * ```
 */
export interface SemanticIndex {
  /** Declarations found by semantic analysis */
  declarations: Declaration[];

  /** References with resolvedId populated */
  references: Reference[];

  /** Instances with resolvedId and evaluatedParams */
  instances: Instance[];

  /** Source of semantic analysis */
  source: 'slang' | 'verible' | 'regex';

  /** Analysis statistics */
  stats: {
    /** Time taken for analysis (milliseconds) */
    analysisTimeMs: number;

    /** Number of references that were resolved */
    resolvedCount: number;

    /** Number of references that couldn't be resolved */
    unresolvedCount: number;
  };
}

// ============================================================================
// ResolvedProject - All files connected together
// ============================================================================

/**
 * Complete project with all cross-file references resolved.
 *
 * After parsing all files individually, we resolve references
 * to connect everything together. This is the final result.
 *
 * @example
 * ```typescript
 * // First, parse all files
 * const results = await Promise.all(
 *   files.map(f => understander.understand(f))
 * );
 *
 * // Then resolve cross-file references
 * const project = resolver.resolve(results);
 *
 * // Now we have the complete picture
 * console.log(`${project.files.length} files`);
 * console.log(`${project.hierarchy.length} top-level modules`);
 * console.log(`${project.dependencies.length} file dependencies`);
 * ```
 */
export interface ResolvedProject {
  // -------------------------------------------------------------------------
  // All Files
  // -------------------------------------------------------------------------

  /** All file records in the project */
  files: FileRecord[];

  // -------------------------------------------------------------------------
  // All Entities (with resolution completed)
  // -------------------------------------------------------------------------

  /**
   * All declarations from all files.
   * No additional resolution needed for declarations.
   */
  declarations: Declaration[];

  /**
   * All references from all files.
   * The `resolvedId` field is now populated.
   */
  references: Reference[];

  /**
   * All instances from all files.
   * The `resolvedId` field is now populated.
   */
  instances: Instance[];

  /**
   * All directives from all files.
   * Include paths are resolved in `resolvedPath`.
   */
  directives: Directive[];

  // -------------------------------------------------------------------------
  // Computed Relationships
  // -------------------------------------------------------------------------

  /**
   * Module hierarchy tree.
   * Shows the instantiation tree starting from top modules.
   */
  hierarchy: HierarchyNode[];

  /**
   * File-to-file dependencies.
   * Shows which files depend on which other files.
   */
  dependencies: FileDependency[];

  // -------------------------------------------------------------------------
  // Semantic Analysis (Layer B)
  // -------------------------------------------------------------------------

  /**
   * Results from semantic analysis (Layer B).
   *
   * This is populated when slang or another semantic analyzer
   * has processed the project. It contains more accurate resolution
   * information than syntactic parsing alone.
   *
   * If undefined, only syntactic (Layer A) analysis was performed.
   */
  semantic?: SemanticIndex;

  /**
   * Whether semantic analysis (Layer B) was performed.
   *
   * This is a convenience flag - equivalent to checking `semantic !== undefined`.
   */
  hasSemanticAnalysis: boolean;
}

// ============================================================================
// HierarchyNode - Module hierarchy tree node
// ============================================================================

/**
 * A node in the module hierarchy tree.
 *
 * The hierarchy tree shows how modules are instantiated:
 * - Root nodes are top-level modules (nothing instantiates them)
 * - Children are instances inside the module
 *
 * @example
 * ```
 * top (root)
 * ├── u_cpu (cpu module)
 * │   ├── u_alu (alu module)
 * │   └── u_reg (register_file module)
 * └── u_mem (memory module)
 * ```
 *
 * ```typescript
 * const hierarchy: HierarchyNode = {
 *   instanceName: 'root',  // Synthetic name for top
 *   moduleName: 'top',
 *   moduleId: 'decl:abc123',
 *   file: '/path/top.sv',
 *   line: 5,
 *   children: [
 *     {
 *       instanceName: 'u_cpu',
 *       moduleName: 'cpu',
 *       moduleId: 'decl:def456',
 *       file: '/path/top.sv',
 *       line: 20,
 *       children: [...]
 *     },
 *     {
 *       instanceName: 'u_mem',
 *       moduleName: 'memory',
 *       ...
 *     }
 *   ]
 * };
 * ```
 */
export interface HierarchyNode {
  /**
   * Name of this instance.
   * For root nodes, this is typically "root" or the module name.
   */
  instanceName: string;

  /** Name of the module this instance represents */
  moduleName: string;

  /** Declaration ID of the module */
  moduleId: string;

  /** File where this instance is declared */
  file: string;

  /** Line number of the instantiation (or module decl for root) */
  line: number;

  /** Child instances within this module */
  children: HierarchyNode[];

  /** True if this node represents a cycle break point (module instantiates itself) */
  isCyclic?: boolean;
}

// ============================================================================
// FileDependency - File-to-file dependency
// ============================================================================

/**
 * Represents a dependency from one file to another.
 *
 * Dependencies tell us which files need which other files.
 * This is essential for:
 * - Determining compilation order
 * - Change propagation (if A changes, what else needs recompiling)
 * - Understanding code structure
 *
 * @example
 * ```typescript
 * // top.sv instantiates counter from counter.sv
 * const dep: FileDependency = {
 *   fromFile: '/path/top.sv',
 *   toFile: '/path/counter.sv',
 *   reason: 'instantiates',
 *   entityName: 'counter'
 * };
 *
 * // top.sv imports types from types_pkg.sv
 * const dep2: FileDependency = {
 *   fromFile: '/path/top.sv',
 *   toFile: '/path/types_pkg.sv',
 *   reason: 'imports',
 *   entityName: 'types_pkg'
 * };
 * ```
 */
export interface FileDependency {
  /** File that has the dependency (the "dependent") */
  fromFile: string;

  /** File that is depended upon (the "dependency") */
  toFile: string;

  /**
   * Why the dependency exists.
   *
   * - 'instantiates': fromFile instantiates a module from toFile
   * - 'imports': fromFile imports a package from toFile
   * - 'includes': fromFile `includes toFile
   * - 'extends': fromFile has a class that extends one from toFile
   * - 'uses_macro': fromFile uses a macro defined in toFile
   */
  reason: 'instantiates' | 'imports' | 'includes' | 'extends' | 'uses_macro';

  /**
   * Name of the entity causing the dependency.
   * e.g., module name, package name, included file path, class name, macro name
   */
  entityName: string;
}
