/**
 * Directive Types for SystemVerilog Indexer
 *
 * DIRECTIVES are preprocessor commands that control how code is processed
 * BEFORE actual parsing. They start with a backtick (`) and affect
 * text substitution, conditional compilation, and file inclusion.
 *
 * Examples:
 * - `define WIDTH 8`  -> Text substitution
 * - `include "defs.svh"`  -> File inclusion
 * - `ifdef DEBUG`  -> Conditional compilation
 *
 * Directives are important for:
 * - Understanding macro values
 * - Resolving include file paths
 * - Tracking conditional compilation blocks
 *
 * @module types/directive
 */

import type { Location, Guard } from './location.js';

// ============================================================================
// DirectiveKind - What type of directive
// ============================================================================

/**
 * All possible kinds of preprocessor directives in SystemVerilog.
 *
 * Grouped by category:
 *
 * **Macro Directives:**
 * - define: Create a macro
 * - undef: Remove a macro
 *
 * **File Inclusion:**
 * - include: Include another file
 *
 * **Conditional Compilation:**
 * - ifdef, ifndef, elsif, else, endif: Conditional blocks
 *
 * **Compiler Directives:**
 * - timescale: Time unit specification
 * - default_nettype: Default wire type
 * - pragma: Compiler-specific hints
 * - resetall: Reset all directives
 *
 * **DPI (Direct Programming Interface):**
 * - dpi_import: Import C function
 * - dpi_export: Export SV function to C
 *
 * **Line Control:**
 * - line: Override line number reporting
 */
export type DirectiveKind =
  // Macro directives
  | 'define'
  | 'undef'

  // File inclusion
  | 'include'

  // Conditional compilation
  | 'ifdef'
  | 'ifndef'
  | 'elsif'
  | 'else'
  | 'endif'

  // Compiler directives
  | 'timescale'
  | 'default_nettype'
  | 'pragma'
  | 'resetall'

  // DPI directives
  | 'dpi_import'
  | 'dpi_export'

  // Line control
  | 'line';

// ============================================================================
// Directive - A preprocessor command
// ============================================================================

/**
 * A directive represents a preprocessor command in the code.
 *
 * Unlike declarations (which create entities in the design),
 * directives control how code is processed and what code is visible.
 *
 * ID Strategy:
 * - Macro directives (define, undef): Use declaration IDs (decl:...) because
 *   they declare/reference named entities that can be looked up across files.
 * - All other directives: Use location IDs (loc:...) because they are
 *   location-specific actions without named entities.
 *
 * @example
 * ```typescript
 * // For: `define WIDTH 8 (uses declaration ID - named macro)
 * const defineDir: Directive = {
 *   id: 'decl:abc123def456',
 *   kind: 'define',
 *   location: { file: '/path/defs.svh', line: 5, col: 1 },
 *   data: { kind: 'define', name: 'WIDTH', body: '8' }
 * };
 *
 * // For: `include "utils.svh" (uses location ID - no named entity)
 * const includeDir: Directive = {
 *   id: 'loc:def456abc123',
 *   kind: 'include',
 *   location: { file: '/path/top.sv', line: 2, col: 1 },
 *   data: { kind: 'include', path: 'utils.svh' }
 * };
 *
 * // For: `ifdef DEBUG (uses location ID - conditional marker)
 * const ifdefDir: Directive = {
 *   id: 'loc:ghi789jkl012',
 *   kind: 'ifdef',
 *   location: { file: '/path/top.sv', line: 10, col: 1 },
 *   data: { kind: 'ifdef', condition: 'DEBUG' }
 * };
 * ```
 */
export interface Directive {
  // -------------------------------------------------------------------------
  // ID - Directive identifier
  // -------------------------------------------------------------------------

  /**
   * Unique identifier for this directive.
   *
   * For macro directives (define, undef):
   *   Declaration ID - Format: "decl:<16-char-hash>"
   *   Computed from: file + kind ('macro') + name + scope
   *   Enables lookup of macro definitions by name across files.
   *
   * For all other directives:
   *   Location ID - Format: "loc:<16-char-hash>"
   *   Computed from: file + line + col
   *   Identifies the specific location of the directive.
   */
  id: string;

  // -------------------------------------------------------------------------
  // What Kind
  // -------------------------------------------------------------------------

  /** What kind of directive (define, include, ifdef, etc.) */
  kind: DirectiveKind;

  // -------------------------------------------------------------------------
  // Location
  // -------------------------------------------------------------------------

  /** File, line, and column where directive appears */
  location: Location;

  // -------------------------------------------------------------------------
  // Kind-Specific Data
  // -------------------------------------------------------------------------

  /**
   * Additional data specific to the directive kind.
   * This is a discriminated union - check data.kind to narrow the type.
   */
  data: DirectiveData;

  // -------------------------------------------------------------------------
  // Conditional Compilation
  // -------------------------------------------------------------------------

  /**
   * If this directive is inside an `ifdef/`ifndef block,
   * this records the condition.
   *
   * Used to track conditional includes - dependencies from includes
   * inside ifdef blocks may not always be required.
   */
  guard?: Guard;
}

// ============================================================================
// DirectiveData - Kind-specific additional information
// ============================================================================

/**
 * Discriminated union of all directive-specific data.
 *
 * Each directive kind has its own data shape with relevant information:
 * - define: macro name, parameters, body
 * - include: file path
 * - ifdef: condition to check
 * - etc.
 */
export type DirectiveData =
  // Macro directives
  | DefineData
  | UndefData

  // File inclusion
  | IncludeData

  // Conditional compilation
  | IfdefData
  | IfndefData
  | ElsifData
  | ElseData
  | EndifData

  // Compiler directives
  | TimescaleData
  | DefaultNettypeData
  | PragmaData
  | ResetallData

  // DPI directives
  | DpiImportData
  | DpiExportData

  // Line control
  | LineData;

// ============================================================================
// Individual Directive Data Types
// ============================================================================

// Macro Directives -----------------------------------------------------------

/**
 * Data for `define directives.
 *
 * `define creates text macros for substitution.
 *
 * @example
 * ```systemverilog
 * `define WIDTH 8
 * `define MAX(a,b) ((a) > (b) ? (a) : (b))
 * `define ASSERT(cond) assert(cond) else $error("Assertion failed")
 * ```
 */
interface DefineData {
  kind: 'define';

  /** Macro name (e.g., "WIDTH", "MAX") */
  name: string;

  /**
   * Macro parameters for function-like macros.
   * Undefined for simple macros.
   *
   * @example For `define MAX(a,b)` -> ['a', 'b']
   */
  params?: string[];

  /**
   * Macro body - the replacement text.
   *
   * @example For `define WIDTH 8` -> '8'
   * @example For `define MAX(a,b) ((a)>(b)?(a):(b))` -> '((a)>(b)?(a):(b))'
   */
  body: string;
}

/**
 * Data for `undef directives.
 *
 * `undef removes a previously defined macro.
 */
interface UndefData {
  kind: 'undef';

  /** Name of macro to undefine */
  name: string;
}

// File Inclusion -------------------------------------------------------------

/**
 * Data for `include directives.
 *
 * `include inserts the contents of another file.
 *
 * @example
 * ```systemverilog
 * `include "defs.svh"
 * `include <uvm_macros.svh>
 * ```
 */
interface IncludeData {
  kind: 'include';

  /**
   * Path as written in the source.
   * Could be relative or filename only.
   *
   * @example "defs.svh", "../common/utils.svh"
   */
  path: string;

  /**
   * Resolved absolute path to the file.
   *
   * This is NOT filled in during initial parsing.
   * It's populated during the resolution phase when we
   * search include paths.
   */
  resolvedPath?: string;
}

// Conditional Compilation ----------------------------------------------------

/**
 * Data for `ifdef directives.
 *
 * `ifdef includes following code if macro IS defined.
 */
interface IfdefData {
  kind: 'ifdef';

  /** Macro name to check */
  condition: string;
}

/**
 * Data for `ifndef directives.
 *
 * `ifndef includes following code if macro is NOT defined.
 */
interface IfndefData {
  kind: 'ifndef';

  /** Macro name to check */
  condition: string;
}

/**
 * Data for `elsif directives.
 *
 * `elsif provides alternative condition in ifdef/ifndef chain.
 */
interface ElsifData {
  kind: 'elsif';

  /** Alternative condition to check */
  condition: string;
}

/**
 * Data for `else directives.
 *
 * `else provides default case in ifdef/ifndef chain.
 */
interface ElseData {
  kind: 'else';
  // No additional data needed
}

/**
 * Data for `endif directives.
 *
 * `endif closes an ifdef/ifndef block.
 */
interface EndifData {
  kind: 'endif';
  // No additional data needed
}

// Compiler Directives --------------------------------------------------------

/**
 * Data for `timescale directives.
 *
 * `timescale sets simulation time units.
 *
 * @example
 * ```systemverilog
 * `timescale 1ns/1ps
 * `timescale 100ps/10ps
 * ```
 */
interface TimescaleData {
  kind: 'timescale';

  /** Time unit (e.g., "1ns", "100ps") */
  timeUnit: string;

  /** Time precision (e.g., "1ps", "10ps") */
  precision: string;
}

/**
 * Data for `default_nettype directives.
 *
 * `default_nettype sets the default type for implicit nets.
 *
 * @example
 * ```systemverilog
 * `default_nettype none  // Require explicit declarations
 * `default_nettype wire  // Default behavior
 * ```
 */
interface DefaultNettypeData {
  kind: 'default_nettype';

  /** Net type (e.g., "wire", "none", "tri") */
  nettype: string;
}

/**
 * Data for `pragma directives.
 *
 * `pragma provides compiler/tool-specific hints.
 *
 * @example
 * ```systemverilog
 * `pragma protect begin
 * `pragma protect end
 * ```
 */
interface PragmaData {
  kind: 'pragma';

  /** Raw pragma text */
  text: string;
}

/**
 * Data for `resetall directives.
 *
 * `resetall resets all compiler directives to defaults.
 */
interface ResetallData {
  kind: 'resetall';
  // No additional data needed
}

// DPI Directives -------------------------------------------------------------

/**
 * Data for DPI import directives.
 *
 * DPI imports allow calling C functions from SystemVerilog.
 *
 * @example
 * ```systemverilog
 * import "DPI-C" function int c_calc(input int a, input int b);
 * import "DPI-C" context function void c_init();
 * import "DPI-C" pure function real sin(input real x);
 * ```
 */
interface DpiImportData {
  kind: 'dpi_import';

  /** Whether function uses "context" (can call back into SV) */
  context?: boolean;

  /** "pure" or "context" if specified */
  pureOrContext?: string;

  /** Imported function name */
  funcName: string;

  /** Return type of the function */
  returnType: string;

  /** Function arguments as a string (to be parsed if needed) */
  args: string;
}

/**
 * Data for DPI export directives.
 *
 * DPI exports allow C code to call SystemVerilog functions.
 *
 * @example
 * ```systemverilog
 * export "DPI-C" function sv_callback;
 * ```
 */
interface DpiExportData {
  kind: 'dpi_export';

  /** Exported function name */
  funcName: string;
}

// Line Control ---------------------------------------------------------------

/**
 * Data for `line directives.
 *
 * `line overrides reported line numbers (for preprocessed code).
 *
 * @example
 * ```systemverilog
 * `line 100 "original_file.sv" 0
 * ```
 */
interface LineData {
  kind: 'line';

  /** New line number to report */
  lineNum: number;

  /** File name to report */
  fileName: string;

  /** Level (0=enter file, 1=return from include, 2=system header) */
  level: number;
}
