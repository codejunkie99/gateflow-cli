/**
 * Variable/Signal Mappers
 *
 * Handlers for variable and signal declarations:
 * - signal: Wire, reg, logic declarations
 * - net declarations
 * - data declarations
 *
 * @module verible/mappers/declaration/variables
 */

import type { VeribleNode } from '../../types.js';
import { isNode, isToken, NODE_TAGS, TOKEN_TAGS } from '../../types.js';
import type { Declaration, SignalData } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import { findIdentifier, findAllIdentifiers, extractDataType, nodeToText } from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';

/**
 * Extract signal type (wire, reg, logic, etc.) from a node.
 */
function extractSignalType(node: VeribleNode): string {
  for (const child of node.children) {
    if (isToken(child)) {
      const text = child.text;
      if (['wire', 'reg', 'logic', 'bit', 'integer', 'real', 'time', 'realtime'].includes(text)) {
        return text;
      }
    }
    if (isNode(child)) {
      const result = extractSignalType(child);
      if (result !== 'logic') return result;
    }
  }
  return 'logic';
}

/**
 * Extract width specification from a node.
 */
function extractWidth(node: VeribleNode): string | undefined {
  for (const child of node.children) {
    if (isNode(child)) {
      if (child.tag === 'kPackedDimensions' || child.tag === 'kDimensionRange') {
        return nodeToText(child);
      }
      if (child.tag === NODE_TAGS.DATA_TYPE || child.tag === 'kDataType') {
        for (const typeChild of child.children) {
          if (isNode(typeChild) && (typeChild.tag === 'kPackedDimensions' || typeChild.tag === 'kDimensionRange')) {
            return nodeToText(typeChild);
          }
        }
      }
      const width = extractWidth(child);
      if (width) return width;
    }
  }
  return undefined;
}

/**
 * Visit a net declaration (wire, tri, etc.).
 */
export function visitNetDeclaration(node: VeribleNode, context: MapperContext): void {
  const signalType = extractSignalType(node);
  const width = extractWidth(node);
  const identifiers = findAllIdentifiers(node);

  // First identifier might be the type, subsequent ones are signal names
  // For "wire [7:0] data, addr;" we want data and addr
  const names = identifiers.filter(id => !['wire', 'reg', 'logic', 'bit', 'tri', 'tri0', 'tri1', 'wand', 'wor', 'supply0', 'supply1'].includes(id));

  for (const name of names) {
    const location = getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'signal', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const signalDecl: Declaration = {
      id,
      locationId: locId,
      kind: 'signal',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'signal',
        signalType,
        width,
      } as SignalData,
    };

    context.declarations.push(signalDecl);
  }
}

/**
 * Visit a data declaration (logic, reg variables).
 */
export function visitDataDeclaration(node: VeribleNode, context: MapperContext): void {
  const signalType = extractSignalType(node);
  const width = extractWidth(node);

  // Find variable names in the declaration
  const identifiers = findAllIdentifiers(node);
  const typeKeywords = ['logic', 'reg', 'bit', 'byte', 'shortint', 'int', 'longint', 'integer', 'real', 'shortreal', 'realtime', 'time', 'string'];
  const names = identifiers.filter(id => !typeKeywords.includes(id));

  for (const name of names) {
    const location = getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'signal', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const signalDecl: Declaration = {
      id,
      locationId: locId,
      kind: 'signal',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'signal',
        signalType,
        width,
      } as SignalData,
    };

    context.declarations.push(signalDecl);
  }
}

/**
 * Visit a variable declaration.
 */
export function visitVariableDeclaration(node: VeribleNode, context: MapperContext): void {
  visitDataDeclaration(node, context);
}

/**
 * Visit a reg declaration.
 */
export function visitRegDeclaration(node: VeribleNode, context: MapperContext): void {
  visitDataDeclaration(node, context);
}
