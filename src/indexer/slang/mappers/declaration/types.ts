/**
 * Type Declaration Mappers
 *
 * Maps slang type symbols (typedef, enum, struct, union) to declarations.
 *
 * @module slang/mappers/declaration/types
 */

import type {
  SlangTypeAliasSymbol,
  SlangEnumSymbol,
  SlangStructSymbol,
} from '../../slang-types.js';
import type { Declaration, FieldInfo } from '../../../types/declaration.js';
import type { MappingContext } from '../types.js';
import { mapLocation } from '../helpers.js';
import { locationId, declarationId } from '../../../ids/index.js';

// ============================================================================
// Typedef
// ============================================================================

/**
 * Map slang type alias (typedef) to Declaration.
 */
export function mapTypeAlias(symbol: SlangTypeAliasSymbol, context: MappingContext): Declaration | null {
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

// ============================================================================
// Enum
// ============================================================================

/**
 * Map slang enum to Declaration.
 */
export function mapEnum(symbol: SlangEnumSymbol, context: MappingContext): Declaration | null {
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
export function mapEnumValue(
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

// ============================================================================
// Struct & Union
// ============================================================================

/**
 * Map slang struct/union to Declaration.
 */
export function mapStructOrUnion(symbol: SlangStructSymbol, context: MappingContext): Declaration | null {
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
