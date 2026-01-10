/**
 * Hierarchy Builder Module
 *
 * Builds and analyzes the module hierarchy tree.
 *
 * The hierarchy shows how modules are instantiated:
 * ```
 * top (root)
 * ├── u_cpu (cpu module)
 * │   ├── u_alu (alu module)
 * │   └── u_reg (register_file module)
 * └── u_mem (memory module)
 * ```
 *
 * @module analyzer/hierarchy-builder
 */

import type { HierarchyNode, Instance, Declaration } from '../types/index.js';
import type { DeclarationIndex } from '../resolver/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Statistics about the hierarchy.
 *this is basically a summary of the hierarchy.
 *it includes the number of top-level modules, the total number of unique modules instantiated,
 *the total number of instances, the maximum hierarchy depth, the modules that are never instantiated,
 *and the modules that have multiple instantiations.
 */
export interface HierarchyStats {
  /** Number of top-level modules */
  topModuleCount: number;
  /** Total unique modules instantiated */
  uniqueModules: number;
  /** Total instance count (including duplicates) */
  totalInstances: number;
  /** Maximum hierarchy depth */
  maxDepth: number;
  /** Modules that are never instantiated */
  unusedModules: string[];
  /** Modules that have multiple instantiations */
  multipleInstanceModules: string[];
}

/**
 * Result from finding a path in the hierarchy.
 */
export interface HierarchyPath {
  /** Full path from top to target */
  path: string[];
  /** Instance names along the path */
  instances: string[];
  /** The target node */
  node: HierarchyNode;
}

// ============================================================================
// Hierarchy Analysis Functions
// ============================================================================

/**
 * Find all top-level modules (modules not instantiated anywhere).
 *
 * @param index - Declaration index
 * @param instances - All instances
 * @returns Array of top-level module declarations
 */
export function findTopModules(
  index: DeclarationIndex,
  instances: Instance[]
): Declaration[] {
  const instantiatedModuleIds = new Set(
    instances.filter((i) => i.resolvedId).map((i) => i.resolvedId!)
  );

  return index.getByKind('module').filter((m) => !instantiatedModuleIds.has(m.id));
}

/**
 * Get statistics about the hierarchy.
 *
 * @param hierarchy - Hierarchy tree
 * @param index - Declaration index
 * @param instances - All instances
 * @returns Hierarchy statistics
 */
export function getHierarchyStats(
  hierarchy: HierarchyNode[],
  index: DeclarationIndex,
  instances: Instance[]
): HierarchyStats {
  const allModules = index.getByKind('module');
  const instantiatedModuleIds = new Set(
    instances.filter((i) => i.resolvedId).map((i) => i.resolvedId!)
  );

  // Count instances per module
  const instanceCountByModule = new Map<string, number>();
  for (const inst of instances) {
    if (inst.resolvedId) {
      const count = instanceCountByModule.get(inst.resolvedId) || 0;
      instanceCountByModule.set(inst.resolvedId, count + 1);
    }
  }

  // Find unused modules
  const unusedModules = allModules
    .filter((m) => !instantiatedModuleIds.has(m.id) && !hierarchy.some((h) => h.moduleId === m.id))
    .map((m) => m.name);

  // Find modules with multiple instances
  const multipleInstanceModules: string[] = [];
  for (const [moduleId, count] of instanceCountByModule.entries()) {
    if (count > 1) {
      const mod = index.getById(moduleId);
      if (mod) {
        multipleInstanceModules.push(mod.name);
      }
    }
  }

  // Calculate max depth
  const maxDepth = Math.max(...hierarchy.map((h) => getNodeDepth(h)), 0);

  // Count total instances
  let totalInstances = 0;
  for (const node of hierarchy) {
    totalInstances += countInstances(node);
  }

  return {
    topModuleCount: hierarchy.length,
    uniqueModules: new Set(instances.filter((i) => i.resolvedId).map((i) => i.resolvedId!)).size,
    totalInstances,
    maxDepth,
    unusedModules,
    multipleInstanceModules,
  };
}

/**
 * Get the depth of a hierarchy node.
 */
function getNodeDepth(node: HierarchyNode): number {
  if (node.children.length === 0) {
    return 1;
  }
  return 1 + Math.max(...node.children.map(getNodeDepth));
}

/**
 * Count total instances in a hierarchy subtree.
 */
function countInstances(node: HierarchyNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countInstances(child), 0);
}

/**
 * Find a module in the hierarchy by name.
 *
 * @param hierarchy - Hierarchy tree
 * @param moduleName - Module name to find
 * @returns All paths to the module
 */
export function findModuleInHierarchy(
  hierarchy: HierarchyNode[],
  moduleName: string
): HierarchyPath[] {
  const results: HierarchyPath[] = [];

  for (const root of hierarchy) {
    findModuleInNode(root, moduleName, [], [], results);
  }

  return results;
}

/**
 * Recursive helper to find module in hierarchy.
 */
function findModuleInNode(
  node: HierarchyNode,
  moduleName: string,
  pathSoFar: string[],
  instancesSoFar: string[],
  results: HierarchyPath[]
): void {
  const currentPath = [...pathSoFar, node.moduleName];
  const currentInstances = [...instancesSoFar, node.instanceName];

  if (node.moduleName === moduleName) {
    results.push({
      path: currentPath,
      instances: currentInstances,
      node,
    });
  }

  for (const child of node.children) {
    findModuleInNode(child, moduleName, currentPath, currentInstances, results);
  }
}

/**
 * Get the hierarchical path string for a node.
 *
 * @param path - HierarchyPath from findModuleInHierarchy
 * @returns Path string like "top.u_cpu.u_alu"
 */
export function getPathString(path: HierarchyPath): string {
  return path.instances.join('.');
}

/**
 * Find all leaf modules (modules with no children).
 *
 * @param hierarchy - Hierarchy tree
 * @returns Array of leaf node names
 */
export function findLeafModules(hierarchy: HierarchyNode[]): string[] {
  const leaves: string[] = [];

  for (const root of hierarchy) {
    findLeavesInNode(root, leaves);
  }

  return [...new Set(leaves)];
}

/**
 * Recursive helper to find leaf modules.
 */
function findLeavesInNode(node: HierarchyNode, leaves: string[]): void {
  if (node.children.length === 0) {
    leaves.push(node.moduleName);
  } else {
    for (const child of node.children) {
      findLeavesInNode(child, leaves);
    }
  }
}

/**
 * Flatten the hierarchy to a list of all paths.
 *
 * @param hierarchy - Hierarchy tree
 * @returns Array of all paths to all nodes
 */
export function flattenHierarchy(hierarchy: HierarchyNode[]): HierarchyPath[] {
  const results: HierarchyPath[] = [];

  for (const root of hierarchy) {
    flattenNode(root, [], [], results);
  }

  return results;
}

/**
 * Recursive helper to flatten hierarchy.
 */
function flattenNode(
  node: HierarchyNode,
  pathSoFar: string[],
  instancesSoFar: string[],
  results: HierarchyPath[]
): void {
  const currentPath = [...pathSoFar, node.moduleName];
  const currentInstances = [...instancesSoFar, node.instanceName];

  results.push({
    path: currentPath,
    instances: currentInstances,
    node,
  });

  for (const child of node.children) {
    flattenNode(child, currentPath, currentInstances, results);
  }
}

/**
 * Print hierarchy as a tree string.
 *
 * @param hierarchy - Hierarchy tree
 * @returns Formatted tree string
 */
export function formatHierarchy(hierarchy: HierarchyNode[]): string {
  const lines: string[] = [];

  for (const root of hierarchy) {
    formatNode(root, '', true, lines);
  }

  return lines.join('\n');
}

/**
 * Recursive helper to format hierarchy as tree.
 */
function formatNode(
  node: HierarchyNode,
  prefix: string,
  isLast: boolean,
  lines: string[]
): void {
  const connector = isLast ? '└── ' : '├── ';
  const label =
    node.instanceName === 'root'
      ? `${node.moduleName} (top)`
      : `${node.instanceName} (${node.moduleName})`;

  lines.push(`${prefix}${connector}${label}`);

  const newPrefix = prefix + (isLast ? '    ' : '│   ');

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childIsLast = i === node.children.length - 1;
    formatNode(child, newPrefix, childIsLast, lines);
  }
}
