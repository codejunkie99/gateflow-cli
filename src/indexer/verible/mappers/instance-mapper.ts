/**
 * Instance Mapper
 *
 * Handles module instantiation and bind directive mapping.
 *
 * @module verible/mappers/instance-mapper
 */

import type { VeribleNode } from '../types.js';
import { isNode, NODE_TAGS } from '../types.js';
import type { Instance, PortConnection } from '../../types/instance.js';
import type { MapperContext } from './types.js';
import { getNodeLocation } from './location-utils.js';
import {
  findIdentifier,
  findFirstIdentifier,
  findAllIdentifiers,
  findChildByTag,
  findInstanceNames,
  extractParameterOverrides,
} from './ast-utils.js';
import { locationId } from '../../ids/index.js';

/**
 * Extract port connections from instantiation.
 */
function extractPortConnections(node: VeribleNode, context: MapperContext): PortConnection[] {
  const connections: PortConnection[] = [];

  // Find named connections (.port(signal))
  for (const child of node.children) {
    if (isNode(child) && child.tag === NODE_TAGS.NAMED_PORT_CONNECTION) {
      const ids = findAllIdentifiers(child);
      if (ids.length >= 1) {
        const location = getNodeLocation(child, context);
        connections.push({
          portName: ids[0],
          signalName: ids.length > 1 ? ids[1] : ids[0],
          location,
        });
      }
    }
  }

  return connections;
}

/**
 * Visit a module instantiation.
 */
export function visitModuleInstantiation(
  node: VeribleNode,
  context: MapperContext
): void {
  // Get the module type being instantiated
  const typeNode = findChildByTag(node, NODE_TAGS.INSTANTIATION_TYPE);
  const targetName = typeNode ? findIdentifier(typeNode) : findFirstIdentifier(node);
  if (!targetName) return;

  // Find all instance names
  const instanceNames = findInstanceNames(node);

  for (const instanceName of instanceNames) {
    const location = getNodeLocation(node, context);
    const id = locationId(context.filePath, location.line, location.col);

    // Extract port connections
    const connections = extractPortConnections(node, context);

    // Extract parameter overrides
    const paramOverrides = extractParameterOverrides(node);

    const instance: Instance = {
      id,
      instanceKind: 'module',
      instanceName,
      targetName,
      location,
      parentScope: [...context.scope],
      connections,
      paramOverrides,
    };

    context.instances.push(instance);

    // Add reference to the target module
    context.references.push({
      id: locationId(context.filePath, location.line, location.col + 1),
      kind: 'type_usage',
      targetName,
      location,
      scope: [...context.scope],
    });
  }
}

/**
 * Visit a bind directive.
 */
export function visitBindDirective(
  node: VeribleNode,
  context: MapperContext
): void {
  // Bind has format: bind <target> <module> <instance>
  const identifiers = findAllIdentifiers(node);
  if (identifiers.length < 3) return;

  const bindTarget = identifiers[0];
  const targetName = identifiers[1];
  const instanceName = identifiers[2];

  const location = getNodeLocation(node, context);
  const id = locationId(context.filePath, location.line, location.col);

  const instance: Instance = {
    id,
    instanceKind: 'bind',
    instanceName,
    targetName,
    bindTarget,
    location,
    parentScope: [...context.scope],
  };

  context.instances.push(instance);
}
