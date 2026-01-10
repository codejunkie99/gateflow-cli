/**
 * Scanners Module - Extract Entities from SystemVerilog Code
 *
 * This module contains all the scanners that extract different types
 * of entities from preprocessed SystemVerilog code.
 *
 * ## Scanner Types
 *
 * ### Directive Scanner
 * Extracts preprocessor directives:
 * - Macros: `define, `undef
 * - Includes: `include
 * - Conditionals: `ifdef, `ifndef, `elsif, `else, `endif
 * - Compiler: `timescale, `default_nettype, `pragma
 * - DPI: import/export "DPI-C"
 *
 * ### Declaration Scanner
 * Extracts declarations (where things are defined):
 * - Containers: module, package, interface, class, program, checker
 * - Functions: function, task
 * - Types: typedef, struct, union, enum
 * - Ports/Signals: port, parameter, signal
 * - SVA: sequence, property
 * - Coverage: covergroup, constraint
 * - Blocks: clocking, always, initial
 *
 * ### Reference Scanner
 * Extracts references (where things are used):
 * - Imports: import package::*
 * - Type usages: pkg::type_t
 * - Macro usages: `MACRO
 * - Assertions: assert/assume/cover property
 *
 * ### Instance Scanner
 * Extracts instantiations:
 * - Module instances: counter u_cnt(...)
 * - Array instances: counter u_cnt[7:0](...)
 * - Bind statements: bind cpu checker u_chk(...)
 *
 * ## Supporting Components
 *
 * ### Patterns
 * All regex patterns for matching SV constructs.
 *
 * ### Scope Tracker
 * Tracks nesting (which module/class/function we're inside).
 *
 * @example
 * ```typescript
 * import {
 *   scanDirectives,
 *   scanDeclarations,
 *   scanReferences,
 *   scanInstances,
 *   ScopeTracker
 * } from './scanners/index.js';
 *
 * // Create scope tracker for directive scanning
 * const scopeTracker = new ScopeTracker();
 *
 * // Scan directives first (to track ifdef state)
 * const { directives, ifdefState } = scanDirectives(
 *   content, filePath, lineOffsets, scopeTracker
 * );
 *
 * // Scan declarations
 * const { declarations } = scanDeclarations(content, filePath, lineOffsets);
 *
 * // Scan references (needs declarations for context)
 * const { references } = scanReferences(
 *   content, filePath, lineOffsets, declarations
 * );
 *
 * // Scan instances (needs declarations for validation)
 * const { instances } = scanInstances(
 *   content, filePath, lineOffsets, declarations
 * );
 * ```
 *
 * @module scanners
 */

// ============================================================================
// Patterns
// ============================================================================

export {
  DIRECTIVE_PATTERNS,
  DPI_PATTERNS,
  DECLARATION_PATTERNS,
  REFERENCE_PATTERNS,
  INSTANCE_PATTERNS,
  STRUCTURE_PATTERNS,
  resetPatterns,
  copyPattern,
} from './patterns.js';

// ============================================================================
// Scope Tracker
// ============================================================================

export {
  ScopeTracker,
  createScopeTracker,
  buildScopeLookup,
  buildScopeRanges,
  buildGuardLookup,
  type ScopeEntry,
  type GuardCondition,
  type ScopeTrackerOptions,
  type ScopeRange,
  type ScopeLookup,
  type GuardLookup,
  type IfdefState,
} from './scope-tracker.js';

// ============================================================================
// Directive Scanner
// ============================================================================

export {
  scanDirectives,
  type DirectiveScanResult,
} from './directive-scanner.js';

// ============================================================================
// Declaration Scanner
// ============================================================================

export {
  scanDeclarations,
  type DeclarationScanResult,
} from './declaration-scanner.js';

// ============================================================================
// Reference Scanner
// ============================================================================

export {
  scanReferences,
  isBuiltinType,
  isKeyword,
  type ReferenceScanResult,
} from './reference-scanner.js';

// ============================================================================
// Instance Scanner
// ============================================================================

export {
  scanInstances,
  type InstanceScanResult,
} from './instance-scanner.js';
