/**
 * Directive Scanner Module
 *
 * Scans for preprocessor directives in SystemVerilog code.
 *
 * Directives scanned:
 * - Macro definitions: `define, `undef
 * - File inclusion: `include
 * - Conditional compilation: `ifdef, `ifndef, `elsif, `else, `endif
 * - Compiler directives: `timescale, `default_nettype, `pragma, `resetall
 * - DPI: import "DPI-C", export "DPI-C"
 * - Line control: `line
 *
 * @module scanners/directive-scanner
 */

import type { Directive, DirectiveData, LineOffsets } from '../types/index.js';
import { locationId } from '../ids/index.js';
import { getLocation } from '../reader/index.js';
import {
  DIRECTIVE_PATTERNS,
  DPI_PATTERNS,
  copyPattern,
} from './patterns.js';
import type { ScopeTracker } from './scope-tracker.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from scanning directives.
 */
export interface DirectiveScanResult {
  /** All directives found */
  directives: Directive[];
  /** State of ifdef conditions at each line (for other scanners) */
  ifdefState: IfdefState;
}

/**
 * Tracks the state of ifdef conditions.
 */
export interface IfdefState {
  /** Map from line number to active guard condition */
  lineGuards: Map<number, { condition: string; inverted: boolean }>;
}

// ============================================================================
// Main Scanner Function
// ============================================================================

/**
 * Scan content for preprocessor directives.
 *
 * @param content - Preprocessed code (comments stripped)
 * @param filePath - Absolute path to the file
 * @param lineOffsets - Line offset index for location lookup
 * @param scopeTracker - Scope tracker for guard management
 * @returns All directives found and ifdef state
 *
 * @example
 * ```typescript
 * const { directives, ifdefState } = scanDirectives(
 *   content,
 *   '/path/to/file.sv',
 *   lineOffsets,
 *   scopeTracker
 * );
 *
 * for (const dir of directives) {
 *   if (dir.kind === 'define') {
 *     console.log(`Found macro: ${dir.data.name}`);
 *   }
 * }
 * ```
 */
export function scanDirectives(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker
): DirectiveScanResult {
  const directives: Directive[] = [];
  const ifdefState: IfdefState = { lineGuards: new Map() };

  // Scan different directive types
  scanDefines(content, filePath, lineOffsets, scopeTracker, directives);
  scanUndefs(content, filePath, lineOffsets, scopeTracker, directives);
  scanIncludes(content, filePath, lineOffsets, scopeTracker, directives);
  scanConditionals(content, filePath, lineOffsets, scopeTracker, directives, ifdefState);
  scanTimescale(content, filePath, lineOffsets, scopeTracker, directives);
  scanDefaultNettype(content, filePath, lineOffsets, scopeTracker, directives);
  scanPragmas(content, filePath, lineOffsets, scopeTracker, directives);
  scanResetall(content, filePath, lineOffsets, scopeTracker, directives);
  scanDpiImports(content, filePath, lineOffsets, scopeTracker, directives);
  scanDpiExports(content, filePath, lineOffsets, scopeTracker, directives);
  scanLineDirectives(content, filePath, lineOffsets, scopeTracker, directives);

  // Sort directives by location
  directives.sort((a, b) => {
    if (a.location.line !== b.location.line) {
      return a.location.line - b.location.line;
    }
    return a.location.col - b.location.col;
  });

  return { directives, ifdefState };
}

// ============================================================================
// Individual Scanners
// ============================================================================

/**
 * Scan for `define directives.
 */
function scanDefines(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.define);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    // Parse parameters if present
    const params = match[2]
      ? match[2].split(',').map((p) => p.trim()).filter((p) => p)
      : undefined;

    const data: DirectiveData = {
      kind: 'define',
      name: match[1],
      params,
      body: match[3]?.trim() || '',
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'define',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for `undef directives.
 */
function scanUndefs(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.undef);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'undef',
      name: match[1],
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'undef',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for `include directives.
 */
function scanIncludes(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.include);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = scopeTracker.getGuard();

    const data: DirectiveData = {
      kind: 'include',
      path: match[1],
      // resolvedPath will be filled in during resolution phase
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'include',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for conditional compilation directives.
 *
 * Also updates the scopeTracker's guard state.
 */
function scanConditionals(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[],
  ifdefState: IfdefState
): void {
  // We need to process conditionals in order to track state
  // Use a combined approach: find all conditional directives with their positions
  const conditionals: Array<{
    kind: 'ifdef' | 'ifndef' | 'elsif' | 'else' | 'endif';
    offset: number;
    condition?: string;
  }> = [];

  // Find all ifdef
  const ifdefPattern = copyPattern(DIRECTIVE_PATTERNS.ifdef);
  let match;
  while ((match = ifdefPattern.exec(content)) !== null) {
    conditionals.push({
      kind: 'ifdef',
      offset: match.index,
      condition: match[1],
    });
  }

  // Find all ifndef
  const ifndefPattern = copyPattern(DIRECTIVE_PATTERNS.ifndef);
  while ((match = ifndefPattern.exec(content)) !== null) {
    conditionals.push({
      kind: 'ifndef',
      offset: match.index,
      condition: match[1],
    });
  }

  // Find all elsif
  const elsifPattern = copyPattern(DIRECTIVE_PATTERNS.elsif);
  while ((match = elsifPattern.exec(content)) !== null) {
    conditionals.push({
      kind: 'elsif',
      offset: match.index,
      condition: match[1],
    });
  }

  // Find all else
  const elsePattern = copyPattern(DIRECTIVE_PATTERNS.else);
  while ((match = elsePattern.exec(content)) !== null) {
    conditionals.push({
      kind: 'else',
      offset: match.index,
    });
  }

  // Find all endif
  const endifPattern = copyPattern(DIRECTIVE_PATTERNS.endif);
  while ((match = endifPattern.exec(content)) !== null) {
    conditionals.push({
      kind: 'endif',
      offset: match.index,
    });
  }

  // Sort by offset to process in order
  conditionals.sort((a, b) => a.offset - b.offset);

  // Process in order
  for (const cond of conditionals) {
    const loc = getLocation(lineOffsets, cond.offset);

    let data: DirectiveData;

    switch (cond.kind) {
      case 'ifdef':
        scopeTracker.pushGuard(cond.condition!, false, loc.line);
        data = { kind: 'ifdef', condition: cond.condition! };
        break;

      case 'ifndef':
        scopeTracker.pushGuard(cond.condition!, true, loc.line);
        data = { kind: 'ifndef', condition: cond.condition! };
        break;

      case 'elsif':
        // Pop current guard, push new one
        scopeTracker.popGuard();
        scopeTracker.pushGuard(cond.condition!, false, loc.line);
        data = { kind: 'elsif', condition: cond.condition! };
        break;

      case 'else':
        // Pop current guard, push inverted
        const currentGuard = scopeTracker.popGuard();
        if (currentGuard) {
          scopeTracker.pushGuard(currentGuard.macro, !currentGuard.inverted, loc.line);
        }
        data = { kind: 'else' };
        break;

      case 'endif':
        scopeTracker.popGuard();
        data = { kind: 'endif' };
        break;
    }

    // Record the guard state for this line
    const guard = scopeTracker.getGuard();
    if (guard) {
      ifdefState.lineGuards.set(loc.line, guard);
    }

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: cond.kind,
      location: { file: filePath, line: loc.line, col: loc.col },
      data: data!,
    });
  }
}

/**
 * Scan for `timescale directives.
 */
function scanTimescale(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.timescale);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'timescale',
      timeUnit: match[1],
      precision: match[2],
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'timescale',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for `default_nettype directives.
 */
function scanDefaultNettype(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.default_nettype);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'default_nettype',
      nettype: match[1],
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'default_nettype',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for `pragma directives.
 */
function scanPragmas(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.pragma);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'pragma',
      text: match[1],
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'pragma',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for `resetall directives.
 */
function scanResetall(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.resetall);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'resetall',
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'resetall',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for DPI import directives.
 */
function scanDpiImports(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DPI_PATTERNS.dpiImport);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'dpi_import',
      context: match[1] === 'context',
      pureOrContext: match[1] || undefined,
      returnType: match[2],
      funcName: match[3],
      args: match[4] || '',
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'dpi_import',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for DPI export directives.
 */
function scanDpiExports(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DPI_PATTERNS.dpiExport);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'dpi_export',
      funcName: match[1],
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'dpi_export',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}

/**
 * Scan for `line directives.
 */
function scanLineDirectives(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  scopeTracker: ScopeTracker,
  directives: Directive[]
): void {
  const pattern = copyPattern(DIRECTIVE_PATTERNS.line);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    const data: DirectiveData = {
      kind: 'line',
      lineNum: parseInt(match[1], 10),
      fileName: match[2],
      level: parseInt(match[3], 10),
    };

    directives.push({
      id: locationId(filePath, loc.line, loc.col),
      kind: 'line',
      location: { file: filePath, line: loc.line, col: loc.col },
      data,
    });
  }
}
