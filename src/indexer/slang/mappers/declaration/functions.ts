/**
 * Function Declaration Mappers
 *
 * Maps slang function and task symbols to declarations.
 *
 * @module slang/mappers/declaration/functions
 */

import type {
  SlangFunctionSymbol,
  SlangTaskSymbol,
} from '../../slang-types.js';
import type { Declaration, ArgInfo } from '../../../types/declaration.js';
import type { MappingContext } from '../types.js';
import { mapLocation } from '../helpers.js';
import { locationId, declarationId } from '../../../ids/index.js';

// ============================================================================
// Function
// ============================================================================

/**
 * Map slang function to Declaration.
 */
export function mapFunction(symbol: SlangFunctionSymbol, context: MappingContext): Declaration | null {
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

// ============================================================================
// Task
// ============================================================================

/**
 * Map slang task to Declaration.
 */
export function mapTask(symbol: SlangTaskSymbol, context: MappingContext): Declaration | null {
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
