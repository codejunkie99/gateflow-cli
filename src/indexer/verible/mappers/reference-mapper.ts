/**
 * Reference Mapper
 *
 * Handles package import and other reference mapping:
 * - Package imports
 * - Macro usage
 * - Assert/assume/cover property references
 * - Scoped identifiers (pkg::member)
 *
 * @module verible/mappers/reference-mapper
 */

import type { VeribleNode } from '../types.js';
import { isNode, isToken, NODE_TAGS, TOKEN_TAGS } from '../types.js';
import type { MapperContext } from './types.js';
import { getNodeLocation } from './location-utils.js';
import { findAllIdentifiers, findIdentifier, nodeToText } from './ast-utils.js';
import { locationId } from '../../ids/index.js';

/**
 * Visit a package import declaration.
 */
export function visitPackageImport(
  node: VeribleNode,
  context: MapperContext
): void {
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

/**
 * Visit a macro call/usage.
 *
 * Handles patterns like:
 * - `MAX_WIDTH
 * - `RESET_VALUE
 * - `uvm_info(...)
 */
export function visitMacroCall(
  node: VeribleNode,
  context: MapperContext
): void {
  // Find the macro identifier
  let macroName = '';
  for (const child of node.children) {
    if (isToken(child)) {
      if (child.tag === TOKEN_TAGS.MACRO_IDENTIFIER || child.tag === 'MacroIdentifier') {
        macroName = child.text.replace(/^`/, '');
        break;
      }
      // Also check for backtick-prefixed tokens
      if (child.text.startsWith('`') && child.text.length > 1) {
        macroName = child.text.substring(1);
        break;
      }
    }
  }

  if (!macroName) return;

  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  context.references.push({
    id,
    kind: 'macro_usage',
    targetName: macroName,
    location,
    scope: [...context.scope],
    guard: context.guard,
  });
}

/**
 * Visit an assert statement.
 *
 * Handles patterns like:
 * - assert property (req |-> gnt);
 * - assert (condition);
 */
export function visitAssertStatement(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  // Try to find the property/sequence being asserted
  const propertyName = findIdentifier(node);

  context.references.push({
    id,
    kind: 'assert_usage',
    targetName: propertyName || 'anonymous',
    location,
    scope: [...context.scope],
    guard: context.guard,
  });
}

/**
 * Visit an assume statement.
 *
 * Handles patterns like:
 * - assume property (clk_valid);
 */
export function visitAssumeStatement(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  const propertyName = findIdentifier(node);

  context.references.push({
    id,
    kind: 'assume_usage',
    targetName: propertyName || 'anonymous',
    location,
    scope: [...context.scope],
    guard: context.guard,
  });
}

/**
 * Visit a cover statement.
 *
 * Handles patterns like:
 * - cover property (state_transition);
 */
export function visitCoverStatement(
  node: VeribleNode,
  context: MapperContext
): void {
  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  const propertyName = findIdentifier(node);

  context.references.push({
    id,
    kind: 'cover_usage',
    targetName: propertyName || 'anonymous',
    location,
    scope: [...context.scope],
    guard: context.guard,
  });
}

/**
 * Visit a qualified/scoped identifier.
 *
 * Handles patterns like:
 * - my_pkg::TYPE_A
 * - BaseClass::method
 * - $unit::global_var
 */
export function visitQualifiedId(
  node: VeribleNode,
  context: MapperContext
): void {
  const identifiers = findAllIdentifiers(node);
  if (identifiers.length < 2) return;

  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  // First identifier is the scope, second is the member
  const scopeName = identifiers[0];
  const memberName = identifiers[1];

  context.references.push({
    id,
    kind: 'type_usage',
    targetName: `${scopeName}::${memberName}`,
    location,
    scope: [...context.scope],
    guard: context.guard,
  });
}
