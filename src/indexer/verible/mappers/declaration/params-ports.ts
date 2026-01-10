/**
 * Parameter and Port Mappers
 *
 * Handlers for parameter, localparam, and port declarations.
 *
 * @module verible/mappers/declaration/params-ports
 */

import type { VeribleNode } from '../../types.js';
import type { Declaration, PortData } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import {
  findIdentifier,
  extractDataType,
  extractDefaultValue,
  extractPortDirection,
} from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';

/**
 * Visit a parameter or localparam declaration.
 */
export function visitParameterDeclaration(
  node: VeribleNode,
  context: MapperContext,
  kind: 'parameter' | 'localparam'
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, kind, name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const paramType = extractDataType(node);
  const defaultValue = extractDefaultValue(node);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind,
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: kind === 'parameter'
      ? { kind: 'parameter', paramType, defaultValue }
      : { kind: 'localparam', paramType, value: defaultValue || '' },
  };

  context.declarations.push(declaration);
}

/**
 * Visit a port declaration.
 */
export function visitPortDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'port', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const direction = extractPortDirection(node);
  const portType = extractDataType(node);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'port',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'port',
      direction,
      portType,
    } as PortData,
  };

  context.declarations.push(declaration);
}
