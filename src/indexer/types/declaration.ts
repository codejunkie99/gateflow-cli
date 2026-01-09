/**
 * Declaration Types for SystemVerilog Indexer
 *
 * A DECLARATION is like a "birth certificate" - it's where something
 * NEW is defined/created in the code. This module defines all the
 * types of declarations we can find in SystemVerilog.
 *
 * Examples of declarations:
 * - `module counter;`  -> Declares a new module named "counter"
 * - `typedef logic [7:0] byte_t;`  -> Declares a new type named "byte_t"
 * - `function int calc();`  -> Declares a new function named "calc"
 *
 * @module types/declaration
 */

import type { Location, Guard } from './location.js';

// ============================================================================
// DeclarationKind - What type of thing was declared
// ============================================================================

/**
 * All possible kinds of declarations in SystemVerilog.
 *
 * Grouped by category:
 *
 * **Design Units (top-level constructs):**
 * - module, package, interface, class, program, config
 *
 * **Behavioral Constructs:**
 * - function, task
 *
 * **Type Declarations:**
 * - typedef, struct, union, enum, enum_value
 *
 * **Data Declarations:**
 * - port, parameter, localparam, signal
 *
 * **Interface Constructs:**
 * - modport
 *
 * **Assertion Constructs:**
 * - sequence, property
 *
 * **Verification Constructs:**
 * - covergroup, constraint
 *
 * **Timing Constructs:**
 * - clocking, checker
 *
 * **Procedural Blocks:**
 * - generate_block, always_block, initial_block
 */
export type DeclarationKind =
  // Design units (top-level constructs)
  | 'module'
  | 'package'
  | 'interface'
  | 'class'
  | 'program'
  | 'config'

  // Behavioral constructs
  | 'function'
  | 'task'

  // Type declarations
  | 'typedef'
  | 'struct'
  | 'union'
  | 'enum'
  | 'enum_value'

  // Data declarations
  | 'port'
  | 'parameter'
  | 'localparam'
  | 'signal'

  // Interface constructs
  | 'modport'

  // Assertion constructs (SVA)
  | 'sequence'
  | 'property'

  // Verification constructs
  | 'covergroup'
  | 'constraint'

  // Timing constructs
  | 'clocking'
  | 'checker'

  // Procedural blocks
  | 'generate_block'
  | 'always_block'
  | 'initial_block';

// ============================================================================
// Declaration - The main declaration type
// ============================================================================

/**
 * A declaration represents where something is DEFINED in the code.
 *
 * Every declaration has:
 * - Two IDs: declaration ID (unique identity) and location ID (where it is)
 * - Kind: what type of declaration
 * - Name: what it's called
 * - Location: file/line/col
 * - Scope: what contains it (e.g., module name, package name)
 * - Optional guard: which `ifdef block it's inside
 * - Kind-specific data: additional details based on the kind
 *
 * @example
 * ```typescript
 * // A module declaration
 * const moduleDecl: Declaration = {
 *   id: 'decl:abc123',
 *   locationId: 'loc:xyz789',
 *   kind: 'module',
 *   name: 'counter',
 *   location: { file: '/path/counter.sv', line: 5, col: 1 },
 *   scope: [],  // Top-level, no parent
 *   data: { kind: 'module', params: [] }
 * };
 *
 * // A port inside that module
 * const portDecl: Declaration = {
 *   id: 'decl:def456',
 *   locationId: 'loc:uvw123',
 *   kind: 'port',
 *   name: 'clk',
 *   location: { file: '/path/counter.sv', line: 10, col: 3 },
 *   scope: ['counter'],  // Inside module "counter"
 *   parentId: 'decl:abc123',  // Parent is the module
 *   data: { kind: 'port', direction: 'input', portType: 'logic' }
 * };
 * ```
 */
export interface Declaration {
  // -------------------------------------------------------------------------
  // IDs - Two different identifiers for different purposes
  // -------------------------------------------------------------------------

  /**
   * Declaration ID - Uniquely identifies THIS declaration.
   * Format: "decl:<16-char-hash>"
   *
   * Computed from: file + kind + name + scope
   *
   * Used for:
   * - Cross-file references (instances point to declarations)
   * - Database primary key
   * - Deduplication
   */
  id: string;

  /**
   * Location ID - Identifies WHERE this declaration is.
   * Format: "loc:<16-char-hash>"
   *
   * Computed from: file + line + col
   *
   * Used for:
   * - Finding multiple things at same location
   * - Jump-to-location features
   */
  locationId: string;

  // -------------------------------------------------------------------------
  // What - What is being declared
  // -------------------------------------------------------------------------

  /** What type of declaration (module, class, function, etc.) */
  kind: DeclarationKind;

  /** Name of the declared entity */
  name: string;

  // -------------------------------------------------------------------------
  // Where - Location in source code
  // -------------------------------------------------------------------------

  /** File, line, and column where declaration appears */
  location: Location;

  // -------------------------------------------------------------------------
  // Scope - Containment hierarchy
  // -------------------------------------------------------------------------

  /**
   * Scope chain - list of containing scopes from outermost to innermost.
   *
   * Examples:
   * - []                  -> Top-level (module, package)
   * - ['my_pkg']          -> Inside package "my_pkg"
   * - ['my_pkg', 'MyClass'] -> Inside class "MyClass" in package "my_pkg"
   */
  scope: string[];

  /**
   * Declaration ID of the immediate parent scope.
   * Undefined for top-level declarations.
   */
  parentId?: string;

  // -------------------------------------------------------------------------
  // Conditional Compilation
  // -------------------------------------------------------------------------

  /**
   * If this declaration is inside an `ifdef/`ifndef block,
   * this records the condition.
   */
  guard?: Guard;

  // -------------------------------------------------------------------------
  // Kind-Specific Data
  // -------------------------------------------------------------------------

  /**
   * Additional data specific to the declaration kind.
   * This is a discriminated union - check data.kind to narrow the type.
   */
  data: DeclarationData;
}

// ============================================================================
// DeclarationData - Kind-specific additional information
// ============================================================================

/**
 * Discriminated union of all declaration-specific data.
 *
 * Each kind has its own shape with relevant information:
 * - Modules have parameters
 * - Functions have return types and arguments
 * - Ports have direction and type
 * - etc.
 *
 * @example
 * ```typescript
 * function processDeclaration(decl: Declaration) {
 *   switch (decl.data.kind) {
 *     case 'module':
 *       console.log('Module params:', decl.data.params);
 *       break;
 *     case 'function':
 *       console.log('Returns:', decl.data.returnType);
 *       break;
 *     case 'port':
 *       console.log('Direction:', decl.data.direction);
 *       break;
 *   }
 * }
 * ```
 */
export type DeclarationData =
  // Design units
  | ModuleData
  | PackageData
  | InterfaceData
  | ClassData
  | ProgramData
  | ConfigData

  // Behavioral
  | FunctionData
  | TaskData

  // Types
  | TypedefData
  | StructData
  | UnionData
  | EnumData
  | EnumValueData

  // Data
  | PortData
  | ParameterData
  | LocalparamData
  | SignalData

  // Interface
  | ModportData

  // Assertion
  | SequenceData
  | PropertyData

  // Verification
  | CovergroupData
  | ConstraintData

  // Timing
  | ClockingData
  | CheckerData

  // Procedural
  | GenerateBlockData
  | AlwaysBlockData
  | InitialBlockData;

// ============================================================================
// Individual Declaration Data Types
// ============================================================================

// Design Units ---------------------------------------------------------------

/** Data for module declarations */
export interface ModuleData {
  kind: 'module';
  /** Module parameters (#(parameter WIDTH = 8)) */
  params: ParamInfo[];
}

/** Data for package declarations */
export interface PackageData {
  kind: 'package';
  // Packages have no extra data - they're just containers
}

/** Data for interface declarations */
export interface InterfaceData {
  kind: 'interface';
  /** Interface parameters */
  params: ParamInfo[];
}

/** Data for class declarations */
export interface ClassData {
  kind: 'class';
  /** Name of parent class (unresolved) - e.g., "uvm_driver" */
  extendsName?: string;
  /** True if declared with "virtual class" */
  isVirtual: boolean;
}

/** Data for program declarations */
export interface ProgramData {
  kind: 'program';
  // Programs have no extra data
}

/**
 * Data for configuration block declarations.
 *
 * Configuration blocks control module binding during elaboration.
 * They can specify which module implementations to use.
 *
 * @example
 * ```systemverilog
 * config my_config;
 *   design top.rtl;
 *   default liblist rtl_lib;
 *   cell dff use dff_lp;
 * endconfig
 * ```
 */
export interface ConfigData {
  kind: 'config';
  /** Design statement specifying the top module */
  designStatement?: string;
  /** Default library list */
  defaultLiblist?: string[];
  /** Cell use statements mapping cells to implementations */
  cellUseStatements: ConfigCellUse[];
}

/**
 * A cell use statement in a configuration block.
 *
 * Maps a cell (module) to a specific implementation.
 */
export interface ConfigCellUse {
  /** Cell/module name to configure */
  cellName: string;
  /** Library to use */
  libName?: string;
  /** Specific module implementation to use */
  useName?: string;
}

// Behavioral -----------------------------------------------------------------

/** Data for function declarations */
export interface FunctionData {
  kind: 'function';
  /** Return type - e.g., "int", "logic [7:0]", "void" */
  returnType: string;
  /** Function arguments */
  args: ArgInfo[];
}

/** Data for task declarations */
export interface TaskData {
  kind: 'task';
  /** Task arguments */
  args: ArgInfo[];
}

// Types ----------------------------------------------------------------------

/** Data for typedef declarations */
export interface TypedefData {
  kind: 'typedef';
  /** The underlying type - e.g., "logic [7:0]", "my_struct" */
  underlyingType: string;
}

/** Data for struct declarations */
export interface StructData {
  kind: 'struct';
  /** Struct fields */
  fields: FieldInfo[];
}

/** Data for union declarations */
export interface UnionData {
  kind: 'union';
  /** Union fields */
  fields: FieldInfo[];
}

/** Data for enum declarations */
export interface EnumData {
  kind: 'enum';
  /** Base type - e.g., "logic [2:0]" */
  baseType?: string;
}

/** Data for individual enum values */
export interface EnumValueData {
  kind: 'enum_value';
  /** Explicit value assignment - e.g., "= 5" */
  value?: string;
  /** Position in enum (0-based) */
  ordinal: number;
}

// Data -----------------------------------------------------------------------

/** Data for port declarations */
export interface PortData {
  kind: 'port';
  /** Port direction */
  direction: 'input' | 'output' | 'inout' | 'ref';
  /** Port type - e.g., "logic", "wire", "my_interface" */
  portType: string;
  /** Width - e.g., "[7:0]", "[WIDTH-1:0]" */
  width?: string;
}

/** Data for parameter declarations */
export interface ParameterData {
  kind: 'parameter';
  /** Parameter type */
  paramType: string;
  /** Default value expression */
  defaultValue?: string;
}

/** Data for localparam declarations */
export interface LocalparamData {
  kind: 'localparam';
  /** Parameter type */
  paramType: string;
  /** Value expression (required for localparam) */
  value: string;
}

/** Data for signal/variable declarations */
export interface SignalData {
  kind: 'signal';
  /** Signal type - "logic", "wire", "reg" */
  signalType: string;
  /** Width - e.g., "[7:0]" */
  width?: string;
}

// Interface ------------------------------------------------------------------

/** Data for modport declarations */
export interface ModportData {
  kind: 'modport';
  /** Ports in the modport */
  ports: ModportPort[];
}

// Assertion ------------------------------------------------------------------

/** Data for sequence declarations */
export interface SequenceData {
  kind: 'sequence';
  // Sequences are complex - we just note they exist
}

/** Data for property declarations */
export interface PropertyData {
  kind: 'property';
  // Properties are complex - we just note they exist
}

// Verification ---------------------------------------------------------------

/** Data for covergroup declarations */
export interface CovergroupData {
  kind: 'covergroup';
  // Covergroups are complex - we just note they exist
}

/** Data for constraint declarations */
export interface ConstraintData {
  kind: 'constraint';
  // Constraints are complex - we just note they exist
}

// Timing ---------------------------------------------------------------------

/** Data for clocking block declarations */
export interface ClockingData {
  kind: 'clocking';
  /** Clock event - e.g., "posedge clk" */
  clockEvent: string;
  /** Signals in the clocking block */
  signals: ClockingSignal[];
}

/** Data for checker declarations */
export interface CheckerData {
  kind: 'checker';
  /** Checker ports */
  ports: ArgInfo[];
}

// Procedural -----------------------------------------------------------------

/** Data for generate blocks */
export interface GenerateBlockData {
  kind: 'generate_block';
  /** Type of generate */
  generateType: 'for' | 'if' | 'case';
  /** Block label if specified (begin:label_name) */
  label?: string;
}

/** Data for always blocks */
export interface AlwaysBlockData {
  kind: 'always_block';
  /** Type of always block */
  blockType: 'always' | 'always_ff' | 'always_comb' | 'always_latch';
  /** Sensitivity list - e.g., "posedge clk or negedge rst_n" */
  sensitivity?: string;
}

/** Data for initial blocks */
export interface InitialBlockData {
  kind: 'initial_block';
  // Initial blocks have no extra data
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Parameter information for modules/interfaces/classes.
 *
 * @example
 * ```typescript
 * // For: parameter int WIDTH = 8
 * const param: ParamInfo = {
 *   name: 'WIDTH',
 *   type: 'int',
 *   default: '8'
 * };
 * ```
 */
export interface ParamInfo {
  /** Parameter name */
  name: string;
  /** Parameter type (may be implicit) */
  type?: string;
  /** Default value expression */
  default?: string;
}

/**
 * Argument information for functions/tasks.
 *
 * @example
 * ```typescript
 * // For: input logic [7:0] data
 * const arg: ArgInfo = {
 *   name: 'data',
 *   direction: 'input',
 *   type: 'logic [7:0]'
 * };
 * ```
 */
export interface ArgInfo {
  /** Argument name */
  name: string;
  /** Direction: input, output, inout, ref */
  direction: string;
  /** Argument type */
  type: string;
}

/**
 * Field information for structs/unions.
 *
 * @example
 * ```typescript
 * // For: logic [7:0] data;
 * const field: FieldInfo = {
 *   name: 'data',
 *   type: 'logic [7:0]'
 * };
 * ```
 */
export interface FieldInfo {
  /** Field name */
  name: string;
  /** Field type */
  type: string;
}

/**
 * Port information for modports.
 *
 * @example
 * ```typescript
 * // For: modport master(output valid, input ready);
 * const ports: ModportPort[] = [
 *   { name: 'valid', direction: 'output' },
 *   { name: 'ready', direction: 'input' }
 * ];
 * ```
 */
export interface ModportPort {
  /** Port name */
  name: string;
  /** Port direction in this modport */
  direction: string;
}

/**
 * Signal information for clocking blocks.
 *
 * @example
 * ```typescript
 * // For: input #1step data;
 * const sig: ClockingSignal = {
 *   name: 'data',
 *   direction: 'input',
 *   skew: '#1step'
 * };
 * ```
 */
export interface ClockingSignal {
  /** Signal name */
  name: string;
  /** Direction in clocking block */
  direction: 'input' | 'output' | 'inout';
  /** Optional skew specification */
  skew?: string;
}
