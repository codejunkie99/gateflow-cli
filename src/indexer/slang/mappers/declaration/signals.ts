/**
 * Signal Declaration Mappers
 *
 * Maps slang signal-like symbols (port, parameter, variable, net) to declarations.
 *
 * @module slang/mappers/declaration/signals
 */

import type {
  SlangPortSymbol,
  SlangParameterSymbol,
  SlangVariableSymbol,
  SlangNetSymbol,
} from '../../slang-types.js';
import type { Declaration } from '../../../types/declaration.js';
import type { MappingContext } from '../types.js';
import { mapLocation, extractWidth } from '../helpers.js';
import { locationId, declarationId } from '../../../ids/index.js';

// ============================================================================
// Port
// ============================================================================

/**
 * Map slang port to Declaration.
 */
export function mapPort(symbol: SlangPortSymbol, context: MappingContext): Declaration | null {
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

// ============================================================================
// Parameter
// ============================================================================

/**
 * Map slang parameter to Declaration.
 */
export function mapParameter(symbol: SlangParameterSymbol, context: MappingContext): Declaration | null {
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

// ============================================================================
// Variable & Net
// ============================================================================

/**
 * Map slang variable to Declaration (as signal).
 */
export function mapVariable(symbol: SlangVariableSymbol, context: MappingContext): Declaration | null {
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
export function mapNet(symbol: SlangNetSymbol, context: MappingContext): Declaration | null {
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
