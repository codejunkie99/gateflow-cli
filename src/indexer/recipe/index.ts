/**
 * Recipe Module - Filelist Parsing
 *
 * This module handles parsing of .f (filelist) files used in
 * SystemVerilog projects to define compile configurations.
 *
 * ## What is a Recipe?
 *
 * A Recipe (filelist) defines:
 * - **Files**: List of .sv/.svh files to compile (in order)
 * - **Include Paths**: Directories to search for `include files
 * - **Defines**: Macro definitions (+define+NAME=VALUE)
 * - **Nested Filelists**: References to other .f files
 *
 * ## Filelist Syntax
 *
 * ```
 * # Comment (hash style)
 * // Comment (C++ style)
 *
 * # Include paths
 * +incdir+./include
 * +incdir+../common
 *
 * # Defines
 * +define+DEBUG
 * +define+WIDTH=32
 *
 * # Files (in compile order)
 * ./rtl/types_pkg.sv
 * ./rtl/counter.sv
 * ./rtl/top.sv
 *
 * # Nested filelist
 * -f ./tb/testbench.f
 * ```
 *
 * @example
 * ```typescript
 * import {
 *   parseFilelist,
 *   resolveInclude,
 *   getCompileOrder
 * } from './recipe/index.js';
 *
 * // Parse a filelist
 * const recipe = await parseFilelist('/project/compile.f');
 *
 * console.log(`Include paths: ${recipe.includePaths.join(', ')}`);
 * console.log(`Defines: ${Object.keys(recipe.defines).join(', ')}`);
 * console.log(`Files: ${recipe.files.length}`);
 *
 * // Get compile order
 * const compileOrder = getCompileOrder(recipe);
 * for (const file of compileOrder) {
 *   console.log(`Compile: ${file}`);
 * }
 *
 * // Resolve an include
 * const resolved = await resolveInclude(recipe, 'defs.svh');
 * if (resolved) {
 *   console.log(`Found: ${resolved}`);
 * }
 * ```
 *
 * @module recipe
 */

// ============================================================================
// Main Exports
// ============================================================================

export {
  // Parser class
  FilelistParser,
  createFilelistParser,

  // Convenience function
  parseFilelist,

  // Utilities
  getCompileOrder,
  resolveInclude,
  hasMacro,
  getMacroValue,

  // Types
  type Recipe,
  type ParseFilelistOptions,
} from './filelist-parser.js';
