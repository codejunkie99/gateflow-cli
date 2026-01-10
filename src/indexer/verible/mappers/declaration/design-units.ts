/**
 * Design Unit Mappers
 *
 * Handlers for top-level design unit declarations:
 * module, package, interface, class, program, checker, config
 *
 * @module verible/mappers/declaration/design-units
 */

import type { VeribleNode } from '../../types.js';
import { NODE_TAGS } from '../../types.js';
import type { Declaration, ModuleData, PackageData, InterfaceData, ClassData } from '../../../types/declaration.js';
import type { MapperContext } from '../types.js';
import { createChildContext } from '../types.js';
import { getNodeLocation } from '../location-utils.js';
import {
  findIdentifier,
  findChildByTag,
  hasKeyword,
  extractParameters,
} from '../ast-utils.js';
import { declarationId, locationId } from '../../../ids/index.js';

/**
 * Callback type for visiting children with updated context.
 */
export type VisitChildrenFn = (node: VeribleNode, context: MapperContext) => void;

/**
 * Visit a module declaration.
 */
export function visitModuleDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'module', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  // Extract parameters from module header
  const params = extractParameters(node);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'module',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'module',
      params,
    } as ModuleData,
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}

/**
 * Visit a package declaration.
 */
export function visitPackageDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'package', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'package',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'package' } as PackageData,
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}

/**
 * Visit an interface declaration.
 */
export function visitInterfaceDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'interface', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const params = extractParameters(node);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'interface',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'interface',
      params,
    } as InterfaceData,
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}

/**
 * Visit a class declaration.
 */
export function visitClassDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'class', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  // Check for extends clause
  const extendsClause = findChildByTag(node, NODE_TAGS.EXTENDS_CLAUSE);
  const extendsClass = extendsClause ? findIdentifier(extendsClause) : undefined;

  // If extends, add reference
  if (extendsClass && extendsClause) {
    const extendsLoc = getNodeLocation(extendsClause, context);
    context.references.push({
      id: locationId(context.filePath, extendsLoc.line, extendsLoc.col),
      kind: 'extends',
      targetName: extendsClass,
      location: extendsLoc,
      scope: [...context.scope],
    });
  }

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'class',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: {
      kind: 'class',
      extendsName: extendsClass,
      isVirtual: hasKeyword(node, 'virtual'),
    } as ClassData,
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}

/**
 * Visit a program declaration.
 */
export function visitProgramDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'program', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'program',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'program' },
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}

/**
 * Visit a checker declaration.
 */
export function visitCheckerDeclaration(
  node: VeribleNode,
  context: MapperContext,
  visitChildren: VisitChildrenFn
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'checker', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'checker',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'checker', ports: [] },
  };

  context.declarations.push(declaration);

  // Visit children with updated scope
  const childContext = createChildContext(context, name, id);
  visitChildren(node, childContext);
}

/**
 * Visit a config declaration.
 */
export function visitConfigDeclaration(
  node: VeribleNode,
  context: MapperContext
): void {
  const name = findIdentifier(node);
  if (!name) return;

  const location = getNodeLocation(node, context);
  const id = declarationId(context.filePath, 'config', name, context.scope);
  const locId = locationId(context.filePath, location.line, location.col);

  const declaration: Declaration = {
    id,
    locationId: locId,
    kind: 'config',
    name,
    location,
    scope: [...context.scope],
    parentId: context.parentId,
    data: { kind: 'config', cellUseStatements: [] },
  };

  context.declarations.push(declaration);
  // Config declarations don't typically have scoped children
}
