/**
 * Instance Scanner Module
 *
 * Scans for instantiation constructs in SystemVerilog code.
 *
 * Instances are COPIES of modules/interfaces/checkers.
 *
 * Instance kinds scanned:
 * - module: Normal module instantiation
 * - interface: Interface instantiation
 * - checker: Checker instantiation
 * - bind: Bind statement (binds checker to target)
 * - generate: Instances inside generate blocks
 *
 * @module scanners/instance-scanner
 */

import type {
  Instance,
  InstanceKind,
  PortConnection,
  LineOffsets,
  Declaration,
} from '../types/index.js';
import { locationId } from '../ids/index.js';
import { getLocation } from '../reader/index.js';
import { INSTANCE_PATTERNS, copyPattern } from './patterns.js';
import { buildScopeLookup, type ScopeLookup, type GuardLookup } from './scope-tracker.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from scanning instances.
 */
export interface InstanceScanResult {
  /** All instances found */
  instances: Instance[];
}

// ============================================================================
// Main Scanner Function
// ============================================================================

/**
 * Scan content for instances.
 *
 * @param content - Preprocessed code (comments stripped)
 * @param filePath - Absolute path to the file
 * @param lineOffsets - Line offset index for location lookup
 * @param declarations - Declarations found in this file (for context)
 * @param scopeLookup - Optional function to look up scope at a line (built from declarations if not provided)
 * @returns All instances found
 *
 * @example
 * ```typescript
 * const { instances } = scanInstances(
 *   content,
 *   '/path/to/file.sv',
 *   lineOffsets,
 *   declarations
 * );
 *
 * for (const inst of instances) {
 *   console.log(`${inst.instanceName} is instance of ${inst.targetName}`);
 * }
 * ```
 */
export function scanInstances(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  declarations: Declaration[],
  scopeLookup?: ScopeLookup,
  guardLookup?: GuardLookup
): InstanceScanResult {
  const instances: Instance[] = [];

  // Build scope lookup from declarations if not provided
  const getScope = scopeLookup || buildScopeLookup(declarations);

  // Default guard lookup returns undefined (no guards)
  const getGuard: GuardLookup = guardLookup || (() => undefined);

  // Build sets for validation
  const moduleNames = new Set(
    declarations
      .filter((d) => d.kind === 'module' || d.kind === 'interface' || d.kind === 'checker')
      .map((d) => d.name)
  );

  const functionNames = new Set(
    declarations.filter((d) => d.kind === 'function' || d.kind === 'task').map((d) => d.name)
  );

  // Scan different instance types (pass scope and guard lookup)
  scanBindStatements(content, filePath, lineOffsets, instances, getScope, getGuard);
  scanArrayInstances(content, filePath, lineOffsets, moduleNames, functionNames, instances, getScope, getGuard);
  scanRegularInstances(content, filePath, lineOffsets, moduleNames, functionNames, instances, getScope, getGuard);

  // Sort instances by location
  instances.sort((a, b) => {
    if (a.location.line !== b.location.line) {
      return a.location.line - b.location.line;
    }
    return a.location.col - b.location.col;
  });

  // Remove duplicates (array instances also match regular pattern)
  const seen = new Set<string>();
  const uniqueInstances: Instance[] = [];

  for (const inst of instances) {
    const key = `${inst.location.line}:${inst.location.col}:${inst.instanceName}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueInstances.push(inst);
    }
  }

  return { instances: uniqueInstances };
}

// ============================================================================
// Individual Scanners
// ============================================================================

/**
 * Scan for bind statements.
 *
 * Bind syntax: bind target_module checker_module instance_name (...);
 */
function scanBindStatements(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  instances: Instance[],
  getScope: ScopeLookup,
  getGuard: GuardLookup
): void {
  const pattern = copyPattern(INSTANCE_PATTERNS.bind);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const loc = getLocation(lineOffsets, match.index);
    const guard = getGuard(loc.line);

    const bindTarget = match[1]; // Target module being bound to
    const checkerModule = match[2]; // Checker module being instantiated
    const instanceName = match[3]; // Instance name

    // Extract port connections
    const connections = extractPortConnections(content, match.index + match[0].length);

    instances.push({
      id: locationId(filePath, loc.line, loc.col),
      instanceKind: 'bind',
      instanceName,
      targetName: checkerModule,
      bindTarget,
      location: { file: filePath, line: loc.line, col: loc.col },
      parentScope: getScope(loc.line),
      connections,
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }
}

/**
 * Scan for array instances.
 *
 * Array syntax: module_name [#(params)] instance_name[range] (...);
 */
function scanArrayInstances(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  moduleNames: Set<string>,
  functionNames: Set<string>,
  instances: Instance[],
  getScope: ScopeLookup,
  getGuard: GuardLookup
): void {
  // Track matched positions to avoid duplicates
  const matched = new Set<number>();

  // First, scan for array instances WITH parameters using bracket counting
  const patternWithParamsStart = copyPattern(INSTANCE_PATTERNS.instanceWithParamsStart);
  let match;

  while ((match = patternWithParamsStart.exec(content)) !== null) {
    const moduleName = match[1];

    if (functionNames.has(moduleName) || isKeywordNotModule(moduleName)) {
      continue;
    }

    // Use bracket counting to skip over the parameter section
    const paramStartIdx = match.index + match[0].length - 1;
    const afterParams = skipBracketedSection(content, paramStartIdx);

    if (afterParams === -1) {
      continue;
    }

    // After the params, look for: whitespace, instance_name, array_range, '('
    const afterParamsContent = content.slice(afterParams);
    const instanceMatch = afterParamsContent.match(/^\s*(\w+)\s*(\[[^\]]+\])\s*\(/);

    if (!instanceMatch) {
      continue; // Not an array instance
    }

    const instanceName = instanceMatch[1];
    const arrayRange = instanceMatch[2];

    matched.add(match.index);
    const loc = getLocation(lineOffsets, match.index);
    const guard = getGuard(loc.line);
    const portStartIdx = afterParams + instanceMatch[0].length - 1;
    const connections = extractPortConnections(content, portStartIdx);
    const paramOverrides = extractParamOverridesFromContent(content, match.index);

    instances.push({
      id: locationId(filePath, loc.line, loc.col),
      instanceKind: 'module',
      instanceName,
      targetName: moduleName,
      arrayRange,
      location: { file: filePath, line: loc.line, col: loc.col },
      parentScope: getScope(loc.line),
      connections,
      paramOverrides,
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }

  // Then, scan for array instances WITHOUT parameters
  const pattern = copyPattern(INSTANCE_PATTERNS.arrayInstance);

  while ((match = pattern.exec(content)) !== null) {
    // Skip if already matched as parameterized instance
    if (matched.has(match.index)) {
      continue;
    }

    const moduleName = match[1];
    const instanceName = match[2];
    const arrayRange = match[3];

    if (functionNames.has(moduleName) || isKeywordNotModule(moduleName)) {
      continue;
    }

    const loc = getLocation(lineOffsets, match.index);
    const guard = getGuard(loc.line);
    const connections = extractPortConnections(content, match.index + match[0].length - 1);

    instances.push({
      id: locationId(filePath, loc.line, loc.col),
      instanceKind: 'module',
      instanceName,
      targetName: moduleName,
      arrayRange,
      location: { file: filePath, line: loc.line, col: loc.col },
      parentScope: getScope(loc.line),
      connections,
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }
}

/**
 * Scan for regular (non-array) instances.
 *
 * Regular syntax: module_name [#(params)] instance_name (...);
 */
function scanRegularInstances(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  moduleNames: Set<string>,
  functionNames: Set<string>,
  instances: Instance[],
  getScope: ScopeLookup,
  getGuard: GuardLookup
): void {
  // Track matched positions to avoid duplicates
  const matched = new Set<number>();

  // First, scan for instances WITH parameters using bracket counting
  const patternWithParamsStart = copyPattern(INSTANCE_PATTERNS.instanceWithParamsStart);
  let match;

  while ((match = patternWithParamsStart.exec(content)) !== null) {
    const moduleName = match[1];

    if (functionNames.has(moduleName) || isKeywordNotModule(moduleName) || isTypeKeyword(moduleName)) {
      continue;
    }

    // Use bracket counting to skip over the parameter section
    const paramStartIdx = match.index + match[0].length - 1; // Position of '('
    const afterParams = skipBracketedSection(content, paramStartIdx);

    if (afterParams === -1) {
      continue; // Unbalanced brackets
    }

    // After the params, look for: whitespace, instance_name, optional array, '('
    const afterParamsContent = content.slice(afterParams);
    const instanceMatch = afterParamsContent.match(/^\s*(\w+)\s*(?:(\[[^\]]+\]))?\s*\(/);

    if (!instanceMatch) {
      continue;
    }

    const instanceName = instanceMatch[1];
    const arrayRange = instanceMatch[2];

    // Skip array instances - they're handled separately
    if (arrayRange) {
      continue;
    }

    matched.add(match.index);
    const loc = getLocation(lineOffsets, match.index);
    const guard = getGuard(loc.line);
    const portStartIdx = afterParams + instanceMatch[0].length - 1;
    const connections = extractPortConnections(content, portStartIdx);
    const paramOverrides = extractParamOverridesFromContent(content, match.index);

    instances.push({
      id: locationId(filePath, loc.line, loc.col),
      instanceKind: 'module',
      instanceName,
      targetName: moduleName,
      location: { file: filePath, line: loc.line, col: loc.col },
      parentScope: getScope(loc.line),
      connections,
      paramOverrides,
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }

  // Then, scan for instances WITHOUT parameters
  const pattern = copyPattern(INSTANCE_PATTERNS.instance);

  while ((match = pattern.exec(content)) !== null) {
    // Skip if already matched as parameterized instance
    if (matched.has(match.index)) {
      continue;
    }

    const moduleName = match[1];
    const instanceName = match[2];

    if (functionNames.has(moduleName) || isKeywordNotModule(moduleName) || isTypeKeyword(moduleName)) {
      continue;
    }

    // Check this isn't actually a parameterized instance we should have caught
    // (look backwards for #)
    const beforeMatch = content.slice(Math.max(0, match.index - 50), match.index);
    if (beforeMatch.match(/\w\s*#\s*\([^)]*$/)) {
      continue; // This is part of a parameterized instance
    }

    const loc = getLocation(lineOffsets, match.index);
    const guard = getGuard(loc.line);
    const connections = extractPortConnections(content, match.index + match[0].length - 1);

    instances.push({
      id: locationId(filePath, loc.line, loc.col),
      instanceKind: 'module',
      instanceName,
      targetName: moduleName,
      location: { file: filePath, line: loc.line, col: loc.col },
      parentScope: getScope(loc.line),
      connections,
      guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
    });
  }
}

/**
 * Skip over a bracketed section using bracket counting.
 * Returns the index after the closing bracket, or -1 if unbalanced.
 *
 * @param content - Content string
 * @param openBracketIdx - Index of the opening bracket '('
 * @returns Index after the closing bracket, or -1
 */
function skipBracketedSection(content: string, openBracketIdx: number): number {
  if (content[openBracketIdx] !== '(') {
    return -1;
  }

  let depth = 1;
  let i = openBracketIdx + 1;

  while (i < content.length && depth > 0) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') depth--;
    i++;
  }

  return depth === 0 ? i : -1;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract port connections from an instance.
 *
 * Looks for patterns like:
 * - .port_name(signal_name)
 * - .port_name() - unconnected
 * - .port_name - implicit connection
 */
function extractPortConnections(content: string, startOffset: number): PortConnection[] {
  const connections: PortConnection[] = [];

  // Find the opening parenthesis
  let i = startOffset;
  while (i < content.length && content[i] !== '(') {
    i++;
  }

  if (i >= content.length) {
    return connections;
  }

  // Find matching closing parenthesis
  let depth = 1;
  let start = i + 1;
  let end = start;

  while (end < content.length && depth > 0) {
    if (content[end] === '(') depth++;
    else if (content[end] === ')') depth--;
    end++;
  }

  if (depth !== 0) {
    return connections;
  }

  const portList = content.slice(start, end - 1);

  // Scan for named port connections
  const namedPattern = /\.(\w+)\s*\(\s*([^)]*)\s*\)/g;
  let match;

  while ((match = namedPattern.exec(portList)) !== null) {
    const portName = match[1];
    const signalName = match[2].trim() || portName; // Empty means unconnected, use port name

    connections.push({
      portName,
      signalName,
      location: { file: '', line: 0, col: 0 }, // Would need proper location tracking
    });
  }

  // Scan for implicit connections (.port_name without parentheses)
  const implicitPattern = /\.(\w+)(?=\s*[,)])/g;

  while ((match = implicitPattern.exec(portList)) !== null) {
    const portName = match[1];

    // Check if this was already matched as named connection
    if (!connections.some((c) => c.portName === portName)) {
      connections.push({
        portName,
        signalName: portName, // Implicit = same name
        location: { file: '', line: 0, col: 0 },
      });
    }
  }

  return connections;
}

/**
 * Extract parameter overrides from content starting at a match position.
 * Uses bracket counting to handle nested parentheses like #(.WIDTH(8), .DEPTH(16)).
 *
 * @param content - Full content string
 * @param matchStart - Position where the instance match starts
 * @returns Parameter overrides map, or undefined if none found
 */
function extractParamOverridesFromContent(
  content: string,
  matchStart: number
): Record<string, string> | undefined {
  // Find the # after the module name
  let i = matchStart;
  while (i < content.length && content[i] !== '#' && content[i] !== '(') {
    i++;
  }

  if (i >= content.length || content[i] !== '#') {
    return undefined;
  }

  // Skip # and whitespace
  i++;
  while (i < content.length && /\s/.test(content[i])) {
    i++;
  }

  if (i >= content.length || content[i] !== '(') {
    return undefined;
  }

  // Use bracket counting to find matching close paren
  const paramStart = i + 1;
  let depth = 1;
  let paramEnd = paramStart;

  while (paramEnd < content.length && depth > 0) {
    if (content[paramEnd] === '(') depth++;
    else if (content[paramEnd] === ')') depth--;
    if (depth > 0) paramEnd++;
  }

  if (depth !== 0) {
    return undefined;
  }

  const paramList = content.slice(paramStart, paramEnd);
  return parseParamList(paramList);
}

/**
 * Parse a parameter list string into overrides map.
 * Handles nested parentheses in values like .WIDTH(8), .DEPTH(calc(4*4)).
 */
function parseParamList(paramList: string): Record<string, string> | undefined {
  const overrides: Record<string, string> = {};

  // Split by top-level commas (respecting nested parens)
  const params = splitByTopLevelComma(paramList);

  for (const param of params) {
    const trimmed = param.trim();
    if (!trimmed) continue;

    // Named parameter: .NAME(value)
    const namedMatch = trimmed.match(/^\.(\w+)\s*\(/);
    if (namedMatch) {
      const name = namedMatch[1];
      // Extract value with bracket counting
      const valueStart = namedMatch[0].length;
      let depth = 1;
      let valueEnd = valueStart;
      while (valueEnd < trimmed.length && depth > 0) {
        if (trimmed[valueEnd] === '(') depth++;
        else if (trimmed[valueEnd] === ')') depth--;
        if (depth > 0) valueEnd++;
      }
      const value = trimmed.slice(valueStart, valueEnd).trim();
      overrides[name] = value;
    }
    // Positional parameters are harder to map without module definition
  }

  if (Object.keys(overrides).length === 0) {
    return undefined;
  }

  return overrides;
}

/**
 * Split a string by commas, but only at the top level (not inside parentheses).
 */
function splitByTopLevelComma(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === ',' && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }

  // Don't forget the last part
  if (start < str.length) {
    parts.push(str.slice(start));
  }

  return parts;
}

/**
 * Check if a name is a keyword that looks like it could be a module but isn't.
 */
function isKeywordNotModule(name: string): boolean {
  const keywords = new Set([
    // Control flow that might precede parentheses
    'if',
    'else',
    'for',
    'foreach',
    'while',
    'do',
    'repeat',
    'case',
    'casex',
    'casez',
    'fork',
    'join',
    'join_any',
    'join_none',
    // Function-like keywords
    'assert',
    'assume',
    'cover',
    'restrict',
    'expect',
    // Other keywords
    'return',
    'new',
    'wait',
    'wait_order',
    'disable',
    'randcase',
    'randsequence',
    // Built-in tasks
    'display',
    'write',
    'monitor',
    'strobe',
    'finish',
    'stop',
    'fatal',
    'error',
    'warning',
    'info',
  ]);

  // Also check for $ prefix (system tasks)
  if (name.startsWith('$')) {
    return true;
  }

  return keywords.has(name);
}

/**
 * Check if a name is a type keyword (not a module).
 */
function isTypeKeyword(name: string): boolean {
  const types = new Set([
    'bit',
    'logic',
    'reg',
    'wire',
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
    'void',
    'time',
    'signed',
    'unsigned',
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
  ]);

  return types.has(name);
}

/**
 * Determine the instance kind based on target name and context.
 */
function determineInstanceKind(
  targetName: string,
  moduleNames: Set<string>,
  interfaceNames: Set<string>,
  checkerNames: Set<string>
): InstanceKind {
  if (checkerNames.has(targetName)) {
    return 'checker';
  }
  if (interfaceNames.has(targetName)) {
    return 'interface';
  }
  // Default to module
  return 'module';
}
