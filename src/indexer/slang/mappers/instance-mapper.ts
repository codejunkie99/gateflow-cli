/**
 * Instance Mapper
 *
 * Maps slang instance symbols to instances with resolved IDs.
 *
 * @module slang/mappers/instance-mapper
 */

import type { SlangInstanceSymbol } from '../slang-types.js';
import type { Instance, PortConnection } from '../../types/instance.js';
import type { MappingContext } from './types.js';
import { mapLocation, buildLookupKey } from './helpers.js';
import { locationId } from '../../ids/index.js';

// ============================================================================
// Instance Mapping
// ============================================================================

/**
 * Map slang instance to Instance.
 */
export function mapInstance(symbol: SlangInstanceSymbol, context: MappingContext): Instance | null {
  const loc = mapLocation(symbol.location);
  if (!loc) return null;

  // Convert parameter values to overrides
  const paramOverrides: Record<string, string> = {};
  if (symbol.parameters) {
    for (const param of symbol.parameters) {
      paramOverrides[param.name] = param.value;
    }
  }

  // Convert connections
  const connections: PortConnection[] = [];
  if (symbol.connections) {
    for (const conn of symbol.connections) {
      const connLoc = mapLocation(conn.location);
      connections.push({
        portName: conn.port,
        signalName: conn.expr,
        location: connLoc || loc,
      });
    }
  }

  // Try to resolve the target declaration ID
  const resolvedId = context.declLookup.get(buildLookupKey(symbol.definitionName, []));

  return {
    id: locationId(loc.file, loc.line, loc.col),
    instanceKind: 'module', // slang instances are elaborated modules
    instanceName: symbol.name,
    targetName: symbol.definitionName,
    location: loc,
    parentScope: [...context.scope],
    resolvedId,
    paramOverrides: Object.keys(paramOverrides).length > 0 ? paramOverrides : undefined,
    connections: connections.length > 0 ? connections : undefined,
  };
}
