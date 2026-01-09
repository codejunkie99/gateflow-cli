/**
 * Regex Patterns for SystemVerilog Parsing
 *
 * This module contains all regex patterns used to identify
 * SystemVerilog constructs during scanning.
 *
 * Pattern Categories:
 * - Directives: `define, `include, `ifdef, etc.
 * - Declarations: module, class, function, typedef, etc.
 * - References: imports, extends, type usages
 * - Instances: module instantiations
 * - Structure: begin/end, scope markers
 *
 * Design Decisions:
 * - All patterns use global flag (g) for repeated matching
 * - Patterns are designed to work on comment-stripped code
 * - Named capture groups where supported for clarity
 * - Non-greedy matching (.+?) to avoid over-matching
 *
 * @module scanners/patterns
 */

// ============================================================================
// Directive Patterns
// ============================================================================

/**
 * Patterns for preprocessor directives.
 *
 * These patterns match constructs that start with backtick (`).
 */
export const DIRECTIVE_PATTERNS = {
  /**
   * `define macro definition.
   *
   * Matches:
   * - `define NAME
   * - `define NAME value
   * - `define NAME(a, b) body
   *
   * Groups: [1]=name, [2]=params (optional), [3]=body
   */
  define: /`define\s+(\w+)(?:\s*\(([^)]*)\))?\s*(.*?)(?=\r?\n|$)/g,

  /**
   * `undef macro undefinition.
   *
   * Groups: [1]=name
   */
  undef: /`undef\s+(\w+)/g,

  /**
   * `include file inclusion.
   *
   * Matches both "path" and <path> styles.
   *
   * Groups: [1]=path
   */
  include: /`include\s+["<]([^">]+)[">]/g,

  /**
   * `ifdef conditional compilation.
   *
   * Groups: [1]=macro_name
   */
  ifdef: /`ifdef\s+(\w+)/g,

  /**
   * `ifndef conditional compilation.
   *
   * Groups: [1]=macro_name
   */
  ifndef: /`ifndef\s+(\w+)/g,

  /**
   * `elsif alternative condition.
   *
   * Groups: [1]=macro_name
   */
  elsif: /`elsif\s+(\w+)/g,

  /**
   * `else in conditional block.
   */
  else: /`else\b/g,

  /**
   * `endif closes conditional block.
   */
  endif: /`endif\b/g,

  /**
   * `timescale directive.
   *
   * Groups: [1]=time_unit, [2]=precision
   */
  timescale: /`timescale\s+(\d+\s*[munpf]?s)\s*\/\s*(\d+\s*[munpf]?s)/g,

  /**
   * `default_nettype directive.
   *
   * Groups: [1]=net_type
   */
  default_nettype: /`default_nettype\s+(\w+)/g,

  /**
   * `pragma directive.
   *
   * Groups: [1]=pragma_text
   */
  pragma: /`pragma\s+(.+?)(?=\r?\n|$)/g,

  /**
   * `resetall directive.
   */
  resetall: /`resetall\b/g,

  /**
   * `line directive (for preprocessed files).
   *
   * Groups: [1]=line_number, [2]=filename, [3]=level
   */
  line: /`line\s+(\d+)\s+"([^"]+)"\s+(\d+)/g,

  /**
   * Macro usage/expansion.
   *
   * Groups: [1]=macro_name
   */
  macroUsage: /`(\w+)/g,
} as const;

// ============================================================================
// DPI Patterns
// ============================================================================

/**
 * Patterns for DPI (Direct Programming Interface) constructs.
 */
export const DPI_PATTERNS = {
  /**
   * DPI import - importing C function into SystemVerilog.
   *
   * Groups: [1]=pure/context (optional), [2]=return_type, [3]=func_name, [4]=args
   */
  dpiImport:
    /\bimport\s+"DPI-C"\s+(?:(context|pure)\s+)?function\s+(\w+)\s+(\w+)\s*\(([^)]*)\)\s*;/g,

  /**
   * DPI export - exporting SV function to C.
   *
   * Groups: [1]=func_name
   */
  dpiExport: /\bexport\s+"DPI-C"\s+function\s+(\w+)\s*;/g,
} as const;

// ============================================================================
// Declaration Patterns
// ============================================================================

/**
 * Patterns for declaration constructs.
 *
 * These patterns match where things are DEFINED.
 */
export const DECLARATION_PATTERNS = {
  // -------------------------------------------------------------------------
  // Container Declarations (have begin/end structure)
  // -------------------------------------------------------------------------

  /**
   * Module declaration.
   *
   * Groups: [1]=name
   */
  module: /\bmodule\s+(\w+)/g,

  /**
   * End of module.
   */
  endmodule: /\bendmodule\b/g,

  /**
   * Package declaration.
   *
   * Groups: [1]=name
   */
  package: /\bpackage\s+(\w+)/g,

  /**
   * End of package.
   */
  endpackage: /\bendpackage\b/g,

  /**
   * Interface declaration.
   *
   * Groups: [1]=name
   */
  interface: /\binterface\s+(\w+)/g,

  /**
   * End of interface.
   */
  endinterface: /\bendinterface\b/g,

  /**
   * Program declaration (testbench).
   *
   * Groups: [1]=name
   */
  program: /\bprogram\s+(\w+)/g,

  /**
   * End of program.
   */
  endprogram: /\bendprogram\b/g,

  /**
   * Class declaration.
   *
   * Groups: [1]=virtual? (optional), [2]=name, [3]=extends_name (optional)
   */
  class: /\b(virtual\s+)?class\s+(\w+)(?:\s+extends\s+(\w+(?:::\w+)?))?/g,

  /**
   * End of class.
   */
  endclass: /\bendclass\b/g,

  /**
   * Checker declaration.
   *
   * Groups: [1]=name
   */
  checker: /\bchecker\s+(\w+)/g,

  /**
   * End of checker.
   */
  endchecker: /\bendchecker\b/g,

  // -------------------------------------------------------------------------
  // Configuration Block Declarations
  // -------------------------------------------------------------------------

  /**
   * Configuration block declaration.
   *
   * Groups: [1]=name
   */
  config: /\bconfig\s+(\w+)/g,

  /**
   * End of configuration block.
   */
  endconfig: /\bendconfig\b/g,

  /**
   * Design statement in config block.
   *
   * Groups: [1]=design_name
   */
  configDesign: /\bdesign\s+(\w+(?:\.\w+)?)/g,

  /**
   * Default liblist in config block.
   *
   * Groups: [1]=library_list
   */
  configDefaultLiblist: /\bdefault\s+liblist\s+([\w\s]+?)(?=;)/g,

  /**
   * Cell use statement in config block.
   *
   * Groups: [1]=cell_name, [2]=use_name or liblist
   */
  configCellUse: /\bcell\s+(\w+)\s+(?:use\s+(\w+)|liblist\s+([\w\s]+?))(?=;)/g,

  // -------------------------------------------------------------------------
  // Function/Task Declarations
  // -------------------------------------------------------------------------

  /**
   * Function declaration.
   *
   * Groups: [1]=automatic? (optional), [2]=return_type, [3]=name
   */
  function: /\bfunction\s+(automatic\s+)?(\w+(?:\s*\[[^\]]*\])?)\s+(\w+)/g,

  /**
   * End of function.
   */
  endfunction: /\bendfunction\b/g,

  /**
   * Task declaration.
   *
   * Groups: [1]=automatic? (optional), [2]=name
   */
  task: /\btask\s+(automatic\s+)?(\w+)/g,

  /**
   * End of task.
   */
  endtask: /\bendtask\b/g,

  // -------------------------------------------------------------------------
  // Type Declarations
  // -------------------------------------------------------------------------

  /**
   * Typedef declaration.
   *
   * Groups: [1]=underlying_type, [2]=name
   */
  typedef: /\btypedef\s+(.+?)\s+(\w+)\s*;/g,

  /**
   * Enum declaration (inside typedef).
   *
   * Groups: [1]=base_type (optional), [2]=values, [3]=name
   */
  enum: /\btypedef\s+enum\s*(?:(\w+(?:\s*\[[^\]]+\])?)\s*)?\{([^}]+)\}\s*(\w+)\s*;/g,

  /**
   * Struct declaration (inside typedef).
   *
   * Groups: [1]=packed? (optional), [2]=body, [3]=name
   */
  struct: /\btypedef\s+struct\s*(packed)?\s*\{([^}]+)\}\s*(\w+)\s*;/g,

  /**
   * Union declaration (inside typedef).
   *
   * Groups: [1]=packed? (optional), [2]=tagged? (optional), [3]=body, [4]=name
   */
  union: /\btypedef\s+union\s*(packed)?\s*(tagged)?\s*\{([^}]+)\}\s*(\w+)\s*;/g,

  // -------------------------------------------------------------------------
  // Port/Signal Declarations
  // -------------------------------------------------------------------------

  /**
   * Port declaration in module/interface header.
   *
   * Groups: [1]=direction, [2]=type (optional), [3]=width (optional), [4]=name
   */
  port: /\b(input|output|inout|ref)\s+(?:(wire|reg|logic|[\w]+)\s+)?(?:(\[[^\]]+\])\s+)?(\w+)/g,

  /**
   * Parameter declaration.
   *
   * Groups: [1]=type (optional), [2]=name, [3]=value
   */
  parameter: /\bparameter\s+(?:(\w+)\s+)?(\w+)\s*=\s*([^,;]+)/g,

  /**
   * Localparam declaration.
   *
   * Groups: [1]=type (optional), [2]=name, [3]=value
   */
  localparam: /\blocalparam\s+(?:(\w+)\s+)?(\w+)\s*=\s*([^,;]+)/g,

  /**
   * Signal/wire/reg declaration.
   *
   * Groups: [1]=type, [2]=width (optional), [3]=name
   */
  signal: /\b(wire|reg|logic)\s*(?:(\[[^\]]+\])\s+)?(\w+)/g,

  // -------------------------------------------------------------------------
  // Interface-Specific Declarations
  // -------------------------------------------------------------------------

  /**
   * Modport declaration.
   *
   * Groups: [1]=name, [2]=ports
   */
  modport: /\bmodport\s+(\w+)\s*\(([^)]+)\)/g,

  // -------------------------------------------------------------------------
  // SVA (SystemVerilog Assertions) Declarations
  // -------------------------------------------------------------------------

  /**
   * Sequence declaration.
   *
   * Groups: [1]=name
   */
  sequence: /\bsequence\s+(\w+)/g,

  /**
   * End of sequence.
   */
  endsequence: /\bendsequence\b/g,

  /**
   * Property declaration.
   *
   * Groups: [1]=name
   */
  property: /\bproperty\s+(\w+)/g,

  /**
   * End of property.
   */
  endproperty: /\bendproperty\b/g,

  // -------------------------------------------------------------------------
  // Coverage Declarations
  // -------------------------------------------------------------------------

  /**
   * Covergroup declaration.
   *
   * Groups: [1]=name
   */
  covergroup: /\bcovergroup\s+(\w+)/g,

  /**
   * End of covergroup.
   */
  endgroup: /\bendgroup\b/g,

  // -------------------------------------------------------------------------
  // Constraint Declarations
  // -------------------------------------------------------------------------

  /**
   * Constraint declaration.
   *
   * Groups: [1]=name
   */
  constraint: /\bconstraint\s+(\w+)\s*\{/g,

  // -------------------------------------------------------------------------
  // Clocking Declarations
  // -------------------------------------------------------------------------

  /**
   * Clocking block declaration.
   *
   * Groups: [1]=name, [2]=clock_event
   */
  clocking: /\bclocking\s+(\w+)\s*@\s*\(([^)]+)\)/g,

  /**
   * End of clocking block.
   */
  endclocking: /\bendclocking\b/g,

  // -------------------------------------------------------------------------
  // Generate Blocks
  // -------------------------------------------------------------------------

  /**
   * Generate block start.
   */
  generate: /\bgenerate\b/g,

  /**
   * End of generate block.
   */
  endgenerate: /\bendgenerate\b/g,

  /**
   * Genvar declaration.
   *
   * Groups: [1]=name
   */
  genvar: /\bgenvar\s+(\w+)/g,

  /**
   * Generate for loop with label.
   *
   * Groups: [1]=var, [2]=init, [3]=cond, [4]=update, [5]=label
   */
  generateFor: /\bfor\s*\(\s*(?:genvar\s+)?(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*begin\s*:\s*(\w+)/g,

  /**
   * Generate if with label.
   *
   * Groups: [1]=condition, [2]=label
   */
  generateIf: /\bif\s*\(([^)]+)\)\s*begin\s*:\s*(\w+)/g,

  // -------------------------------------------------------------------------
  // Always/Initial Blocks
  // -------------------------------------------------------------------------

  /**
   * always_ff block.
   *
   * Groups: [1]=sensitivity
   */
  always_ff: /\balways_ff\s*@\s*\(([^)]+)\)/g,

  /**
   * always_comb block.
   */
  always_comb: /\balways_comb\b/g,

  /**
   * always_latch block.
   */
  always_latch: /\balways_latch\b/g,

  /**
   * Generic always block.
   *
   * Groups: [1]=sensitivity
   */
  always: /\balways\s*@\s*\(([^)]+)\)/g,

  /**
   * Initial block.
   */
  initial: /\binitial\b/g,
} as const;

// ============================================================================
// Reference Patterns
// ============================================================================

/**
 * Patterns for reference constructs.
 *
 * These patterns match where things are USED.
 */
export const REFERENCE_PATTERNS = {
  /**
   * Package import.
   *
   * Groups: [1]=package_name, [2]=member_name or *
   */
  import: /\bimport\s+(\w+)::(\w+|\*)\s*;/g,

  /**
   * Class extends.
   *
   * Groups: [1]=parent_class
   */
  extends: /\bextends\s+(\w+(?:::\w+)?)/g,

  /**
   * Assert property usage.
   *
   * Groups: [1]=property_name
   */
  assertProperty: /\bassert\s+property\s*\(\s*(\w+)/g,

  /**
   * Assume property usage.
   *
   * Groups: [1]=property_name
   */
  assumeProperty: /\bassume\s+property\s*\(\s*(\w+)/g,

  /**
   * Cover property usage.
   *
   * Groups: [1]=property_name
   */
  coverProperty: /\bcover\s+property\s*\(\s*(\w+)/g,

  /**
   * Scoped identifier (package::name or class::name).
   *
   * Groups: [1]=scope, [2]=name
   */
  scopedId: /\b(\w+)::(\w+)/g,
} as const;

// ============================================================================
// Instance Patterns
// ============================================================================

/**
 * Patterns for instantiation constructs.
 */
export const INSTANCE_PATTERNS = {
  /**
   * Module/interface instantiation.
   *
   * This pattern is tricky because it can match function calls.
   * Need additional validation after matching.
   *
   * Groups: [1]=module_name, [2]=instance_name
   *
   * Note: Parameter overrides (#(...)) are handled separately in the scanner
   * using bracket counting to support nested parentheses.
   */
  instance: /\b(\w+)\s+(\w+)\s*\(/g,

  /**
   * Module instantiation with parameters start marker.
   * Matches: module_name #(
   * The scanner uses bracket counting from this point to find the full instance.
   *
   * Groups: [1]=module_name
   */
  instanceWithParamsStart: /\b(\w+)\s*#\s*\(/g,

  /**
   * Array instance (multiple instances).
   *
   * Groups: [1]=module_name, [2]=instance_name, [3]=array_range
   */
  arrayInstance: /\b(\w+)\s+(\w+)\s*(\[[^\]]+\])\s*\(/g,

  /**
   * Array instance with parameters start marker.
   * Same as instanceWithParamsStart - scanner determines if it's an array instance.
   *
   * Groups: [1]=module_name (uses instanceWithParamsStart)
   */
  arrayInstanceWithParamsStart: /\b(\w+)\s*#\s*\(/g,

  /**
   * Bind statement.
   *
   * Groups: [1]=target_module, [2]=checker_module, [3]=instance_name
   */
  bind: /\bbind\s+(\w+(?:\.\w+)?)\s+(\w+)\s+(\w+)\s*\(/g,

  /**
   * Named port connection.
   *
   * Groups: [1]=port_name, [2]=signal_name
   */
  namedPort: /\.(\w+)\s*\(\s*([^)]*)\s*\)/g,

  /**
   * Implicit port connection (port name only).
   *
   * Groups: [1]=port_name
   */
  implicitPort: /\.(\w+)\s*(?=[,)])/g,
} as const;

// ============================================================================
// Structure Patterns
// ============================================================================

/**
 * Patterns for structural elements.
 */
export const STRUCTURE_PATTERNS = {
  /**
   * Begin block with label.
   *
   * Groups: [1]=label
   */
  beginLabeled: /\bbegin\s*:\s*(\w+)/g,

  /**
   * Begin block without label.
   */
  begin: /\bbegin\b/g,

  /**
   * End block with label.
   *
   * Groups: [1]=label
   */
  endLabeled: /\bend\s*:\s*(\w+)/g,

  /**
   * End block without label.
   */
  end: /\bend\b/g,

  /**
   * Fork block.
   */
  fork: /\bfork\b/g,

  /**
   * Join block.
   */
  join: /\bjoin(?:_any|_none)?\b/g,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reset all pattern lastIndex to 0 for fresh matching.
 *
 * Call this before starting a new scan to ensure patterns
 * match from the beginning of the content.
 */
export function resetPatterns(): void {
  const allPatterns = [
    DIRECTIVE_PATTERNS,
    DPI_PATTERNS,
    DECLARATION_PATTERNS,
    REFERENCE_PATTERNS,
    INSTANCE_PATTERNS,
    STRUCTURE_PATTERNS,
  ];

  for (const patterns of allPatterns) {
    for (const pattern of Object.values(patterns)) {
      if (pattern instanceof RegExp) {
        pattern.lastIndex = 0;
      }
    }
  }
}

/**
 * Create a fresh copy of a pattern (to avoid lastIndex issues).
 *
 * @param pattern - Pattern to copy
 * @returns New RegExp with same pattern and flags
 */
export function copyPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}
