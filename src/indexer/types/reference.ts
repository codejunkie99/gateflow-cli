/**
 * Reference Types for SystemVerilog Indexer
 *
 * A REFERENCE is when something USES or MENTIONS something else.
 * Unlike declarations (which CREATE things), references POINT TO
 * things that already exist.
 *
 * Examples of references:
 * - `byte_t data;`  -> References the typedef "byte_t"
 * - `import pkg::*;`  -> References the package "pkg"
 * - `extends BaseClass`  -> References the class "BaseClass"
 *
 * References are important for:
 * - "Find all references" feature
 * - Dependency tracking
 * - Rename refactoring
 *
 * @module types/reference
 */

import type { Location, Guard } from './location.js';

// ============================================================================
// ReferenceKind - What type of reference
// ============================================================================

/**
 * All possible kinds of references in SystemVerilog.
 *
 * Each kind represents a different way something can be used:
 *
 * **Type References:**
 * - type_usage: Using a type name (e.g., `byte_t data;`)
 *
 * **Preprocessor References:**
 * - macro_usage: Using a macro (e.g., `` `WIDTH ``)
 *
 * **Call References:**
 * - func_call: Calling a function
 * - task_call: Calling a task
 * - dpi_call: Calling a DPI-imported function
 *
 * **Structural References:**
 * - extends: Class inheritance
 * - import: Package import
 * - port_conn: Port connection in instantiation
 * - signal_usage: Using a signal in an expression
 *
 * **Assertion References:**
 * - assert_usage: Using a property in assert statement
 * - assume_usage: Using a property in assume statement
 * - cover_usage: Using a property in cover statement
 * - sequence_usage: Using a sequence in another sequence/property
 *
 * **Timing References:**
 * - clocking_usage: Accessing signals through clocking block
 */
export type ReferenceKind =
  // Type references
  | 'type_usage'

  // Preprocessor references
  | 'macro_usage'

  // Call references
  | 'func_call'
  | 'task_call'
  | 'dpi_call'

  // Structural references
  | 'extends'
  | 'import'
  | 'port_conn'
  | 'signal_usage'

  // Assertion references
  | 'assert_usage'
  | 'assume_usage'
  | 'cover_usage'
  | 'sequence_usage'

  // Timing references
  | 'clocking_usage';

// ============================================================================
// Reference - A usage of something declared elsewhere
// ============================================================================

/**
 * A reference represents where something is USED in the code.
 *
 * References point to declarations but don't define anything new.
 * They're the "arrows" in our code graph that connect usages to definitions.
 *
 * @example
 * ```typescript
 * // For: import my_pkg::*;
 * const importRef: Reference = {
 *   id: 'loc:abc123',
 *   kind: 'import',
 *   targetName: 'my_pkg',
 *   location: { file: '/path/file.sv', line: 5, col: 8 },
 *   scope: ['my_module'],
 *   data: { kind: 'import', memberName: '*' }
 * };
 *
 * // For: byte_t data;  (using a typedef)
 * const typeRef: Reference = {
 *   id: 'loc:def456',
 *   kind: 'type_usage',
 *   targetName: 'byte_t',
 *   location: { file: '/path/file.sv', line: 10, col: 3 },
 *   scope: ['my_module']
 *   // No extra data for simple type usage
 * };
 * ```
 */
export interface Reference {
  // -------------------------------------------------------------------------
  // ID - Location identifier
  // -------------------------------------------------------------------------

  /**
   * Location ID - Identifies WHERE this reference is.
   * Format: "loc:<16-char-hash>"
   *
   * Computed from: file + line + col
   *
   * Note: References only have location IDs, not declaration IDs,
   * because they don't create new things - they point to existing things.
   */
  id: string;

  // -------------------------------------------------------------------------
  // What - What kind of reference and what it points to
  // -------------------------------------------------------------------------

  /** What kind of reference (import, type usage, etc.) */
  kind: ReferenceKind;

  /**
   * Name being referenced (unresolved).
   *
   * This is the raw name as it appears in the code.
   * Resolution to actual declaration happens later.
   *
   * Examples:
   * - For `import pkg::*` -> targetName = "pkg"
   * - For `byte_t data` -> targetName = "byte_t"
   * - For `extends Base` -> targetName = "Base"
   */
  targetName: string;

  // -------------------------------------------------------------------------
  // Where - Location in source code
  // -------------------------------------------------------------------------

  /** File, line, and column where reference appears */
  location: Location;

  /**
   * Scope chain where this reference appears.
   * Important for name resolution - we search inner to outer.
   */
  scope: string[];

  // -------------------------------------------------------------------------
  // Resolution - Filled in later
  // -------------------------------------------------------------------------

  /**
   * Declaration ID this reference resolves to.
   *
   * This is NOT filled in during initial parsing.
   * It's populated during the resolution phase when we
   * connect references to their declarations.
   */
  resolvedId?: string;

  // -------------------------------------------------------------------------
  // Conditional Compilation
  // -------------------------------------------------------------------------

  /**
   * If this reference is inside an `ifdef/`ifndef block,
   * this records the condition.
   */
  guard?: Guard;

  // -------------------------------------------------------------------------
  // Kind-Specific Data
  // -------------------------------------------------------------------------

  /**
   * Additional data specific to the reference kind.
   * Only present for kinds that need extra information.
   */
  data?: ReferenceData;
}

// ============================================================================
// ReferenceData - Kind-specific additional information
// ============================================================================

/**
 * Discriminated union of reference-specific data.
 *
 * Most references don't need extra data - just the targetName.
 * But some kinds have additional information:
 * - import: which member is being imported
 * - port_conn: which port is being connected
 * - extends: (just a marker, no extra data)
 */
export type ReferenceData =
  | ImportReferenceData
  | PortConnReferenceData
  | ExtendsReferenceData;

/**
 * Extra data for import references.
 *
 * @example
 * ```typescript
 * // For: import pkg::func_name;
 * { kind: 'import', memberName: 'func_name' }
 *
 * // For: import pkg::*;
 * { kind: 'import', memberName: '*' }
 * ```
 */
export interface ImportReferenceData {
  kind: 'import';
  /**
   * The specific member being imported, or "*" for wildcard.
   * - "func_name" for `import pkg::func_name`
   * - "*" for `import pkg::*`
   */
  memberName?: string;
}

/**
 * Extra data for port connection references.
 *
 * Port connections happen in module instantiations:
 * ```systemverilog
 * counter u_cnt (.clk(clock), .data(my_data));
 * //             ^^^^ port   ^^^^^ signal
 * ```
 *
 * @example
 * ```typescript
 * // For: .clk(clock)
 * { kind: 'port_conn', portName: 'clk' }
 * // targetName would be 'clock' (the signal being connected)
 * ```
 */
export interface PortConnReferenceData {
  kind: 'port_conn';
  /** Name of the port being connected to */
  portName: string;
}

/**
 * Marker data for class extension references.
 *
 * @example
 * ```typescript
 * // For: class MyClass extends BaseClass;
 * { kind: 'extends' }
 * // targetName would be 'BaseClass'
 * ```
 */
export interface ExtendsReferenceData {
  kind: 'extends';
  // No extra data needed - targetName has the parent class name
}
