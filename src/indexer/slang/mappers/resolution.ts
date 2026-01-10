/**
 * Resolution Utilities
 *
 * Post-processing utilities for resolving references and instances.
 *
 * @module slang/mappers/resolution
 */

import type { Declaration } from '../../types/declaration.js';
import type { Reference } from '../../types/reference.js';
import type { Instance } from '../../types/instance.js';
import { buildLookupKey } from './helpers.js';

// ============================================================================
// Reference Resolution
// ============================================================================

/**
 * Resolve references using a declaration lookup map.
 *
 * This is called after initial mapping to fill in resolvedId fields.
 *
 * @param references - References to resolve
 * @param declarations - All available declarations
 * @returns References with resolvedId populated where possible
 */
export function resolveReferences(
  references: Reference[],
  declarations: Declaration[]
): Reference[] {
  // Build lookup by name and various scope levels
  const lookup = new Map<string, string>();

  for (const decl of declarations) {
    // Add with full scope
    lookup.set(buildLookupKey(decl.name, decl.scope), decl.id);

    // Also add without scope for top-level resolution
    if (decl.scope.length === 0) {
      lookup.set(decl.name, decl.id);
    }
  }

  return references.map((ref) => {
    if (ref.resolvedId) {
      return ref; // Already resolved
    }

    // Try to resolve with scope context
    let resolved: string | undefined;

    // Try from innermost scope outward
    for (let i = ref.scope.length; i >= 0; i--) {
      const tryScope = ref.scope.slice(0, i);
      const key = buildLookupKey(ref.targetName, tryScope);
      resolved = lookup.get(key);
      if (resolved) break;
    }

    // Try without scope (top-level)
    if (!resolved) {
      resolved = lookup.get(ref.targetName);
    }

    if (resolved) {
      return { ...ref, resolvedId: resolved };
    }

    return ref;
  });
}

// ============================================================================
// Instance Resolution
// ============================================================================

/**
 * Resolve instance targets using a declaration lookup map.
 *
 * @param instances - Instances to resolve
 * @param declarations - All available declarations
 * @returns Instances with resolvedId populated where possible
 */
export function resolveInstances(
  instances: Instance[],
  declarations: Declaration[]
): Instance[] {
  // Build lookup for modules and interfaces
  const lookup = new Map<string, string>();

  for (const decl of declarations) {
    if (decl.kind === 'module' || decl.kind === 'interface') {
      lookup.set(decl.name, decl.id);
    }
  }

  return instances.map((inst) => {
    if (inst.resolvedId) {
      return inst; // Already resolved
    }

    const resolved = lookup.get(inst.targetName);
    if (resolved) {
      return { ...inst, resolvedId: resolved };
    }

    return inst;
  });
}
