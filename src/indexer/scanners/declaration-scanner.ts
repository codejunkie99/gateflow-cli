/**
 * Declaration Scanner Module
 *
 * Scans for declaration constructs in SystemVerilog code.
 *
 * Declarations are "birth certificates" - where things are DEFINED.
 *
 * Declaration kinds scanned:
 * - Containers: module, package, interface, class, program, checker, config
 * - Functions: function, task
 * - Types: typedef, struct, union, enum, enum_value
 * - Ports/Signals: port, parameter, localparam, signal
 * - Interface: modport
 * - SVA: sequence, property
 * - Coverage: covergroup, constraint
 * - Clocking: clocking
 * - Blocks: generate_block, always_block, initial_block
 *
 * @module scanners/declaration-scanner
 */

import type {
  Declaration,
  DeclarationKind,
  DeclarationData,
  LineOffsets,
  Guard,
} from '../types/index.js';
import { locationId, declarationId } from '../ids/index.js';
import { getLocation } from '../reader/index.js';
import { DECLARATION_PATTERNS, copyPattern } from './patterns.js';
import { ScopeTracker } from './scope-tracker.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from scanning declarations.
 */
export interface DeclarationScanResult {
  /** All declarations found */
  declarations: Declaration[];
}

// ============================================================================
// Main Scanner Function
// ============================================================================

/**
 * Scan content for declarations.
 *
 * This is a two-pass process:
 * 1. First pass: Find all scope boundaries (module/endmodule, etc.)
 * 2. Second pass: Find declarations within proper scope context
 *
 * @param content - Preprocessed code (comments stripped)
 * @param filePath - Absolute path to the file
 * @param lineOffsets - Line offset index for location lookup
 * @returns All declarations found
 *
 * @example
 * ```typescript
 * const { declarations } = scanDeclarations(
 *   content,
 *   '/path/to/file.sv',
 *   lineOffsets
 * );
 *
 * for (const decl of declarations) {
 *   console.log(`${decl.kind}: ${decl.name} at line ${decl.location.line}`);
 * }
 * ```
 */
export function scanDeclarations(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets
): DeclarationScanResult {
  const declarations: Declaration[] = [];
  const scopeTracker = new ScopeTracker();

  // Build a list of all scope-affecting events in order
  const events = buildScopeEvents(content, lineOffsets);

  // Process events in order
  for (const event of events) {
    if (event.type === 'enter') {
      // Create declaration for scope entry
      const decl = createDeclaration(
        event.kind,
        event.name,
        filePath,
        event.loc.line,
        event.loc.col,
        scopeTracker.getScope(),
        scopeTracker.getParentId(),
        scopeTracker.getGuard(),
        event.data
      );

      declarations.push(decl);

      // Enter scope
      scopeTracker.enter(event.kind, event.name, event.loc.line, decl.id, event.data);
    } else if (event.type === 'exit') {
      // Exit scope
      scopeTracker.exit(event.kind);
    } else if (event.type === 'declaration') {
      // Non-scoping declaration (typedef, port, signal, etc.)
      const decl = createDeclaration(
        event.kind,
        event.name,
        filePath,
        event.loc.line,
        event.loc.col,
        scopeTracker.getScope(),
        scopeTracker.getParentId(),
        scopeTracker.getGuard(),
        event.data
      );

      declarations.push(decl);
    }
  }

  return { declarations };
}

// ============================================================================
// Scope Event Building
// ============================================================================

/**
 * A scope-related event (enter, exit, or declaration).
 */
interface ScopeEvent {
  type: 'enter' | 'exit' | 'declaration';
  kind: DeclarationKind;
  name: string;
  loc: { line: number; col: number };
  offset: number;
  data?: Partial<DeclarationData>;
}

/**
 * Build a sorted list of all scope events.
 */
function buildScopeEvents(content: string, lineOffsets: LineOffsets): ScopeEvent[] {
  const events: ScopeEvent[] = [];

  // Scan for container declarations and their endings
  scanContainerEvents(content, lineOffsets, events);

  // Scan for non-scoping declarations
  scanTypedefs(content, lineOffsets, events);
  scanEnums(content, lineOffsets, events);
  scanStructs(content, lineOffsets, events);
  scanPorts(content, lineOffsets, events);
  scanParameters(content, lineOffsets, events);
  scanSignals(content, lineOffsets, events);
  scanModports(content, lineOffsets, events);
  scanSequences(content, lineOffsets, events);
  scanProperties(content, lineOffsets, events);
  scanCovergroups(content, lineOffsets, events);
  scanConstraints(content, lineOffsets, events);
  scanClockingBlocks(content, lineOffsets, events);
  scanAlwaysBlocks(content, lineOffsets, events);
  scanInitialBlocks(content, lineOffsets, events);

  // Sort by offset
  events.sort((a, b) => a.offset - b.offset);

  return events;
}

/**
 * Scan for container declarations (module, class, etc.) and their end keywords.
 */
function scanContainerEvents(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  // Module
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.module,
    DECLARATION_PATTERNS.endmodule,
    'module',
    (match) => ({ name: match[1], data: { kind: 'module' as const, params: [] } })
  );

  // Package
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.package,
    DECLARATION_PATTERNS.endpackage,
    'package',
    (match) => ({ name: match[1], data: { kind: 'package' as const } })
  );

  // Interface
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.interface,
    DECLARATION_PATTERNS.endinterface,
    'interface',
    (match) => ({ name: match[1], data: { kind: 'interface' as const, params: [] } })
  );

  // Program
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.program,
    DECLARATION_PATTERNS.endprogram,
    'program',
    (match) => ({ name: match[1], data: { kind: 'program' as const } })
  );

  // Class
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.class,
    DECLARATION_PATTERNS.endclass,
    'class',
    (match) => ({
      name: match[2],
      data: {
        kind: 'class' as const,
        isVirtual: !!match[1],
        extendsName: match[3] || undefined,
      },
    })
  );

  // Function
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.function,
    DECLARATION_PATTERNS.endfunction,
    'function',
    (match) => ({
      name: match[3],
      data: {
        kind: 'function' as const,
        returnType: match[2],
        args: [],
      },
    })
  );

  // Task
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.task,
    DECLARATION_PATTERNS.endtask,
    'task',
    (match) => ({
      name: match[2],
      data: {
        kind: 'task' as const,
        args: [],
      },
    })
  );

  // Checker
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.checker,
    DECLARATION_PATTERNS.endchecker,
    'checker',
    (match) => ({
      name: match[1],
      data: {
        kind: 'checker' as const,
        ports: [],
      },
    })
  );

  // Configuration block
  scanContainerPair(
    content,
    lineOffsets,
    events,
    DECLARATION_PATTERNS.config,
    DECLARATION_PATTERNS.endconfig,
    'config',
    (match) => ({
      name: match[1],
      data: {
        kind: 'config' as const,
        cellUseStatements: [],
      },
    })
  );
}

/**
 * Helper to scan for a container and its end keyword.
 */
function scanContainerPair(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[],
  startPattern: RegExp,
  endPattern: RegExp,
  kind: DeclarationKind,
  extractInfo: (match: RegExpExecArray) => { name: string; data: Partial<DeclarationData> }
): void {
  // Find all start keywords
  const start = copyPattern(startPattern);
  let match;
  while ((match = start.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const info = extractInfo(match);
    events.push({
      type: 'enter',
      kind,
      name: info.name,
      loc,
      offset: match.index,
      data: info.data,
    });
  }

  // Find all end keywords
  const end = copyPattern(endPattern);
  while ((match = end.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    events.push({
      type: 'exit',
      kind,
      name: '',
      loc,
      offset: match.index,
    });
  }
}

// ============================================================================
// Non-Scoping Declaration Scanners
// ============================================================================

/**
 * Scan for typedef declarations.
 */
function scanTypedefs(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  // Skip enum/struct/union typedefs (handled separately)
  const pattern = copyPattern(DECLARATION_PATTERNS.typedef);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const underlying = match[1].trim();

    // Skip if it's an enum, struct, or union (handled elsewhere)
    if (
      underlying.startsWith('enum') ||
      underlying.startsWith('struct') ||
      underlying.startsWith('union')
    ) {
      continue;
    }

    const loc = getLocation(lineOffsets, match.index);
    events.push({
      type: 'declaration',
      kind: 'typedef',
      name: match[2],
      loc,
      offset: match.index,
      data: {
        kind: 'typedef',
        underlyingType: underlying,
      },
    });
  }
}

/**
 * Scan for enum declarations.
 */
function scanEnums(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.enum);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const enumName = match[3];
    const baseType = match[1] || undefined;
    const valuesStr = match[2];

    // Add the enum declaration
    events.push({
      type: 'declaration',
      kind: 'enum',
      name: enumName,
      loc,
      offset: match.index,
      data: {
        kind: 'enum',
        baseType,
      },
    });

    // Parse enum values
    const values = valuesStr.split(',').map((v) => v.trim());
    let ordinal = 0;

    for (const valueStr of values) {
      if (!valueStr) continue;

      // Parse "NAME" or "NAME = value"
      const valueMatch = valueStr.match(/(\w+)(?:\s*=\s*(.+))?/);
      if (valueMatch) {
        const valueName = valueMatch[1];
        const explicitValue = valueMatch[2]?.trim();

        events.push({
          type: 'declaration',
          kind: 'enum_value',
          name: valueName,
          loc, // Use enum's location (could be more precise)
          offset: match.index,
          data: {
            kind: 'enum_value',
            value: explicitValue,
            ordinal,
          },
        });

        ordinal++;
      }
    }
  }
}

/**
 * Scan for struct declarations.
 */
function scanStructs(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.struct);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const isPacked = !!match[1];
    const body = match[2];
    const name = match[3];

    // Parse fields from body
    const fields = parseStructFields(body);

    events.push({
      type: 'declaration',
      kind: 'struct',
      name,
      loc,
      offset: match.index,
      data: {
        kind: 'struct',
        fields,
      },
    });
  }
}

/**
 * Parse struct/union fields from body.
 */
function parseStructFields(body: string): Array<{ name: string; type: string }> {
  const fields: Array<{ name: string; type: string }> = [];

  // Simple field pattern: type name;
  const fieldPattern = /(\w+(?:\s*\[[^\]]+\])?)\s+(\w+)\s*;/g;
  let match;

  while ((match = fieldPattern.exec(body)) !== null) {
    fields.push({
      type: match[1].trim(),
      name: match[2],
    });
  }

  return fields;
}

/**
 * Scan for port declarations.
 */
function scanPorts(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.port);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'port',
      name: match[4],
      loc,
      offset: match.index,
      data: {
        kind: 'port',
        direction: match[1] as 'input' | 'output' | 'inout' | 'ref',
        portType: match[2] || 'logic',
        width: match[3] || undefined,
      },
    });
  }
}

/**
 * Scan for parameter declarations.
 */
function scanParameters(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  // Parameters
  const paramPattern = copyPattern(DECLARATION_PATTERNS.parameter);
  let match;

  while ((match = paramPattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'parameter',
      name: match[2],
      loc,
      offset: match.index,
      data: {
        kind: 'parameter',
        paramType: match[1] || 'integer',
        defaultValue: match[3]?.trim(),
      },
    });
  }

  // Localparams
  const localparamPattern = copyPattern(DECLARATION_PATTERNS.localparam);

  while ((match = localparamPattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'localparam',
      name: match[2],
      loc,
      offset: match.index,
      data: {
        kind: 'localparam',
        paramType: match[1] || 'integer',
        value: match[3]?.trim() || '',
      },
    });
  }
}

/**
 * Scan for signal declarations.
 */
function scanSignals(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.signal);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'signal',
      name: match[3],
      loc,
      offset: match.index,
      data: {
        kind: 'signal',
        signalType: match[1],
        width: match[2] || undefined,
      },
    });
  }
}

/**
 * Scan for modport declarations.
 */
function scanModports(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.modport);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const portsStr = match[2];

    // Parse ports
    const ports = parseModportPorts(portsStr);

    events.push({
      type: 'declaration',
      kind: 'modport',
      name: match[1],
      loc,
      offset: match.index,
      data: {
        kind: 'modport',
        ports,
      },
    });
  }
}

/**
 * Parse modport port list.
 */
function parseModportPorts(portsStr: string): Array<{ name: string; direction: string }> {
  const ports: Array<{ name: string; direction: string }> = [];

  // Pattern: direction (port1, port2, ...)
  const groupPattern = /(input|output|inout)\s*\(([^)]+)\)/g;
  let match;

  while ((match = groupPattern.exec(portsStr)) !== null) {
    const direction = match[1];
    const portNames = match[2].split(',').map((p) => p.trim());

    for (const name of portNames) {
      if (name) {
        ports.push({ name, direction });
      }
    }
  }

  return ports;
}

/**
 * Scan for sequence declarations.
 */
function scanSequences(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.sequence);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'sequence',
      name: match[1],
      loc,
      offset: match.index,
      data: {
        kind: 'sequence',
      },
    });
  }
}

/**
 * Scan for property declarations.
 */
function scanProperties(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.property);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'property',
      name: match[1],
      loc,
      offset: match.index,
      data: {
        kind: 'property',
      },
    });
  }
}

/**
 * Scan for covergroup declarations.
 */
function scanCovergroups(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.covergroup);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'covergroup',
      name: match[1],
      loc,
      offset: match.index,
      data: {
        kind: 'covergroup',
      },
    });
  }
}

/**
 * Scan for constraint declarations.
 */
function scanConstraints(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.constraint);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'constraint',
      name: match[1],
      loc,
      offset: match.index,
      data: {
        kind: 'constraint',
      },
    });
  }
}

/**
 * Scan for clocking block declarations.
 */
function scanClockingBlocks(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.clocking);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'clocking',
      name: match[1],
      loc,
      offset: match.index,
      data: {
        kind: 'clocking',
        clockEvent: match[2],
        signals: [],
      },
    });
  }
}

/**
 * Scan for always blocks.
 */
function scanAlwaysBlocks(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  // always_ff
  let pattern = copyPattern(DECLARATION_PATTERNS.always_ff);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'always_block',
      name: `always_ff_${loc.line}`,
      loc,
      offset: match.index,
      data: {
        kind: 'always_block',
        blockType: 'always_ff',
        sensitivity: match[1],
      },
    });
  }

  // always_comb
  pattern = copyPattern(DECLARATION_PATTERNS.always_comb);
  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'always_block',
      name: `always_comb_${loc.line}`,
      loc,
      offset: match.index,
      data: {
        kind: 'always_block',
        blockType: 'always_comb',
      },
    });
  }

  // always_latch
  pattern = copyPattern(DECLARATION_PATTERNS.always_latch);
  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'always_block',
      name: `always_latch_${loc.line}`,
      loc,
      offset: match.index,
      data: {
        kind: 'always_block',
        blockType: 'always_latch',
      },
    });
  }

  // Generic always
  pattern = copyPattern(DECLARATION_PATTERNS.always);
  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'always_block',
      name: `always_${loc.line}`,
      loc,
      offset: match.index,
      data: {
        kind: 'always_block',
        blockType: 'always',
        sensitivity: match[1],
      },
    });
  }
}

/**
 * Scan for initial blocks.
 */
function scanInitialBlocks(
  content: string,
  lineOffsets: LineOffsets,
  events: ScopeEvent[]
): void {
  const pattern = copyPattern(DECLARATION_PATTERNS.initial);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);

    events.push({
      type: 'declaration',
      kind: 'initial_block',
      name: `initial_${loc.line}`,
      loc,
      offset: match.index,
      data: {
        kind: 'initial_block',
      },
    });
  }
}

// ============================================================================
// Declaration Creation
// ============================================================================

/**
 * Create a Declaration object.
 */
function createDeclaration(
  kind: DeclarationKind,
  name: string,
  filePath: string,
  line: number,
  col: number,
  scope: string[],
  parentId: string | undefined,
  guard: { condition: string; inverted: boolean } | undefined,
  data: Partial<DeclarationData> | undefined
): Declaration {
  const id = declarationId(filePath, kind, name, scope);
  const locId = locationId(filePath, line, col);

  return {
    id,
    locationId: locId,
    kind,
    name,
    location: { file: filePath, line, col },
    scope,
    parentId,
    guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    data: { kind, ...data } as DeclarationData,
  };
}
