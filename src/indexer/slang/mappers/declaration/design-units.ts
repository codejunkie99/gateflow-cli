/**
 * Design Unit Declaration Mappers
 *
 * Maps slang design unit symbols (module, interface, package, class) to declarations.
 *
 * @module slang/mappers/declaration/design-units
 */

import type {
  SlangModuleSymbol,
  SlangInterfaceSymbol,
  SlangPackageSymbol,
  SlangClassSymbol,
} from '../../slang-types.js';
import type { Declaration, ParamInfo } from '../../../types/declaration.js';
import type { MappingContext } from '../types.js';
import { mapLocation } from '../helpers.js';
import { locationId, declarationId } from '../../../ids/index.js';

// ============================================================================
// Module & Interface
// ============================================================================

/**
 * Map slang module definition to Declaration.
 */
export function mapModuleDefinition(
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
export function mapInterfaceDefinition(
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

// ============================================================================
// Package
// ============================================================================

/**
 * Map slang package to Declaration.
 */
export function mapPackage(symbol: SlangPackageSymbol, context: MappingContext): Declaration | null {
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

// ============================================================================
// Class
// ============================================================================

/**
 * Map slang class to Declaration.
 */
export function mapClass(symbol: SlangClassSymbol, context: MappingContext): Declaration | null {
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
