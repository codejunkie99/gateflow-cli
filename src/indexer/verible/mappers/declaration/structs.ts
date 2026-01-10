/**
 * Struct and Union Mappers
 *
 * Handlers for struct and union type declarations:
 * - struct: Aggregate data type with named fields
 * - union: Overlapping storage type
 *
 * @module verible/mappers/declaration/structs
 */

import type { VeribleNode } from '../../types.js';
import { isNode, isToken, NODE_TAGS } from '../../types.js';
import type { Declaration, StructData, UnionData, FieldInfo } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import { findIdentifier, extractDataType } from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';

/**
 * Extract fields from a struct or union type node.
 */
function extractFields(node: VeribleNode): FieldInfo[] {
  const fields: FieldInfo[] = [];

  function findFields(n: VeribleNode): void {
    for (const child of n.children) {
      if (isNode(child)) {
        if (
          child.tag === 'kStructUnionMember' ||
          child.tag === 'kDataDeclaration' ||
          child.tag === NODE_TAGS.DATA_DECLARATION
        ) {
          const fieldType = extractDataType(child);
          const fieldName = findIdentifier(child);
          if (fieldName) {
            fields.push({ name: fieldName, type: fieldType });
          } else {
            findFields(child);
          }
        } else {
          findFields(child);
        }
      }
    }
  }

  findFields(node);
  return fields;
}

/**
 * Visit a struct type within a typedef declaration.
 */
export function visitStructType(
  structNode: VeribleNode,
  typedefName: string,
  context: MapperContext
): void {
  const location = getNodeLocation(structNode, context);
  const id = declarationId(context.filePath, 'struct', typedefName, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const fields = extractFields(structNode);

  const structDecl: Declaration = {
    id,
    locationId: locId,
    kind: 'struct',
    name: typedefName,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    guard: context.guard,
    data: { kind: 'struct', fields } as StructData,
  };

  context.declarations.push(structDecl);
}

/**
 * Visit a union type within a typedef declaration.
 */
export function visitUnionType(
  unionNode: VeribleNode,
  typedefName: string,
  context: MapperContext
): void {
  const location = getNodeLocation(unionNode, context);
  const id = declarationId(context.filePath, 'union', typedefName, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const fields = extractFields(unionNode);

  const unionDecl: Declaration = {
    id,
    locationId: locId,
    kind: 'union',
    name: typedefName,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    guard: context.guard,
    data: { kind: 'union', fields } as UnionData,
  };

  context.declarations.push(unionDecl);
}

/**
 * Check if a typedef contains a struct type and extract it.
 */
export function processStructTypedef(node: VeribleNode, context: MapperContext): boolean {
  const name = findIdentifier(node);
  if (!name) return false;

  let structNode: VeribleNode | undefined;

  function findStructType(n: VeribleNode): void {
    for (const child of n.children) {
      if (isNode(child)) {
        if (child.tag === NODE_TAGS.STRUCT_TYPE || child.tag === 'kStructType') {
          structNode = child;
          return;
        }
        findStructType(child);
      }
    }
  }

  findStructType(node);

  if (structNode) {
    visitStructType(structNode, name, context);
    return true;
  }
  return false;
}

/**
 * Check if a typedef contains a union type and extract it.
 */
export function processUnionTypedef(node: VeribleNode, context: MapperContext): boolean {
  const name = findIdentifier(node);
  if (!name) return false;

  let unionNode: VeribleNode | undefined;

  function findUnionType(n: VeribleNode): void {
    for (const child of n.children) {
      if (isNode(child)) {
        if (child.tag === NODE_TAGS.UNION_TYPE || child.tag === 'kUnionType') {
          unionNode = child;
          return;
        }
        findUnionType(child);
      }
    }
  }

  findUnionType(node);

  if (unionNode) {
    visitUnionType(unionNode, name, context);
    return true;
  }
  return false;
}
