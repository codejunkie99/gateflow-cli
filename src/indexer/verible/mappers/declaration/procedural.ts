/**
 * Procedural and Interface Construct Mappers
 *
 * Handlers for procedural blocks and interface constructs:
 * always, initial, generate, modport, clocking, sequence, property, covergroup
 *
 * @module verible/mappers/declaration/procedural
 */

import type { VeribleNode } from '../../types.js';
import { isNode, NODE_TAGS } from '../../types.js';
import type { Declaration } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { createChildContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import { findIdentifier, findFirstToken, findLabel } from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';
import type { VisitChildrenFn } from './design-units.js';

/**
 * Visit an always statement.
 */
export function visitAlwaysStatement(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const location = getNodeLocation(node, context);
  const name = `always_${location.line}`;
  const id = declarationId(context.filePath, 'always_block', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  // Determine always type
  let blockType: 'always' | 'always_comb' | 'always_ff' | 'always_latch' = 'always';
  const firstToken = findFirstToken(node);
  if (firstToken) {
    if (firstToken.text === 'always_comb') blockType = 'always_comb';
    else if (firstToken.text === 'always_ff') blockType = 'always_ff';
    else if (firstToken.text === 'always_latch') blockType = 'always_latch';
  }

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'always_block',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'always_block', blockType },
  };

  context.declarations.push(declaration);
  visitChildren(node, context);
}

/**
 * Visit an initial statement.
 */
export function visitInitialStatement(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const location = getNodeLocation(node, context);
  const name = `initial_${location.line}`;
  const id = declarationId(context.filePath, 'initial_block', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'initial_block',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'initial_block' },
  };

  context.declarations.push(declaration);
  visitChildren(node, context);
}

/**
 * Visit a generate block.
 */
export function visitGenerateBlock(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const location = getNodeLocation(node, context);
  const label = findLabel(node) || `generate_${location.line}`;
  const id = declarationId(context.filePath, 'generate_block', label, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'generate_block',
    name: label,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'generate_block', generateType: 'for', label },
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, label, id);
  visitChildren(node, childContext);
}

/**
 * Visit a modport declaration.
 */
export function visitModportDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  // Modport structure: kModportDeclaration -> kModportItemList -> kModportItem -> SymbolIdentifier
  // There can be multiple modport items in a single declaration
  for (const child of node.children) {
    if (isNode(child) && (child.tag === 'kModportItemList' || child.tag === NODE_TAGS.MODPORT_ITEM_LIST)) {
      for (const itemChild of child.children) {
        if (isNode(itemChild) && (itemChild.tag === 'kModportItem' || itemChild.tag === NODE_TAGS.MODPORT_ITEM)) {
          const name = findIdentifier(itemChild);
          if (!name) continue;

          const location = getNodeLocation(itemChild, context);
          const id = declarationId(context.filePath, 'modport', name, context.scope);
          const locId = locationId(context.filePath, location.line, location.col);

          const declaration: Declaration = {
            id,
            locationId: locId,
            kind: 'modport',
            name,
            location,
            scope: [...context.scope],
            parentId: context.parentId,
            data: { kind: 'modport', ports: [] },
          };

          context.declarations.push(declaration);
        }
      }
    }
  }
}

/**
 * Visit a clocking declaration.
 */
export function visitClockingDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'clocking', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'clocking',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'clocking', clockEvent: '', signals: [] },
  };

  context.declarations.push(declaration);
}

/**
 * Visit a sequence declaration.
 */
export function visitSequenceDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'sequence', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'sequence',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'sequence' },
  };

  context.declarations.push(declaration);
}

/**
 * Visit a property declaration.
 */
export function visitPropertyDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'property', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'property',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'property' },
  };

  context.declarations.push(declaration);
}

/**
 * Visit a covergroup declaration.
 */
export function visitCovergroupDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'covergroup', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'covergroup',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'covergroup' },
  };

  context.declarations.push(declaration);
}

/**
 * Visit a constraint declaration.
 *
 * Handles patterns like:
 * - constraint c_valid { data < 100; }
 * - constraint c_range { data inside {[0:255]}; }
 */
export function visitConstraintDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'constraint', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'constraint',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    guard: context.guard,
    data: { kind: 'constraint' },
  };

  context.declarations.push(declaration);
}
