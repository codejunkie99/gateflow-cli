/**
 * Function and Task Mappers
 *
 * Handlers for function and task declarations.
 *
 * @module verible/mappers/declaration/functions
 */

import type { VeribleNode } from '../../types.js';
import type { Declaration, FunctionData, TaskData } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { createChildContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import { findIdentifier, extractFunctionArgs, extractReturnType } from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';
import type { VisitChildrenFn } from './design-units.js';

/**
 * Visit a function declaration.
 */
export function visitFunctionDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'function', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const returnType = extractReturnType(node);
  const args = extractFunctionArgs(node);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'function',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'function',
      returnType,
      args,
    } as FunctionData,
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}

/**
 * Visit a task declaration.
 */
export function visitTaskDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'task', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const args = extractFunctionArgs(node);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'task',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'task',
      args,
    } as TaskData,
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}
