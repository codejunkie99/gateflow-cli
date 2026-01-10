/**
 * Reference Mapper
 *
 * Handles package import and other reference mapping.
 *
 * @module verible/mappers/reference-mapper
 */

import type { VeribleNode } from '../types.js';
import type { MapperContext } from './types.js';
import { getNodeLocation } from './location-utils.js';
import { findAllIdentifiers } from './ast-utils.js';
import { locationId } from '../../ids/index.js';

/**
 * Visit a package import declaration.
 */
export function visitPackageImport(
  node: VeribleNode,
  context: MapperContext
): void {
  // Find package::member pattern
  const identifiers = findAllIdentifiers(node);
  if (identifiers.length === 0) return;

  const packageName = identifiers[0];
  const memberName = identifiers.length > 1 ? identifiers[1] : '*';

  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  context.references.push({
    id,
    kind: 'import',
    targetName: packageName,
    location,
    scope: [...context.scope],
    data: {
      kind: 'import',
      memberName,
    },
  });
}
