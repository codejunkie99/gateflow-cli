/**
 * Instance Mapper
 *
 * Handles module instantiation and bind directive mapping:
 * - Module instances
 * - Interface instances
 * - Checker instances
 * - Array instances (inst[3:0])
 * - Bind directives
 *
 * @module verible/mappers/instance-mapper
 */

import type { VeribleNode } from '../types.js';
import { isNode, isToken, NODE_TAGS } from '../types.js';
import type { Instance, InstanceKind, PortConnection } from '../../types/instance.js';
import type { MapperContext } from './types.js';
import { getNodeLocation } from './location-utils.js';
import {
  findIdentifier,
  findFirstIdentifier,
  findAllIdentifiers,
  findChildByTag,
  findInstanceNames,
  extractParameterOverrides,
  nodeToText,
} from './ast-utils.js';
import { locationId } from '../../ids/index.js';

// Track known interfaces and checkers for kind discrimination
const knownInterfaces = new Set<string>();
const knownCheckers = new Set<string>();

/**
 * Register an interface declaration for kind discrimination.
 */
export function registerInterface(name: string): void {
  knownInterfaces.add(name);
}

/**
 * Register a checker declaration for kind discrimination.
 */
export function registerChecker(name: string): void {
  knownCheckers.add(name);
}

/**
 * Determine instance kind based on target name.
 */
function determineInstanceKind(targetName: string): InstanceKind {
  if (knownInterfaces.has(targetName)) {
    return 'interface';
  }
  if (knownCheckers.has(targetName)) {
    return 'checker';
  }
  return 'module';
}

/**
 * Extract array range from instance name node.
 * Returns range string like "[3:0]" or undefined if not an array instance.
 */
function extractArrayRange(node: VeribleNode): string | undefined {
  for (const child of node.children) {
    if (isNode(child)) {
      // Look for dimension/range nodes
      if (child.tag === 'kDimensionRange' || child.tag === 'kPackedDimensions' || child.tag === 'kUnpackedDimensions') {
        return nodeToText(child);
      }
      // Look for bracket expressions
      if (child.tag === NODE_TAGS.BRACKET_GROUP || child.tag === 'kBracketGroup') {
        return nodeToText(child);
      }
      const range = extractArrayRange(child);
      if (range) return range;
    }
  }
  return undefined;
}

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

  // Determine instance kind (module, interface, or checker)
  const instanceKind = determineInstanceKind(targetName);

  // Try to extract array range
  const arrayRange = extractArrayRange(node);

  for (const instanceName of instanceNames) {
    const location = getNodeLocation(node, context);
    const id = locationId(context.filePath, location.line, location.col);

    // Extract port connections
    const connections = extractPortConnections(node, context);

    // Extract parameter overrides
    const paramOverrides = extractParameterOverrides(node);

    const instance: Instance = {
      id,
      instanceKind,
      instanceName: arrayRange ? `${instanceName}${arrayRange}` : instanceName,
      targetName,
      location,
      parentScope: [...context.scope],
      connections,
      paramOverrides,
      guard: context.guard,
    };

    context.instances.push(instance);

    // Add reference to the target module/interface/checker
    context.references.push({
      id: locationId(context.filePath, location.line, location.col + 1),
      kind: 'type_usage',
      targetName,
      location,
      scope: [...context.scope],
      guard: context.guard,
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

  // Add reference for the bound module (e.g., cpu_checker in "bind cpu cpu_checker u_chk")
  context.references.push({
    id: locationId(context.filePath, location.line, location.col + 1),
    kind: 'type_usage',
    targetName,
    location,
    scope: [...context.scope],
    guard: context.guard,
  });

  // Add reference for the bind target (e.g., cpu in "bind cpu cpu_checker u_chk")
  // This creates a dependency to the module being bound TO
  context.references.push({
    id: locationId(context.filePath, location.line, location.col + 2),
    kind: 'type_usage',
    targetName: bindTarget,
    location,
    scope: [...context.scope],
    guard: context.guard,
  });
}
