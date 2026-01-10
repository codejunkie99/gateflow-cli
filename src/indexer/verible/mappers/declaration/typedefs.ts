/**
 * Typedef Mapper
 *
 * Handler for typedef declarations.
 *
 * @module verible/mappers/declaration/typedefs
 */

import type { VeribleNode } from '../../types.js';
import type { Declaration } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import { findIdentifier, extractBaseType } from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';

/**
 * Visit a typedef declaration.
 */
export function visitTypedefDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'typedef', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const baseType = extractBaseType(node);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'typedef',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'typedef',
      underlyingType: baseType,
    },
  };

  context.declarations.push(declaration);
}
