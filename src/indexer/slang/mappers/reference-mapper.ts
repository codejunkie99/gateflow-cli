/**
 * Reference Mapper
 *
 * Maps slang reference symbols (class inheritance, etc.) to references.
 *
 * @module slang/mappers/reference-mapper
 */

import type { SlangClassSymbol } from '../slang-types.js';
import type { Reference } from '../../types/reference.js';
import type { MappingContext } from './types.js';
import { mapLocation } from './helpers.js';
import { locationId } from '../../ids/index.js';

// ============================================================================
// Extends Reference
// ============================================================================

/**
 * Create an extends reference for class inheritance.
 */
export function createExtendsReference(
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
