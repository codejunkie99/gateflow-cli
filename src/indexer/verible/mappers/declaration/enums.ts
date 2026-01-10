/**
 * Enum Mappers
 *
 * Handlers for enum type and enum value declarations:
 * - enum: Named enum type declarations
 * - enum_value: Individual enum members
 *
 * @module verible/mappers/declaration/enums
 */

import type { VeribleNode } from '../../types.js';
import { isNode, isToken, NODE_TAGS, TOKEN_TAGS } from '../../types.js';
import type { Declaration, EnumData, EnumValueData } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import { findIdentifier, findChildByTag, nodeToText } from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';

/**
 * Extract enum base type from an enum type node.
 */
function extractEnumBaseType(node: VeribleNode): string | undefined {
  // Look for a data type specification before the enum values
  const dataType = findChildByTag(node, NODE_TAGS.DATA_TYPE);
  if (dataType) {
    return nodeToText(dataType);
  }

  // Check for primitive type directly in enum
  const primitive = findChildByTag(node, NODE_TAGS.DATA_TYPE_PRIMITIVE);
  if (primitive) {
    return nodeToText(primitive);
  }

  return undefined;
}

/**
 * Extract enum values from an enum type node.
 * Returns array of { name, value?, location }
 */
function extractEnumValues(
  node: VeribleNode,
  context: MapperContext
): Array<{ name: string; value?: string; location: { line: number; col: number } }> {
  const values: Array<{ name: string; value?: string; location: { line: number; col: number } }> = [];

  // Recursively find all enum name nodes
  function findEnumNames(n: VeribleNode): void {
    for (const child of n.children) {
      if (isNode(child)) {
        // kEnumName contains the enum member
        if (child.tag === NODE_TAGS.ENUM_NAME || child.tag === 'kEnumName') {
          const name = findIdentifier(child);
          if (name) {
            const loc = getNodeLocation(child, context);
            // Try to extract explicit value assignment
            let value: string | undefined;
            let foundEquals = false;
            for (const enumChild of child.children) {
              if (isToken(enumChild) && enumChild.text === '=') {
                foundEquals = true;
                continue;
              }
              if (foundEquals && isNode(enumChild)) {
                value = nodeToText(enumChild);
                break;
              }
              if (foundEquals && isToken(enumChild) && enumChild.tag !== ',') {
                value = enumChild.text;
                break;
              }
            }
            values.push({ name, value, location: { line: loc.line, col: loc.col } });
          }
        }
        findEnumNames(child);
      }
    }
  }

  findEnumNames(node);
  return values;
}

/**
 * Visit an enum type within a typedef declaration.
 *
 * This handles patterns like:
 * - typedef enum { RED, GREEN, BLUE } color_t;
 * - typedef enum logic [1:0] { IDLE, RUN, STOP } state_t;
 */
export function visitEnumType(
  enumNode: VeribleNode,
  typedefName: string,
  context: MapperContext
): void {
  const location = getNodeLocation(enumNode, context);
  const id = declarationId(context.filePath, 'enum', typedefName, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const baseType = extractEnumBaseType(enumNode);

  // Create the enum declaration
  const enumDecl: Declaration = {
    id,
    locationId: locId,
    kind: 'enum',
    name: typedefName,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    guard: context.guard,
    data: {
      kind: 'enum',
      baseType,
    } as EnumData,
  };

  context.declarations.push(enumDecl);

  // Extract and create enum value declarations
  const enumValues = extractEnumValues(enumNode, context);
  enumValues.forEach((ev, ordinal) => {
    const valueId = declarationId(context.filePath, 'enum_value', ev.name, context.scope);
    const valueLocId = locationId(context.filePath, ev.location.line, ev.location.col);

    const valueDecl: Declaration = {
      id: valueId,
      locationId: valueLocId,
      kind: 'enum_value',
      name: ev.name,
      location: {
        file: context.filePath,
        line: ev.location.line,
        col: ev.location.col,
      },
      scope: [...context.scope],
      parentId: id, // Parent is the enum
      guard: context.guard,
      data: {
        kind: 'enum_value',
        value: ev.value,
        ordinal,
      } as EnumValueData,
    };

    context.declarations.push(valueDecl);
  });
}

/**
 * Check if a typedef declaration contains an enum type and extract it.
 *
 * Returns true if an enum was found and processed.
 */
export function processEnumTypedef(
  node: VeribleNode,
  context: MapperContext
): boolean {
  // Find the typedef name
  const name = findIdentifier(node);
  if (!name) return false;

  // Look for an enum type within the typedef
  let enumNode: VeribleNode | undefined;

  function findEnumType(n: VeribleNode): void {
    for (const child of n.children) {
      if (isNode(child)) {
        if (child.tag === NODE_TAGS.ENUM_TYPE || child.tag === 'kEnumType') {
          enumNode = child;
          return;
        }
        findEnumType(child);
      }
    }
  }

  findEnumType(node);

  if (enumNode) {
    visitEnumType(enumNode, name, context);
    return true;
  }

  return false;
}
