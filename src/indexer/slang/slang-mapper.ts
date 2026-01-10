/**
 * Slang AST Mapper
 *
 * Maps slang's JSON AST output to our indexer types (Declaration, Reference, Instance).
 * This is the bridge between slang's semantic analysis and our existing type system.
 *
 * Key responsibilities:
 * - Traverse slang's AST structure
 * - Convert SlangSymbol types to Declaration types
 * - Convert SlangInstanceSymbol to Instance types with resolved IDs
 * - Extract references from type usages and connections
 * - Generate proper IDs using locationId() and declarationId()
 * - Handle scope chains and parent relationships
 *
 * @module slang/slang-mapper
 */

import type {
  SlangCompilation,
  SlangSymbol,
  SlangModuleSymbol,
  SlangPackageSymbol,
  SlangInterfaceSymbol,
  SlangClassSymbol,
  SlangInstanceSymbol,
  SlangPortSymbol,
  SlangParameterSymbol,
  SlangVariableSymbol,
  SlangNetSymbol,
  SlangFunctionSymbol,
  SlangTaskSymbol,
  SlangTypeAliasSymbol,
  SlangEnumSymbol,
  SlangStructSymbol,
  SlangLocation,
} from './slang-types.js';
import {
  isModuleDefinition,
  isInterfaceDefinition,
  isInstance,
  isPackage,
  isClass,
  isFunction,
  isTask,
  isPort,
  isParameter,
  isVariable,
  isNet,
  isTypeAlias,
  isEnum,
  isStructOrUnion,
} from './slang-types.js';
import type {
  Declaration,
  DeclarationKind,
  DeclarationData,
  ParamInfo,
  ArgInfo,
  FieldInfo,
} from '../types/declaration.js';
import type { Reference, ReferenceKind } from '../types/reference.js';
import type { Instance, InstanceKind, PortConnection } from '../types/instance.js';
import type { Location } from '../types/location.js';
import { locationId, declarationId } from '../ids/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from mapping slang AST.
 */
export interface SlangMappingResult {
  /** Declarations extracted from slang AST */
  declarations: Declaration[];

  /** References extracted from slang AST */
  references: Reference[];

  /** Instances extracted from slang AST (with resolved IDs) */
  instances: Instance[];

  /** Mapping stats */
  stats: {
    /** Total symbols processed */
    symbolsProcessed: number;

    /** Symbols that couldn't be mapped */
    unmappedSymbols: number;

    /** Time taken in milliseconds */
    mappingTimeMs: number;
  };
}

/**
 * Context passed during AST traversal.
 */
interface MappingContext {
  /** Current scope chain */
  scope: string[];

  /** Parent declaration ID (if any) */
  parentId?: string;

  /** Declaration ID lookup by name (for resolving references) */
  declLookup: Map<string, string>;
}

// ============================================================================
// Main Mapper Function
// ============================================================================

/**
 * Map slang compilation output to our indexer types.
 *
 * @param compilation - Slang's AST JSON output
 * @returns Mapped declarations, references, and instances
 *
 * @example
 * ```typescript
 * const result = await runSlangForRecipe(recipe);
 * if (result.success && result.compilation) {
 *   const mapped = mapSlangAst(result.compilation);
 *   console.log(`Found ${mapped.declarations.length} declarations`);
 * }
 * ```
 */
export function mapSlangAst(compilation: SlangCompilation): SlangMappingResult {
  const startTime = performance.now();

  const declarations: Declaration[] = [];
  const references: Reference[] = [];
  const instances: Instance[] = [];

  let symbolsProcessed = 0;
  let unmappedSymbols = 0;

  // Create initial context
  const context: MappingContext = {
    scope: [],
    parentId: undefined,
    declLookup: new Map(),
  };

  // Process design root
  const design = compilation.design;
  if (design && design.members) {
    for (const member of design.members) {
      const result = processSymbol(member, context);
      symbolsProcessed += result.processed;
      unmappedSymbols += result.unmapped;

      declarations.push(...result.declarations);
      references.push(...result.references);
      instances.push(...result.instances);

      // Update lookup for resolution
      for (const decl of result.declarations) {
        context.declLookup.set(buildLookupKey(decl.name, decl.scope), decl.id);
      }
    }
  }

  const mappingTimeMs = performance.now() - startTime;

  return {
    declarations,
    references,
    instances,
    stats: {
      symbolsProcessed,
      unmappedSymbols,
      mappingTimeMs,
    },
  };
}

// ============================================================================
// Symbol Processing
// ============================================================================

interface ProcessResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  processed: number;
  unmapped: number;
}

/**
 * Process a single slang symbol and its children.
 */
function processSymbol(symbol: SlangSymbol, context: MappingContext): ProcessResult {
  const result: ProcessResult = {
    declarations: [],
    references: [],
    instances: [],
    processed: 1,
    unmapped: 0,
  };

  // Map symbol to appropriate type
  if (isModuleDefinition(symbol)) {
    const decl = mapModuleDefinition(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      // Process children with updated context
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isInterfaceDefinition(symbol)) {
    const decl = mapInterfaceDefinition(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isPackage(symbol)) {
    const decl = mapPackage(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isClass(symbol)) {
    const decl = mapClass(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      // Add extends reference if present
      if (symbol.baseClass) {
        const ref = createExtendsReference(symbol, context);
        if (ref) {
          result.references.push(ref);
        }
      }
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isInstance(symbol)) {
    const inst = mapInstance(symbol, context);
    if (inst) {
      result.instances.push(inst);
      // Process instance body if present
      if (symbol.body?.members) {
        const childContext = createChildContext(context, inst.instanceName, undefined);
        processChildren(symbol.body.members, childContext, result);
      }
    }
  } else if (isPort(symbol)) {
    const decl = mapPort(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isParameter(symbol)) {
    const decl = mapParameter(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isVariable(symbol)) {
    const decl = mapVariable(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isNet(symbol)) {
    const decl = mapNet(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isFunction(symbol)) {
    const decl = mapFunction(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isTask(symbol)) {
    const decl = mapTask(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isTypeAlias(symbol)) {
    const decl = mapTypeAlias(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isEnum(symbol)) {
    const decl = mapEnum(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      // Map enum values
      if (symbol.values) {
        for (let i = 0; i < symbol.values.length; i++) {
          const enumValue = symbol.values[i];
          const valueDecl = mapEnumValue(enumValue, i, symbol, context);
          if (valueDecl) {
            result.declarations.push(valueDecl);
          }
        }
      }
    }
  } else if (isStructOrUnion(symbol)) {
    const decl = mapStructOrUnion(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else {
    // Generic/unmapped symbol - try to extract children
    result.unmapped = 1;
    if (symbol.members) {
      processChildren(symbol.members, context, result);
    }
  }

  return result;
}

/**
 * Process child symbols.
 */
function processChildren(
  members: SlangSymbol[],
  context: MappingContext,
  result: ProcessResult
): void {
  for (const member of members) {
    const childResult = processSymbol(member, context);
    result.declarations.push(...childResult.declarations);
    result.references.push(...childResult.references);
    result.instances.push(...childResult.instances);
    result.processed += childResult.processed;
    result.unmapped += childResult.unmapped;
  }
}

/**
 * Create child context with updated scope.
 */
function createChildContext(
  parent: MappingContext,
  scopeName: string,
  parentId?: string
): MappingContext {
  return {
    scope: [...parent.scope, scopeName],
    parentId,
    declLookup: parent.declLookup,
  };
}

// ============================================================================
// Symbol Mappers
// ============================================================================

/**
 * Map slang module definition to Declaration.
 */
function mapModuleDefinition(
  symbol: SlangModuleSymbol,
  context: MappingContext
): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  const params: ParamInfo[] = (symbol.parameters || []).map((p) => ({
    name: p.name,
    type: p.type,
    default: p.defaultValue,
  }));

  return {
    id: declarationId(loc.file, 'module', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'module',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'module',
      params,
    },
  };
}

/**
 * Map slang interface definition to Declaration.
 */
function mapInterfaceDefinition(
  symbol: SlangInterfaceSymbol,
  context: MappingContext
): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  const params: ParamInfo[] = (symbol.parameters || []).map((p) => ({
    name: p.name,
    type: p.type,
    default: p.defaultValue,
  }));

  return {
    id: declarationId(loc.file, 'interface', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'interface',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'interface',
      params,
    },
  };
}

/**
 * Map slang package to Declaration.
 */
function mapPackage(symbol: SlangPackageSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  return {
    id: declarationId(loc.file, 'package', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'package',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'package',
    },
  };
}

/**
 * Map slang class to Declaration.
 */
function mapClass(symbol: SlangClassSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  return {
    id: declarationId(loc.file, 'class', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'class',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'class',
      extendsName: symbol.baseClass,
      isVirtual: symbol.isVirtual || symbol.isAbstract || false,
    },
  };
}

/**
 * Map slang port to Declaration.
 */
function mapPort(symbol: SlangPortSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  const directionMap: Record<string, 'input' | 'output' | 'inout' | 'ref'> = {
    In: 'input',
    Out: 'output',
    InOut: 'inout',
    Ref: 'ref',
  };

  return {
    id: declarationId(loc.file, 'port', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'port',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'port',
      direction: directionMap[symbol.direction] || 'input',
      portType: symbol.type,
      width: extractWidth(symbol.type),
    },
  };
}

/**
 * Map slang parameter to Declaration.
 */
function mapParameter(symbol: SlangParameterSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  const kind: 'parameter' | 'localparam' = symbol.isLocal ? 'localparam' : 'parameter';

  if (kind === 'localparam') {
    return {
      id: declarationId(loc.file, kind, symbol.name, context.scope),
      locationId: locationId(loc.file, loc.line, loc.col),
      kind,
      name: symbol.name,
      location: loc,
      scope: [...context.scope],
      parentId: context.parentId,
      data: {
        kind: 'localparam',
        paramType: symbol.type,
        value: symbol.defaultValue || '',
      },
    };
  }

  return {
    id: declarationId(loc.file, kind, symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind,
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'parameter',
      paramType: symbol.type,
      defaultValue: symbol.defaultValue,
    },
  };
}

/**
 * Map slang variable to Declaration (as signal).
 */
function mapVariable(symbol: SlangVariableSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  return {
    id: declarationId(loc.file, 'signal', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'signal',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'signal',
      signalType: symbol.type,
      width: extractWidth(symbol.type),
    },
  };
}

/**
 * Map slang net to Declaration (as signal).
 */
function mapNet(symbol: SlangNetSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  return {
    id: declarationId(loc.file, 'signal', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'signal',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'signal',
      signalType: symbol.netType,
      width: extractWidth(symbol.type),
    },
  };
}

/**
 * Map slang function to Declaration.
 */
function mapFunction(symbol: SlangFunctionSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  const args: ArgInfo[] = (symbol.arguments || []).map((arg) => ({
    name: arg.name,
    direction: arg.direction?.toLowerCase() ?? 'in',
    type: arg.type,
  }));

  return {
    id: declarationId(loc.file, 'function', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'function',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'function',
      returnType: symbol.returnType,
      args,
    },
  };
}

/**
 * Map slang task to Declaration.
 */
function mapTask(symbol: SlangTaskSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  const args: ArgInfo[] = (symbol.arguments || []).map((arg) => ({
    name: arg.name,
    direction: arg.direction?.toLowerCase() ?? 'in',
    type: arg.type,
  }));

  return {
    id: declarationId(loc.file, 'task', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'task',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'task',
      args,
    },
  };
}

/**
 * Map slang type alias (typedef) to Declaration.
 */
function mapTypeAlias(symbol: SlangTypeAliasSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  return {
    id: declarationId(loc.file, 'typedef', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'typedef',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'typedef',
      underlyingType: symbol.target,
    },
  };
}

/**
 * Map slang enum to Declaration.
 */
function mapEnum(symbol: SlangEnumSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  return {
    id: declarationId(loc.file, 'enum', symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'enum',
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'enum',
      baseType: symbol.baseType,
    },
  };
}

/**
 * Map enum value to Declaration.
 */
function mapEnumValue(
  value: { name: string; value: string },
  ordinal: number,
  parentEnum: SlangEnumSymbol,
  context: MappingContext
): Declaration | null {
  const loc = mapLocation(parentEnum.location);
  if (!loc) return null;

  // Enum values are in the scope of the enum
  const enumScope = [...context.scope, parentEnum.name];

  return {
    id: declarationId(loc.file, 'enum_value', value.name, enumScope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind: 'enum_value',
    name: value.name,
    location: loc, // Same location as enum (slang doesn't give per-value locations)
    scope: enumScope,
    parentId: declarationId(loc.file, 'enum', parentEnum.name, context.scope),
    data: {
      kind: 'enum_value',
      value: value.value,
      ordinal,
    },
  };
}

/**
 * Map slang struct/union to Declaration.
 */
function mapStructOrUnion(symbol: SlangStructSymbol, context: MappingContext): Declaration | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  const kind: 'struct' | 'union' = symbol.kind === 'UnionType' ? 'union' : 'struct';
  const fields: FieldInfo[] = (symbol.fields || []).map((f) => ({
    name: f.name,
    type: f.type,
  }));

  return {
    id: declarationId(loc.file, kind, symbol.name, context.scope),
    locationId: locationId(loc.file, loc.line, loc.col),
    kind,
    name: symbol.name,
    location: loc,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind,
      fields,
    },
  };
}

/**
 * Map slang instance to Instance.
 */
function mapInstance(symbol: SlangInstanceSymbol, context: MappingContext): Instance | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  // Convert parameter values to overrides
  const paramOverrides: Record<string, string> = {};
  if (symbol.parameters) {
    for (const param of symbol.parameters) {
      paramOverrides[param.name] = param.value;
    }
  }

  // Convert connections
  const connections: PortConnection[] = [];
  if (symbol.connections) {
    for (const conn of symbol.connections) {
      const connLoc = mapLocation(conn.location);
      connections.push({
        portName: conn.port,
        signalName: conn.expr,
        location: connLoc || loc,
      });
    }
  }

  // Try to resolve the target declaration ID
  const resolvedId = context.declLookup.get(buildLookupKey(symbol.definitionName, []));

  return {
    id: locationId(loc.file, loc.line, loc.col),
    instanceKind: 'module', // slang instances are elaborated modules
    instanceName: symbol.name,
    targetName: symbol.definitionName,
    location: loc,
    parentScope: [...context.scope],
    resolvedId,
    paramOverrides: Object.keys(paramOverrides).length > 0 ? paramOverrides : undefined,
    connections: connections.length > 0 ? connections : undefined,
  };
}

/**
 * Create an extends reference for class inheritance.
 */
function createExtendsReference(
  symbol: SlangClassSymbol,
  context: MappingContext
): Reference | null {
  const loc = mapLocation(symbol.location);
  if (!loc || !symbol.baseClass) return null;

  return {
    id: locationId(loc.file, loc.line, loc.col),
    kind: 'extends',
    targetName: symbol.baseClass,
    location: loc,
    scope: [...context.scope],
    data: { kind: 'extends' },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map slang location to our Location type.
 */
function mapLocation(slangLoc: SlangLocation | undefined): Location | null {
  if (!slangLoc || !slangLoc.file) {
    return null;
  }

  return {
    file: slangLoc.file,
    line: slangLoc.line,
    col: slangLoc.column,
  };
}

/**
 * Build a lookup key for declaration resolution.
 */
function buildLookupKey(name: string, scope: string[]): string {
  if (scope.length === 0) {
    return name;
  }
  return `${scope.join('.')}.${name}`;
}

/**
 * Extract width from type string (e.g., "logic [7:0]" -> "[7:0]").
 */
function extractWidth(typeStr: string): string | undefined {
  const match = typeStr.match(/\[.+\]/);
  return match ? match[0] : undefined;
}

// ============================================================================
// Batch Mapping Utilities
// ============================================================================

/**
 * Resolve references using a declaration lookup map.
 *
 * This is called after initial mapping to fill in resolvedId fields.
 *
 * @param references - References to resolve
 * @param declarations - All available declarations
 * @returns References with resolvedId populated where possible
 */
export function resolveReferences(
  references: Reference[],
  declarations: Declaration[]
): Reference[] {
  // Build lookup by name and various scope levels
  const lookup = new Map<string, string>();

  for (const decl of declarations) {
    // Add with full scope
    lookup.set(buildLookupKey(decl.name, decl.scope), decl.id);

    // Also add without scope for top-level resolution
    if (decl.scope.length === 0) {
      lookup.set(decl.name, decl.id);
    }
  }

  return references.map((ref) => {
    if (ref.resolvedId) {
      return ref; // Already resolved
    }

    // Try to resolve with scope context
    let resolved: string | undefined;

    // Try from innermost scope outward
    for (let i = ref.scope.length; i >= 0; i--) {
      const tryScope = ref.scope.slice(0, i);
      const key = buildLookupKey(ref.targetName, tryScope);
      resolved = lookup.get(key);
      if (resolved) break;
    }

    // Try without scope (top-level)
    if (!resolved) {
      resolved = lookup.get(ref.targetName);
    }

    if (resolved) {
      return { ...ref, resolvedId: resolved };
    }

    return ref;
  });
}

/**
 * Resolve instance targets using a declaration lookup map.
 *
 * @param instances - Instances to resolve
 * @param declarations - All available declarations
 * @returns Instances with resolvedId populated where possible
 */
export function resolveInstances(
  instances: Instance[],
  declarations: Declaration[]
): Instance[] {
  // Build lookup for modules and interfaces
  const lookup = new Map<string, string>();

  for (const decl of declarations) {
    if (decl.kind === 'module' || decl.kind === 'interface') {
      lookup.set(decl.name, decl.id);
    }
  }

  return instances.map((inst) => {
    if (inst.resolvedId) {
      return inst; // Already resolved
    }

    const resolved = lookup.get(inst.targetName);
    if (resolved) {
      return { ...inst, resolvedId: resolved };
    }

    return inst;
  });
}
