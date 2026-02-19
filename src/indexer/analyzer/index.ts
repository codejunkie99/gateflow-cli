/**
 * Analyzer Module - Hierarchy and Dependency Analysis
 *
 * This module provides tools for analyzing the parsed and resolved project:
 *
 * ## Hierarchy Analysis
 * - Find top-level modules
 * - Get hierarchy statistics
 * - Search hierarchy for modules
 * - Format hierarchy as tree
 *
 * ## Dependency Analysis
 * - Build dependency graph
 * - Detect circular dependencies
 * - Calculate compile order
 * - Find affected files on change
 *
 * @example
 * ```typescript
 * import {
 *   findTopModules,
 *   getHierarchyStats,
 *   formatHierarchy,
 *   DependencyGraph,
 *   getAffectedFiles
 * } from './analyzer/index.js';
 *
 * // Analyze hierarchy
 * const topModules = findTopModules(index, instances);
 * console.log(`Top modules: ${topModules.map(m => m.name).join(', ')}`);
 *
 * const stats = getHierarchyStats(project.hierarchy, index, instances);
 * console.log(`Max depth: ${stats.maxDepth}`);
 *
 * // Print hierarchy tree
 * console.log(formatHierarchy(project.hierarchy));
 *
 * // Build dependency graph
 * const graph = new DependencyGraph();
 * graph.addEdges(project.dependencies);
 *
 * // Check for cycles
 * const cycles = graph.detectCycles();
 * if (cycles.length > 0) {
 *   console.warn('Circular dependencies found!');
 * }
 *
 * // Get compile order
 * const compileOrder = graph.getCompileOrder();
 *
 * // Find affected files
 * const affected = getAffectedFiles(graph, '/path/to/changed.sv');
 * console.log(`Files to recompile: ${affected.size}`);
 * ```
 *
 * @module analyzer
 */

// ============================================================================
// Hierarchy Analysis
// ============================================================================

;

// ============================================================================
// Dependency Analysis
// ============================================================================

export {
  DependencyGraph,
  
  
  
  
  
} from './dependency-analyzer.js';
