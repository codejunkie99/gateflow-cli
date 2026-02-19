/**
 * Basic (Fallback) SystemVerilog Parser
 *
 * Best-effort extraction without external parsers (Verible/Slang).
 * Intended to keep core CLI/indexer features usable in "no toolchain" environments.
 *
 * What it extracts (heuristic):
 * - Directives: `include, `define, `undef, `ifdef/`ifndef/`else/`endif
 * - Declarations: module, package, interface, class, function, task (limited)
 * - References: import, extends, macro_usage
 * - Instances: module/interface instantiation patterns, bind statements (limited)
 *
 * Limitations:
 * - Not a complete SV parser; expect false negatives/positives on complex code.
 * - Many declaration kinds (enum/struct/union/signal/etc.) are not extracted here.
 * - Port/parameter extraction is intentionally minimal.
 *
 * @module fallback/basic-parser
 */

import type { LineOffsets } from '../types/index.js';
import type { Declaration } from '../types/declaration.js';
import type { Reference } from '../types/reference.js';
import type { Instance } from '../types/instance.js';
import type { Directive } from '../types/directive.js';
import type { ParseError, Guard, Location } from '../types/location.js';
import { getLocation } from '../reader/index.js';
import { declarationId, locationId } from '../ids/index.js';

interface BasicParseResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  directives: Directive[];
  errors: ParseError[];
}

type ScopeKind = 'module' | 'package' | 'interface' | 'class' | 'function' | 'task';

interface OpenScope {
  kind: ScopeKind;
  name: string;
  decl: Declaration;
}

const DIRECTIVE_KEYWORDS = new Set([
  'include',
  'define',
  'undef',
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

// Conservative keyword list used to avoid obvious false-positive instances.
const NON_INSTANCE_TYPE_KEYWORDS = new Set([
  'module',
  'interface',
  'package',
  'class',
  'function',
  'task',
  'program',
  'config',
  'import',
  'export',
  'typedef',
  'struct',
  'union',
  'enum',
  'property',
  'sequence',
  'checker',
  'clocking',
  'generate',
  'endgenerate',
  'begin',
  'end',
  'if',
  'else',
  'for',
  'foreach',
  'while',
  'do',
  'case',
  'assert',
  'assume',
  'cover',
  'always',
  'always_ff',
  'always_comb',
  'always_latch',
  'initial',
  'final',
  'assign',
  'wire',
  'logic',
  'reg',
  'bit',
  'byte',
  'shortint',
  'int',
  'longint',
  'integer',
  'time',
  'real',
  'shortreal',
  'string',
  'void',
  'localparam',
  'parameter',
  'input',
  'output',
  'inout',
  'ref',
  'virtual',
  'static',
  'automatic',
  'signed',
  'unsigned',
  'bind',
]);

/**
 * Parse a SystemVerilog file using heuristics only.
 */
export function parseSystemVerilogBasic(options: {
  filePath: string;
  content: string;
  lineOffsets: LineOffsets;
  warningMessage?: string;
}): BasicParseResult {
  const { filePath, content, lineOffsets, warningMessage } = options;

  const errors: ParseError[] = [];
  if (warningMessage) {
    errors.push({
      message: warningMessage,
      location: { file: filePath, line: 1, col: 1 },
      severity: 'warning',
    });
  }

  // For regex-based extraction, mask comments/strings to avoid matching inside them.
  const masked = maskCommentsAndStrings(content);
  const lines = content.split(/\r?\n/);
  const maskedLines = masked.split(/\r?\n/);

  // Pass 1: directives + guard context per line.
  const directives: Directive[] = [];
  const guardByLine: Array<Guard | undefined> = new Array(lines.length + 1);
  const guardStack: Array<{ condition: string; inverted: boolean }> = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    guardByLine[lineNo] = computeGuard(guardStack);

    const rawLine = lines[i];
    const parsed = parseDirectiveLine(rawLine);
    if (!parsed) continue;

    const loc = directiveLocation(filePath, lineNo, rawLine);
    const currentGuard = guardByLine[lineNo];

    const id =
      (parsed.kind === 'define' || parsed.kind === 'undef') && parsed.name
        ? declarationId(filePath, 'macro', parsed.name, [])
        : locationId(filePath, loc.line, loc.col);

    directives.push({
      id,
      kind: parsed.kind,
      location: loc,
      data: parsed.data,
      guard: currentGuard,
    });

    // Update guard stack for subsequent lines.
    if (parsed.guardOp) {
      switch (parsed.guardOp.op) {
        case 'push':
          guardStack.push({
            condition: parsed.guardOp.condition,
            inverted: parsed.guardOp.inverted,
          });
          break;
        case 'replace':
          if (guardStack.length > 0) {
            guardStack[guardStack.length - 1] = {
              condition: parsed.guardOp.condition,
              inverted: false,
            };
          }
          break;
        case 'toggle':
          if (guardStack.length > 0) {
            guardStack[guardStack.length - 1] = {
              condition: guardStack[guardStack.length - 1].condition,
              inverted: !guardStack[guardStack.length - 1].inverted,
            };
          }
          break;
        case 'pop':
          guardStack.pop();
          break;
      }
    }
  }

  // Pass 2: declarations and scope context per line (best-effort endLine tracking).
  const declarations: Declaration[] = [];
  const scopeByLine: Array<string[]> = new Array(lines.length + 1);
  const moduleByLine: Array<string | undefined> = new Array(lines.length + 1);

  const open: OpenScope[] = [];

  for (let i = 0; i < maskedLines.length; i++) {
    const lineNo = i + 1;
    scopeByLine[lineNo] = open.map((s) => s.name);
    moduleByLine[lineNo] = lastOpenName(open, 'module');

    const line = maskedLines[i];

    // --------------------------
    // Scope starts
    // --------------------------

    const moduleMatch = line.match(/\bmodule\b\s+([A-Za-z_][\w$]*)/);
    if (moduleMatch && !line.includes('endmodule')) {
      const name = moduleMatch[1];
      const startOffset = (lineOffsets[lineNo - 1] ?? 0) + (moduleMatch.index ?? 0);
      const start = getLocation(lineOffsets, startOffset);
      const scope = open.map((s) => s.name);
      const decl = createDecl({
        filePath,
        kind: 'module',
        name,
        scope,
        parentId: open.length > 0 ? open[open.length - 1].decl.id : undefined,
        location: { file: filePath, line: start.line, col: start.col },
        data: { kind: 'module', params: [] },
        guard: guardByLine[lineNo],
      });
      declarations.push(decl);
      open.push({ kind: 'module', name, decl });
    }

    const pkgMatch = line.match(/\bpackage\b\s+([A-Za-z_][\w$]*)/);
    if (pkgMatch && !line.includes('endpackage')) {
      const name = pkgMatch[1];
      const startOffset = (lineOffsets[lineNo - 1] ?? 0) + (pkgMatch.index ?? 0);
      const start = getLocation(lineOffsets, startOffset);
      const scope = open.map((s) => s.name);
      const decl = createDecl({
        filePath,
        kind: 'package',
        name,
        scope,
        parentId: open.length > 0 ? open[open.length - 1].decl.id : undefined,
        location: { file: filePath, line: start.line, col: start.col },
        data: { kind: 'package' },
        guard: guardByLine[lineNo],
      });
      declarations.push(decl);
      open.push({ kind: 'package', name, decl });
    }

    const ifaceMatch = line.match(/\binterface\b\s+([A-Za-z_][\w$]*)/);
    if (ifaceMatch && !line.includes('endinterface')) {
      const name = ifaceMatch[1];
      const startOffset = (lineOffsets[lineNo - 1] ?? 0) + (ifaceMatch.index ?? 0);
      const start = getLocation(lineOffsets, startOffset);
      const scope = open.map((s) => s.name);
      const decl = createDecl({
        filePath,
        kind: 'interface',
        name,
        scope,
        parentId: open.length > 0 ? open[open.length - 1].decl.id : undefined,
        location: { file: filePath, line: start.line, col: start.col },
        data: { kind: 'interface', params: [] },
        guard: guardByLine[lineNo],
      });
      declarations.push(decl);
      open.push({ kind: 'interface', name, decl });
    }

    const classMatch = line.match(/\b(virtual\s+)?class\b\s+([A-Za-z_][\w$]*)/);
    if (classMatch && !line.includes('endclass')) {
      const isVirtual = !!classMatch[1];
      const name = classMatch[2];
      const startOffset = (lineOffsets[lineNo - 1] ?? 0) + (classMatch.index ?? 0);
      const start = getLocation(lineOffsets, startOffset);
      const scope = open.map((s) => s.name);

      // Best-effort extends capture (same-line).
      const extendsMatch = line.match(/\bextends\b\s+([A-Za-z_][\w$]*(?:::[A-Za-z_][\w$]*)*)/);
      const extendsName = extendsMatch ? extendsMatch[1] : undefined;

      const decl = createDecl({
        filePath,
        kind: 'class',
        name,
        scope,
        parentId: open.length > 0 ? open[open.length - 1].decl.id : undefined,
        location: { file: filePath, line: start.line, col: start.col },
        data: { kind: 'class', isVirtual, extendsName },
        guard: guardByLine[lineNo],
      });
      declarations.push(decl);
      open.push({ kind: 'class', name, decl });
    }

    // Function/task start detection is intentionally conservative:
    // only consider when statement starts with "function"/"task".
    const fnMatch = line.match(/^\s*function\b[\s\S]*?\b([A-Za-z_][\w$]*)\s*\(/);
    if (fnMatch && !line.includes('endfunction')) {
      const name = fnMatch[1];
      const startOffset = (lineOffsets[lineNo - 1] ?? 0) + (fnMatch.index ?? 0);
      const start = getLocation(lineOffsets, startOffset);
      const scope = open.map((s) => s.name);
      const decl = createDecl({
        filePath,
        kind: 'function',
        name,
        scope,
        parentId: open.length > 0 ? open[open.length - 1].decl.id : undefined,
        location: { file: filePath, line: start.line, col: start.col },
        data: { kind: 'function', returnType: 'void', args: [] },
        guard: guardByLine[lineNo],
      });
      declarations.push(decl);
      open.push({ kind: 'function', name, decl });
    }

    const taskMatch = line.match(/^\s*task\b[\s\S]*?\b([A-Za-z_][\w$]*)\b/);
    if (taskMatch && !line.includes('endtask')) {
      const name = taskMatch[1];
      const startOffset = (lineOffsets[lineNo - 1] ?? 0) + (taskMatch.index ?? 0);
      const start = getLocation(lineOffsets, startOffset);
      const scope = open.map((s) => s.name);
      const decl = createDecl({
        filePath,
        kind: 'task',
        name,
        scope,
        parentId: open.length > 0 ? open[open.length - 1].decl.id : undefined,
        location: { file: filePath, line: start.line, col: start.col },
        data: { kind: 'task', args: [] },
        guard: guardByLine[lineNo],
      });
      declarations.push(decl);
      open.push({ kind: 'task', name, decl });
    }

    // --------------------------
    // Scope ends
    // --------------------------
    // Close scopes on matching end keywords.
    // If nesting is inconsistent, pop back to the last matching kind.
    closeScopeIfPresent(open, 'function', line, filePath, lineNo, 'endfunction');
    closeScopeIfPresent(open, 'task', line, filePath, lineNo, 'endtask');
    closeScopeIfPresent(open, 'class', line, filePath, lineNo, 'endclass');
    closeScopeIfPresent(open, 'interface', line, filePath, lineNo, 'endinterface');
    closeScopeIfPresent(open, 'package', line, filePath, lineNo, 'endpackage');
    closeScopeIfPresent(open, 'module', line, filePath, lineNo, 'endmodule');
  }

  // Pass 3: references and instances (regex over masked full content).
  const references: Reference[] = [];
  const instances: Instance[] = [];

  // Import references: import pkg::*, pkg::name;
  const importRe = /(^|[;\n\r])\s*import\s+([^;]+);/gm;
  for (let m = importRe.exec(masked); m; m = importRe.exec(masked)) {
    const matchText = m[0];
    const clause = (m[2] || '').trim();
    const importPosInMatch = matchText.indexOf('import');
    const offset = (m.index ?? 0) + (importPosInMatch >= 0 ? importPosInMatch : 0);

    const loc0 = getLocation(lineOffsets, offset);
    const lineNo = loc0.line;
    const scope = scopeByLine[lineNo] ?? [];
    const guard = guardByLine[lineNo];

    for (const part of splitTopLevelCommas(clause)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const item = trimmed.replace(/\s+/g, '');
      const itemMatch = item.match(/^([A-Za-z_][\w$]*)(?:::([A-Za-z_][\w$]*|\*))?$/);
      if (!itemMatch) continue;

      const pkg = itemMatch[1];
      const memberName = itemMatch[2];

      references.push({
        id: locationId(filePath, loc0.line, loc0.col),
        kind: 'import',
        targetName: pkg,
        location: { file: filePath, line: loc0.line, col: loc0.col },
        scope,
        guard,
        data: memberName ? { kind: 'import', memberName } : { kind: 'import' },
      });
    }
  }

  // Macro usage references: `NAME (excluding directive keywords at start of line).
  const macroRe = /`([A-Za-z_][\w$]*)/g;
  for (let m = macroRe.exec(masked); m; m = macroRe.exec(masked)) {
    const name = m[1];
    const offset = m.index ?? 0;
    const loc0 = getLocation(lineOffsets, offset);
    const lineNo = loc0.line;

    // If it's a directive keyword at start-of-line, skip (directive already captured).
    if (DIRECTIVE_KEYWORDS.has(name) && isStartOfLineOnlyWhitespace(content, lineOffsets, lineNo, offset)) {
      continue;
    }

    const scope = scopeByLine[lineNo] ?? [];
    const guard = guardByLine[lineNo];

    references.push({
      id: locationId(filePath, loc0.line, loc0.col),
      kind: 'macro_usage',
      targetName: name,
      location: { file: filePath, line: loc0.line, col: loc0.col },
      scope,
      guard,
    });
  }

  // Extends references: rely on class decl data (already captured best-effort).
  // Create explicit references to support dependency graph.
  for (const decl of declarations) {
    if (decl.kind !== 'class') continue;
    if (decl.data.kind !== 'class') continue;
    if (!decl.data.extendsName) continue;

    references.push({
      id: locationId(filePath, decl.location.line, decl.location.col),
      kind: 'extends',
      targetName: decl.data.extendsName,
      location: { file: filePath, line: decl.location.line, col: decl.location.col },
      scope: decl.scope,
      guard: decl.guard,
      data: { kind: 'extends' },
    });
  }

  // Bind instances: bind <bindTarget> <targetType> <instanceName> ( ... );
  const bindRe = /(^|[;\n\r])\s*bind\s+([A-Za-z_][\w$]*)\s+([A-Za-z_][\w$]*(?:::[A-Za-z_][\w$]*)*)\s+([A-Za-z_][\w$]*)\s*\(/gm;
  for (let m = bindRe.exec(masked); m; m = bindRe.exec(masked)) {
    const matchText = m[0];
    const bindPosInMatch = matchText.indexOf('bind');
    const offset = (m.index ?? 0) + (bindPosInMatch >= 0 ? bindPosInMatch : 0);
    const loc0 = getLocation(lineOffsets, offset);
    const lineNo = loc0.line;

    const bindTarget = m[2];
    const targetType = m[3];
    const instanceName = m[4];
    const targetName = targetType.split('::').pop() || targetType;

    instances.push({
      id: locationId(filePath, loc0.line, loc0.col),
      instanceKind: 'bind',
      instanceName,
      targetName,
      bindTarget,
      location: { file: filePath, line: loc0.line, col: loc0.col },
      parentScope: moduleByLine[lineNo] ? [moduleByLine[lineNo]!] : [],
      guard: guardByLine[lineNo],
    });
  }

  // Regular instances: <type> [#(...)] <name> [array] ( ... );
  const instRe =
    /(^|[;\n\r])\s*([A-Za-z_][\w$]*(?:::[A-Za-z_][\w$]*)*)\s*(?:#\s*\([^;]*?\)\s*)?([A-Za-z_][\w$]*)\s*(\[[^\]\n\r]+?\])?\s*\(/gm;

  for (let m = instRe.exec(masked); m; m = instRe.exec(masked)) {
    const typeFull = m[2];
    const instanceName = m[3];
    const arrayRange = m[4];

    const typeLast = typeFull.split('::').pop() || typeFull;
    if (NON_INSTANCE_TYPE_KEYWORDS.has(typeLast)) {
      continue;
    }

    // Skip bind (handled above) and obvious class constraints etc.
    if (typeLast === 'bind') continue;

    const matchText = m[0];
    const typePosInMatch = matchText.indexOf(typeFull);
    const offset = (m.index ?? 0) + (typePosInMatch >= 0 ? typePosInMatch : 0);

    const loc0 = getLocation(lineOffsets, offset);
    const lineNo = loc0.line;
    const parentModule = moduleByLine[lineNo];

    instances.push({
      id: locationId(filePath, loc0.line, loc0.col),
      instanceKind: 'module',
      instanceName,
      targetName: typeLast,
      arrayRange,
      location: { file: filePath, line: loc0.line, col: loc0.col },
      parentScope: parentModule ? [parentModule] : [],
      guard: guardByLine[lineNo],
    });
  }

  return {
    declarations,
    references,
    instances,
    directives,
    errors,
  };
}

function createDecl(args: {
  filePath: string;
  kind: Declaration['kind'];
  name: string;
  scope: string[];
  parentId?: string;
  location: Location;
  data: Declaration['data'];
  guard?: Guard;
}): Declaration {
  const id = declarationId(args.filePath, args.kind, args.name, args.scope);
  const locId = locationId(args.filePath, args.location.line, args.location.col);
  return {
    id,
    locationId: locId,
    kind: args.kind,
    name: args.name,
    location: args.location,
    scope: args.scope,
    parentId: args.parentId,
    guard: args.guard,
    data: args.data,
  };
}

function lastOpenName(open: OpenScope[], kind: ScopeKind): string | undefined {
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i].kind === kind) return open[i].name;
  }
  return undefined;
}

function closeScopeIfPresent(
  open: OpenScope[],
  kind: ScopeKind,
  line: string,
  filePath: string,
  lineNo: number,
  endKeyword: string
): void {
  if (!new RegExp(`\\b${escapeRegExp(endKeyword)}\\b`).test(line)) {
    return;
  }

  // Find last matching kind and close everything inside it (best-effort recovery).
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i].kind !== kind) continue;

    const endCol = line.indexOf(endKeyword);
    const endCol1 = endCol >= 0 ? endCol + endKeyword.length + 1 : 1;

    for (let j = open.length - 1; j >= i; j--) {
      open[j].decl.location.endLine = lineNo;
      open[j].decl.location.endCol = endCol1;
    }

    open.length = i; // truncate
    return;
  }
}

function directiveLocation(filePath: string, line: number, rawLine: string): Location {
  const idx = rawLine.indexOf('`');
  const col = idx >= 0 ? idx + 1 : 1;
  return { file: filePath, line, col };
}

function parseDirectiveLine(rawLine: string): null | {
  kind: Directive['kind'];
  name?: string;
  data: Directive['data'];
  guardOp?: { op: 'push'; condition: string; inverted: boolean }
         | { op: 'replace'; condition: string }
         | { op: 'toggle' }
         | { op: 'pop' };
} {
  const trimmed = rawLine.trimStart();
  if (!trimmed.startsWith('`')) return null;

  // Strip trailing line comment (best-effort; doesn't attempt to handle // inside quotes).
  const noLineComment = trimmed.replace(/\s+\/\/.*$/, '').trim();

  const m = noLineComment.match(/^`([A-Za-z_][\w$]*)\b([\s\S]*)$/);
  if (!m) return null;

  const kw = m[1];
  const rest = (m[2] || '').trim();

  if (!DIRECTIVE_KEYWORDS.has(kw)) {
    // It's a macro call like `FOO(...), not a directive.
    return null;
  }

  switch (kw) {
    case 'include': {
      const pathMatch =
        rest.match(/^["']([^"']+)["']/) ||
        rest.match(/^<([^>]+)>/);
      const includePath = pathMatch ? pathMatch[1] : rest.replace(/^["'<]|[">']$/g, '');
      return { kind: 'include', data: { kind: 'include', path: includePath } };
    }
    case 'define': {
      const nameMatch = rest.match(/^([A-Za-z_][\w$]*)/);
      const name = nameMatch ? nameMatch[1] : '';
      let afterName = nameMatch ? rest.slice(nameMatch[0].length) : rest;
      afterName = afterName.trimStart();

      let params: string[] | undefined;
      if (afterName.startsWith('(')) {
        const endIdx = findMatchingParen(afterName, 0);
        if (endIdx > 0) {
          const inside = afterName.slice(1, endIdx);
          params = inside
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          afterName = afterName.slice(endIdx + 1).trimStart();
        }
      }

      const body = afterName.trim();
      return { kind: 'define', name, data: { kind: 'define', name, params, body } };
    }
    case 'undef': {
      const nameMatch = rest.match(/^([A-Za-z_][\w$]*)/);
      const name = nameMatch ? nameMatch[1] : '';
      return { kind: 'undef', name, data: { kind: 'undef', name } };
    }
    case 'ifdef': {
      const condMatch = rest.match(/^([A-Za-z_][\w$]*)/);
      const condition = condMatch ? condMatch[1] : '';
      return {
        kind: 'ifdef',
        data: { kind: 'ifdef', condition },
        guardOp: { op: 'push', condition, inverted: false },
      };
    }
    case 'ifndef': {
      const condMatch = rest.match(/^([A-Za-z_][\w$]*)/);
      const condition = condMatch ? condMatch[1] : '';
      return {
        kind: 'ifndef',
        data: { kind: 'ifndef', condition },
        guardOp: { op: 'push', condition, inverted: true },
      };
    }
    case 'elsif': {
      const condMatch = rest.match(/^([A-Za-z_][\w$]*)/);
      const condition = condMatch ? condMatch[1] : '';
      return {
        kind: 'elsif',
        data: { kind: 'elsif', condition },
        guardOp: { op: 'replace', condition },
      };
    }
    case 'else':
      return { kind: 'else', data: { kind: 'else' }, guardOp: { op: 'toggle' } };
    case 'endif':
      return { kind: 'endif', data: { kind: 'endif' }, guardOp: { op: 'pop' } };
    case 'timescale':
      return { kind: 'timescale', data: parseTimescale(rest) };
    case 'default_nettype':
      return { kind: 'default_nettype', data: { kind: 'default_nettype', nettype: rest.split(/\s+/)[0] || '' } };
    case 'pragma':
      return { kind: 'pragma', data: { kind: 'pragma', text: rest } };
    case 'resetall':
      return { kind: 'resetall', data: { kind: 'resetall' } };
    case 'line':
      return { kind: 'line', data: parseLineDirective(rest) };
    default:
      return null;
  }
}

function parseTimescale(rest: string): Directive['data'] {
  const raw = rest.replace(/\s+/g, '');
  const [timeUnit, precision] = raw.split('/');
  return {
    kind: 'timescale',
    timeUnit: timeUnit || '',
    precision: precision || '',
  };
}

function parseLineDirective(rest: string): Directive['data'] {
  // Syntax: `line <num> "<file>" <level>
  // Example: `line 100 "orig.sv" 0
  const m = rest.match(/^\s*(\d+)\s+["']([^"']+)["']\s+(\d+)\s*$/);
  if (!m) {
    return { kind: 'line', lineNum: 0, fileName: '', level: 0 };
  }
  return {
    kind: 'line',
    lineNum: Number.parseInt(m[1], 10),
    fileName: m[2],
    level: Number.parseInt(m[3], 10),
  };
}

function computeGuard(stack: Array<{ condition: string; inverted: boolean }>): Guard | undefined {
  if (stack.length === 0) return undefined;
  const parts = stack.map((g) => (g.inverted ? `!${g.condition}` : g.condition));
  return { condition: parts.join(' && '), inverted: false };
}

function splitTopLevelCommas(s: string): string[] {
  // Good enough for import clause lists; avoids splitting inside (...) blocks.
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(s.slice(start));
  return parts;
}

function findMatchingParen(s: string, openIndex: number): number {
  if (s[openIndex] !== '(') return -1;
  let depth = 0;
  for (let i = openIndex; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === '\'') {
      // Skip over quoted segments (best-effort for macro params).
      const end = findStringEnd(s, i);
      if (end >= i) i = end;
    }
  }
  return -1;
}

function findStringEnd(s: string, start: number): number {
  const quote = s[start];
  for (let i = start + 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\\\') {
      i++; // skip escaped char
      continue;
    }
    if (ch === quote) return i;
  }
  return s.length - 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isStartOfLineOnlyWhitespace(
  content: string,
  lineOffsets: LineOffsets,
  lineNo: number,
  absoluteOffset: number
): boolean {
  const lineStart = lineOffsets[lineNo - 1] ?? 0;
  const prefix = content.slice(lineStart, absoluteOffset);
  return /^\s*$/.test(prefix);
}

function maskCommentsAndStrings(content: string): string {
  // Replace content inside comments/strings with spaces (preserve newlines and length).
  const out = content.split('');
  let i = 0;
  let state: 'normal' | 'line_comment' | 'block_comment' | 'string' = 'normal';
  let stringQuote: '"' | null = null;

  while (i < out.length) {
    const ch = out[i];
    const next = i + 1 < out.length ? out[i + 1] : '';

    if (state === 'normal') {
      if (ch === '/' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        state = 'line_comment';
        continue;
      }
      if (ch === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        state = 'block_comment';
        continue;
      }
      if (ch === '"') {
        stringQuote = '"';
        out[i] = ' ';
        i++;
        state = 'string';
        continue;
      }
      i++;
      continue;
    }

    if (state === 'line_comment') {
      if (ch === '\n') {
        state = 'normal';
        i++;
        continue;
      }
      if (ch !== '\r') {
        out[i] = ' ';
      }
      i++;
      continue;
    }

    if (state === 'block_comment') {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        state = 'normal';
        continue;
      }
      if (ch !== '\n' && ch !== '\r') {
        out[i] = ' ';
      }
      i++;
      continue;
    }

    if (state === 'string') {
      if (ch === '\\\\') {
        // escape sequence
        out[i] = ' ';
        if (i + 1 < out.length) out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (stringQuote && ch === stringQuote) {
        out[i] = ' ';
        i++;
        state = 'normal';
        stringQuote = null;
        continue;
      }
      if (ch !== '\n' && ch !== '\r') {
        out[i] = ' ';
      }
      i++;
      continue;
    }
  }

  return out.join('');
}
