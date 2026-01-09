/**
 * Reference Scanner Module
 *
 * Scans for reference constructs in SystemVerilog code.
 *
 * References are USAGES of things defined elsewhere.
 *
 * Reference kinds scanned:
 * - type_usage: Using a typedef, struct, enum, class
 * - macro_usage: Using a `define macro
 * - func_call: Calling a function
 * - task_call: Calling a task
 * - extends: Class inheritance
 * - import: Package imports
 * - port_conn: Port connections in instances
 * - signal_usage: Using a signal or port
 * - assert_usage: assert property()
 * - assume_usage: assume property()
 * - cover_usage: cover property()
 * - sequence_usage: Using a sequence in another sequence/property
 * - clocking_usage: cb.data - clocking block access
 * - dpi_call: Calling a DPI-imported function
 *
 * @module scanners/reference-scanner
 */

import type {
  Reference,
  ReferenceKind,
  ReferenceData,
  LineOffsets,
  Declaration,
} from '../types/index.js';
import { locationId } from '../ids/index.js';
import { getLocation } from '../reader/index.js';
import {
  REFERENCE_PATTERNS,
  DIRECTIVE_PATTERNS,
  copyPattern,
} from './patterns.js';
import { ScopeTracker, buildScopeLookup, type ScopeLookup } from './scope-tracker.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from scanning references.
 */
export interface ReferenceScanResult {
  /** All references found */
  references: Reference[];
}

// ============================================================================
// Main Scanner Function
// ============================================================================

/**
 * Scan content for references.
 *
 * @param content - Preprocessed code (comments stripped)
 * @param filePath - Absolute path to the file
 * @param lineOffsets - Line offset index for location lookup
 * @param declarations - Declarations found in this file (for context)
 * @param scopeLookup - Optional function to look up scope at a line (built from declarations if not provided)
 * @returns All references found
 *
 * @example
 * ```typescript
 * const { references } = scanReferences(
 *   content,
 *   '/path/to/file.sv',
 *   lineOffsets,
 *   declarations
 * );
 *
 * for (const ref of references) {
 *   console.log(`${ref.kind}: ${ref.targetName} at line ${ref.location.line}`);
 * }
 * ```
 */
export function scanReferences(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  declarations: Declaration[],
  scopeLookup?: ScopeLookup
): ReferenceScanResult {
  const references: Reference[] = [];
  const scopeTracker = new ScopeTracker();

  // Build scope lookup from declarations if not provided
  const getScope = scopeLookup || buildScopeLookup(declarations);

  // Build set of known declaration names for filtering
  const declNames = new Set(declarations.map((d) => d.name));

  // Scan different reference types (pass getScope for scope lookup)
  scanImports(content, filePath, lineOffsets, scopeTracker, references, getScope);
  scanExtends(content, filePath, lineOffsets, scopeTracker, references, getScope);
  scanMacroUsages(content, filePath, lineOffsets, scopeTracker, references, getScope);
  scanAssertions(content, filePath, lineOffsets, scopeTracker, references, getScope);
  scanScopedIdentifiers(content, filePath, lineOffsets, scopeTracker, references, getScope);

  // Sort references by location
  references.sort((a, b) => {
    if (a.location.line !== b.location.line) {
      return a.location.line - b.location.line;
    }
    return a.location.col - b.location.col;
  });

  return { references };
}

// ============================================================================
// Individual Scanners
// ============================================================================

/**
 * Scan for import statements.
 */
function scanImports(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  references: Reference[],
  getScope: ScopeLookup
): void {
  const pattern = copyPattern(REFERENCE_PATTERNS.import);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    const packageName = match[1];
    const memberName = match[2]; // Could be "*" for wildcard

    const data: ReferenceData = {
      kind: 'import',
      memberName: memberName === '*' ? '*' : memberName,
    };

    references.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'import',
      targetName: packageName,
      location: { file: filePath, line: loc.line, col: loc.col },
      scope: getScope(loc.line),
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
      data,
    });
  }
}

/**
 * Scan for class extends.
 */
function scanExtends(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  references: Reference[],
  getScope: ScopeLookup
): void {
  const pattern = copyPattern(REFERENCE_PATTERNS.extends);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    references.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'extends',
      targetName: match[1],
      location: { file: filePath, line: loc.line, col: loc.col },
      scope: getScope(loc.line),
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
      data: { kind: 'extends' },
    });
  }
}

/**
 * Scan for macro usages.
 */
function scanMacroUsages(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  references: Reference[],
  getScope: ScopeLookup
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.macroUsage);
  let match;

  // Skip known directive keywords
  const directiveKeywords = new Set([
    'define',
    'undef',
    'include',
    'ifdef',
    'ifndef',
    'elsif',
    'else',
    'endif',
    'timescale',
    'default_nettype',
    'pragma',
    'resetall',
    'line',
  ]);

  while ((match = pattern.exec(content)) !== null) {
    const macroName = match[1];

    // Skip directive keywords
    if (directiveKeywords.has(macroName)) {
      continue;
    }

    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    references.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'macro_usage',
      targetName: macroName,
      location: { file: filePath, line: loc.line, col: loc.col },
      scope: getScope(loc.line),
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }
}

/**
 * Scan for assertion usages (assert/assume/cover property).
 */
function scanAssertions(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  references: Reference[],
  getScope: ScopeLookup
): void {
  // Assert property
  let pattern = copyPattern(REFERENCE_PATTERNS.assertProperty);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    references.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'assert_usage',
      targetName: match[1],
      location: { file: filePath, line: loc.line, col: loc.col },
      scope: getScope(loc.line),
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }

  // Assume property
  pattern = copyPattern(REFERENCE_PATTERNS.assumeProperty);

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    references.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'assume_usage',
      targetName: match[1],
      location: { file: filePath, line: loc.line, col: loc.col },
      scope: getScope(loc.line),
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }

  // Cover property
  pattern = copyPattern(REFERENCE_PATTERNS.coverProperty);

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    references.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'cover_usage',
      targetName: match[1],
      location: { file: filePath, line: loc.line, col: loc.col },
      scope: getScope(loc.line),
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }
}

/**
 * Scan for scoped identifiers (package::name or class::name).
 */
function scanScopedIdentifiers(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  references: Reference[],
  getScope: ScopeLookup
): void {
  const pattern = copyPattern(REFERENCE_PATTERNS.scopedId);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    const scopeName = match[1];
    const memberName = match[2];

    // This could be a type usage (pkg::type_t) or other scoped reference
    references.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'type_usage',
      targetName: `${scopeName}::${memberName}`,
      location: { file: filePath, line: loc.line, col: loc.col },
      scope: getScope(loc.line),
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a name looks like a built-in type (not a reference).
 */
export function isBuiltinType(name: string): boolean {
  const builtins = new Set([
    // Basic types
    'bit',
    'logic',
    'reg',
    'integer',
    'real',
    'realtime',
    'shortint',
    'int',
    'longint',
    'byte',
    'shortreal',
    'string',
    'chandle',
    'event',
    // Net types
    'wire',
    'tri',
    'tri0',
    'tri1',
    'wand',
    'wor',
    'triand',
    'trior',
    'supply0',
    'supply1',
    'uwire',
    // Other
    'void',
    'time',
    'signed',
    'unsigned',
  ]);

  return builtins.has(name);
}

/**
 * Check if a name looks like a SystemVerilog keyword (not a reference).
 */
export function isKeyword(name: string): boolean {
  const keywords = new Set([
    // Module/block keywords
    'module',
    'endmodule',
    'package',
    'endpackage',
    'interface',
    'endinterface',
    'class',
    'endclass',
    'function',
    'endfunction',
    'task',
    'endtask',
    'program',
    'endprogram',
    'begin',
    'end',
    'fork',
    'join',
    'join_any',
    'join_none',
    // Control flow
    'if',
    'else',
    'for',
    'foreach',
    'while',
    'do',
    'repeat',
    'forever',
    'case',
    'casex',
    'casez',
    'default',
    'return',
    'break',
    'continue',
    // Declarations
    'input',
    'output',
    'inout',
    'ref',
    'parameter',
    'localparam',
    'typedef',
    'enum',
    'struct',
    'union',
    'packed',
    'const',
    'static',
    'automatic',
    'virtual',
    'pure',
    'extern',
    'import',
    'export',
    // Assignments
    'assign',
    'deassign',
    'force',
    'release',
    // Always blocks
    'always',
    'always_ff',
    'always_comb',
    'always_latch',
    'initial',
    'final',
    // Generate
    'generate',
    'endgenerate',
    'genvar',
    // Others
    'posedge',
    'negedge',
    'edge',
    'null',
    'this',
    'super',
    'new',
    'extends',
    'implements',
  ]);

  return keywords.has(name);
}
