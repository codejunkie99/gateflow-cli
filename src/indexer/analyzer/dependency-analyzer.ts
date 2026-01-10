/**
 * Dependency Analyzer Module
 *
 * Analyzes file dependencies and compile order.
 *
 * Dependencies come from:
 * - Module instantiation (file A instantiates module from file B)
 * - Package imports (file A imports package from file B)
 * - File includes (file A `includes file B)
 * - Class inheritance (file A's class extends class from file B)
 *
 * @module analyzer/dependency-analyzer
 */

import type { FileDependency, FileRecord } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a dependency cycle.
 */
export interface DependencyCycle {
  /** Files in the cycle (in order) */
  files: string[];
  /** Dependencies forming the cycle */
  edges: FileDependency[];
}

/**
 * Statistics about dependencies.
 */
export interface DependencyStats {
  /** Total number of dependencies */
  totalDependencies: number;
  /** Number of files with dependencies */
  filesWithDependencies: number;
  /** Number of files with dependents (other files depend on them) */
  filesWithDependents: number;
  /** Number of "root" files (no dependencies) */
  rootFiles: number;
  /** Number of "leaf" files (no dependents) */
  leafFiles: number;
  /** Dependencies by reason */
  byReason: Record<string, number>;
  /** Whether there are circular dependencies */
  hasCycles: boolean;
}

// ============================================================================
// Dependency Graph Class
// ============================================================================

/**
 * Represents the file dependency graph.
 *
 * @example
 * ```typescript
 * const graph = new DependencyGraph();
 *
 * // Add dependencies
 * for (const dep of project.dependencies) {
 *   graph.addEdge(dep);
 * }
 *
 * // Get compile order
 * const order = graph.getCompileOrder();
 *
 * // Check for cycles
 * const cycles = graph.detectCycles();
 * if (cycles.length > 0) {
 *   console.warn('Circular dependencies detected!');
 * }
 * ```
 */
export class DependencyGraph {
  /** Adjacency list: file -> files it depends on */
  private dependsOn: Map<string, Set<string>> = new Map();

  /** Reverse adjacency list: file -> files that depend on it */
  private dependedOnBy: Map<string, Set<string>> = new Map();

  /** All edges */
  private edges: FileDependency[] = [];

  /** All files */
  private files: Set<string> = new Set();

  // --------------------------------------------------------------------------
  // Building the Graph
  // --------------------------------------------------------------------------

  /**
   * Add a dependency edge.
   *
   * @param dep - File dependency to add
   */
  addEdge(dep: FileDependency): void {
    this.edges.push(dep);
    this.files.add(dep.fromFile);
    this.files.add(dep.toFile);

    // Add to adjacency list
    if (!this.dependsOn.has(dep.fromFile)) {
      this.dependsOn.set(dep.fromFile, new Set());
    }
    this.dependsOn.get(dep.fromFile)!.add(dep.toFile);

    // Add to reverse adjacency list
    if (!this.dependedOnBy.has(dep.toFile)) {
      this.dependedOnBy.set(dep.toFile, new Set());
    }
    this.dependedOnBy.get(dep.toFile)!.add(dep.fromFile);
  }

  /**
   * Add multiple dependency edges.
   *
   * @param deps - Array of dependencies
   */
  addEdges(deps: FileDependency[]): void {
    for (const dep of deps) {
      this.addEdge(dep);
    }
  }

  // --------------------------------------------------------------------------
  // Query Methods
  // --------------------------------------------------------------------------

  /**
   * Get files that a file depends on (direct dependencies).
   *
   * @param file - File path
   * @returns Set of file paths
   */
  getDependencies(file: string): Set<string> {
    return this.dependsOn.get(file) || new Set();
  }

  /**
   * Get files that depend on a file (direct dependents).
   *
   * @param file - File path
   * @returns Set of file paths
   */
  getDependents(file: string): Set<string> {
    return this.dependedOnBy.get(file) || new Set();
  }

  /**
   * Get all dependencies (transitive closure).
   *
   * @param file - File path
   * @returns Set of all files this file depends on (directly or indirectly)
   */
  getAllDependencies(file: string): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue = [file];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.dependsOn.get(current);
      if (deps) {
        for (const dep of deps) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }

    return result;
  }

  /**
   * Get all dependents (reverse transitive closure).
   *
   * @param file - File path
   * @returns Set of all files that depend on this file (directly or indirectly)
   */
  getAllDependents(file: string): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue = [file];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const dependents = this.dependedOnBy.get(current);
      if (dependents) {
        for (const dep of dependents) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }

    return result;
  }

  /**
   * Get the specific dependency edges between two files.
   *
   * @param fromFile - Source file
   * @param toFile - Target file
   * @returns Array of dependencies
   */
  getEdges(fromFile: string, toFile: string): FileDependency[] {
    return this.edges.filter((e) => e.fromFile === fromFile && e.toFile === toFile);
  }

  // --------------------------------------------------------------------------
  // Compile Order
  // --------------------------------------------------------------------------

  /**
   * Get files in compile order (topological sort).
   *
   * Files with no dependencies come first.
   *
   * @returns Array of file paths in compile order
   * @throws Error if there are circular dependencies
   */
  getCompileOrder(): string[] {
    const inDegree = new Map<string, number>();
    const result: string[] = [];

    // Initialize in-degree counts
    for (const file of this.files) {
      inDegree.set(file, 0);
    }

    for (const file of this.files) {
      const deps = this.dependsOn.get(file);
      if (deps) {
        for (const dep of deps) {
          inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];

    for (const [file, degree] of inDegree) {
      if (degree === 0) {
        queue.push(file);
      }
    }

    while (queue.length > 0) {
      const file = queue.shift()!;
      result.push(file);

      const deps = this.dependsOn.get(file);
      if (deps) {
        for (const dep of deps) {
          const newDegree = (inDegree.get(dep) || 0) - 1;
          inDegree.set(dep, newDegree);
          if (newDegree === 0) {
            queue.push(dep);
          }
        }
      }
    }

    // Check for cycles
    if (result.length !== this.files.size) {
      throw new Error('Cannot determine compile order: circular dependencies exist');
    }

    // Reverse because we want dependencies first
    return result.reverse();
  }

  /**
   * Try to get compile order, returning null if there are cycles.
   *
   * @returns Array of file paths in compile order, or null if cycles exist
   */
  tryGetCompileOrder(): string[] | null {
    try {
      return this.getCompileOrder();
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Cycle Detection
  // --------------------------------------------------------------------------

  /**
   * Detect circular dependencies.
   *
   * Returns unique cycles - each cycle is reported only once,
   * regardless of which node the DFS started from.
   *
   * @returns Array of cycles found (deduplicated)
   */
  detectCycles(): DependencyCycle[] {
    const cycles: DependencyCycle[] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    // Track seen cycles by their canonical representation (sorted nodes joined)
    const seenCycles = new Set<string>();

    /**
     * Create a canonical key for a cycle to detect duplicates.
     * We normalize by finding the lexicographically smallest rotation.
     */
    const getCycleKey = (cyclePath: string[]): string => {
      // Remove the closing node (it's a duplicate of the start)
      const nodes = cyclePath.slice(0, -1);
      if (nodes.length === 0) return '';

      // Find all rotations and pick the lexicographically smallest
      let minRotation = nodes.join('|');
      for (let i = 1; i < nodes.length; i++) {
        const rotation = [...nodes.slice(i), ...nodes.slice(0, i)].join('|');
        if (rotation < minRotation) {
          minRotation = rotation;
        }
      }
      return minRotation;
    };

    const dfs = (file: string, path: string[]): void => {
      visited.add(file);
      recStack.add(file);
      path.push(file);

      const deps = this.dependsOn.get(file);
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            dfs(dep, path);
          } else if (recStack.has(dep)) {
            // Found a cycle
            const cycleStart = path.indexOf(dep);
            const cyclePath = path.slice(cycleStart);
            cyclePath.push(dep); // Close the cycle

            // Check if we've already seen this cycle
            const cycleKey = getCycleKey(cyclePath);
            if (!seenCycles.has(cycleKey)) {
              seenCycles.add(cycleKey);

              // Get edges for this cycle
              const cycleEdges: FileDependency[] = [];
              for (let i = 0; i < cyclePath.length - 1; i++) {
                const edges = this.getEdges(cyclePath[i], cyclePath[i + 1]);
                cycleEdges.push(...edges);
              }

              cycles.push({
                files: cyclePath,
                edges: cycleEdges,
              });
            }
          }
        }
      }

      path.pop();
      recStack.delete(file);
    };

    // Reset visited per starting node to find cycles reachable via different paths
    for (const file of this.files) {
      visited.clear();
      recStack.clear();
      dfs(file, []);
    }

    return cycles;
  }

  /**
   * Check if there are any circular dependencies.
   *
   * @returns True if cycles exist
   */
  hasCycles(): boolean {
    return this.detectCycles().length > 0;
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Get dependency statistics.
   *
   * @returns Dependency statistics
   */
  getStats(): DependencyStats {
    const byReason: Record<string, number> = {};
    for (const edge of this.edges) {
      byReason[edge.reason] = (byReason[edge.reason] || 0) + 1;
    }

    const filesWithDeps = new Set<string>();
    const filesWithDependents = new Set<string>();

    for (const [file, deps] of this.dependsOn) {
      if (deps.size > 0) {
        filesWithDeps.add(file);
      }
    }

    for (const [file, dependents] of this.dependedOnBy) {
      if (dependents.size > 0) {
        filesWithDependents.add(file);
      }
    }

    const rootFiles = [...this.files].filter(
      (f) => !this.dependsOn.has(f) || this.dependsOn.get(f)!.size === 0
    );

    const leafFiles = [...this.files].filter(
      (f) => !this.dependedOnBy.has(f) || this.dependedOnBy.get(f)!.size === 0
    );

    return {
      totalDependencies: this.edges.length,
      filesWithDependencies: filesWithDeps.size,
      filesWithDependents: filesWithDependents.size,
      rootFiles: rootFiles.length,
      leafFiles: leafFiles.length,
      byReason,
      hasCycles: this.hasCycles(),
    };
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /**
   * Get all files in the graph.
   *
   * @returns Set of all file paths
   */
  getAllFiles(): Set<string> {
    return new Set(this.files);
  }

  /**
   * Get all edges.
   *
   * @returns Array of all dependencies
   */
  getAllEdges(): FileDependency[] {
    return [...this.edges];
  }

  /**
   * Clear the graph.
   */
  clear(): void {
    this.dependsOn.clear();
    this.dependedOnBy.clear();
    this.edges = [];
    this.files.clear();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new dependency graph.
 *
 * @param dependencies - Optional initial dependencies
 * @returns New DependencyGraph instance
 */
export function createDependencyGraph(dependencies?: FileDependency[]): DependencyGraph {
  const graph = new DependencyGraph();
  if (dependencies) {
    graph.addEdges(dependencies);
  }
  return graph;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a cycle as a readable string.
 *
 * @param cycle - Dependency cycle
 * @returns Formatted string
 */
export function formatCycle(cycle: DependencyCycle): string {
  return cycle.files.join(' -> ');
}

/**
 * Get affected files when a file changes.
 *
 * Returns all files that might need recompilation.
 *
 * @param graph - Dependency graph
 * @param changedFile - File that changed
 * @returns Set of affected file paths (including the changed file)
 */
export function getAffectedFiles(
  graph: DependencyGraph,
  changedFile: string
): Set<string> {
  const affected = graph.getAllDependents(changedFile);
  affected.add(changedFile);
  return affected;
}
