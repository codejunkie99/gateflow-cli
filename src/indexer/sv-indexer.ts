/**
 * SV Indexer - New SystemVerilog Indexer
 *
 * A comprehensive indexer for SystemVerilog codebases that extracts
 * declarations, references, instances, and directives, then resolves
 * cross-file connections.
 *
 * ## Features
 *
 * - **Parses SystemVerilog files** to extract entities
 * - **Handles preprocessor directives** (`define, `include, `ifdef)
 * - **Tracks scope** (packages, modules, classes, functions)
 * - **Resolves connections** between files
 * - **Builds module hierarchy** tree
 * - **Generates dependency graph** for compile order
 *
 * ## Quick Start
 *
 * ```typescript
 * import { SVIndexer } from './indexer/sv-indexer.js';
 *
 * // Create indexer
 * const indexer = new SVIndexer();
 *
 * // Index a project from filelist
 * const project = await indexer.indexProject('/path/to/project.f');
 *
 * // Query declarations
 * const modules = project.declarations.filter(d => d.kind === 'module');
 * console.log(`Found ${modules.length} modules`);
 *
 * // Get hierarchy
 * console.log(`Top modules: ${project.hierarchy.length}`);
 *
 * // Get compile order
 * const order = indexer.getCompileOrder(project);
 * ```
 *
 * @module indexer/sv-indexer
 */

// ============================================================================
// Re-exports from submodules
// ============================================================================

// Types
export type {
  Location,
  Guard,
  ParseError,
  LineOffsets,
  FileRecord,
  FileReadResult,
  Declaration,
  DeclarationKind,
  DeclarationData,
  Reference,
  ReferenceKind,
  ReferenceData,
  Instance,
  InstanceKind,
  PortConnection,
  Directive,
  DirectiveKind,
  DirectiveData,
  FileUnderstanderResult,
  ParseStats,
  ResolvedProject,
  HierarchyNode,
  FileDependency,
} from './types/index.js';

// IDs
export { locationId, declarationId, isLocationId, isDeclarationId } from './ids/index.js';

// Reader
export { readFile, readFiles, buildLineIndex, getLineNumber, getLocation } from './reader/index.js';

// Preprocessor
export { preprocess, stripComments, handleLineContinuation } from './preprocessor/index.js';

// Scanners
export {
  scanDirectives,
  scanDeclarations,
  scanReferences,
  scanInstances,
  ScopeTracker,
} from './scanners/index.js';

// Understander
export { FileUnderstander, understandFiles } from './understander/index.js';

// Recipe
export { FilelistParser, parseFilelist, type Recipe } from './recipe/index.js';

// Resolver
export { DeclarationIndex, ProjectResolver } from './resolver/index.js';

// Analyzer
export {
  findTopModules,
  getHierarchyStats,
  formatHierarchy,
  DependencyGraph,
  getAffectedFiles,
} from './analyzer/index.js';

// ============================================================================
// Main Indexer Class
// ============================================================================

import type { ResolvedProject, FileUnderstanderResult } from './types/index.js';
import { FileUnderstander, understandFiles } from './understander/index.js';
import { FilelistParser, type Recipe } from './recipe/index.js';
import { ProjectResolver } from './resolver/index.js';
import { DependencyGraph } from './analyzer/index.js';

/**
 * Main entry point for indexing SystemVerilog projects.
 *
 * @example
 * ```typescript
 * const indexer = new SVIndexer();
 *
 * // Option 1: Index from filelist
 * const project = await indexer.indexProject('/path/to/project.f');
 *
 * // Option 2: Index specific files
 * const project2 = await indexer.indexFiles([
 *   '/path/to/file1.sv',
 *   '/path/to/file2.sv'
 * ]);
 *
 * // Query the index
 * const counter = project.declarations.find(
 *   d => d.kind === 'module' && d.name === 'counter'
 * );
 * ```
 */
export class SVIndexer {
  private understander: FileUnderstander;
  private filelistParser: FilelistParser;

  constructor() {
    this.understander = new FileUnderstander();
    this.filelistParser = new FilelistParser();
  }

  // --------------------------------------------------------------------------
  // Main Methods
  // --------------------------------------------------------------------------

  /**
   * Index a project from a filelist.
   *
   * @param filelistPath - Path to .f file
   * @returns Resolved project with all entities
   */
  async indexProject(filelistPath: string): Promise<ResolvedProject> {
    // Parse filelist
    const recipe = await this.filelistParser.parse(filelistPath);

    // Parse all files
    const results = await this.parseFiles(recipe.files);

    // Resolve connections
    const resolver = new ProjectResolver(recipe);
    for (const result of results) {
      if (result.success) {
        resolver.addFile(result.result!);
      }
    }

    return resolver.resolve();
  }

  /**
   * Index specific files (without filelist).
   *
   * @param filePaths - Array of file paths
   * @param recipe - Optional recipe for include resolution
   * @returns Resolved project
   */
  async indexFiles(filePaths: string[], recipe?: Recipe): Promise<ResolvedProject> {
    // Parse all files
    const results = await this.parseFiles(filePaths);

    // Resolve connections
    const resolver = new ProjectResolver(recipe);
    for (const result of results) {
      if (result.success) {
        resolver.addFile(result.result!);
      }
    }

    return resolver.resolve();
  }

  /**
   * Parse a single file without resolution.
   *
   * @param filePath - Path to file
   * @returns Parse result
   */
  async parseFile(filePath: string): Promise<FileUnderstanderResult> {
    return this.understander.understand(filePath);
  }

  /**
   * Parse multiple files without resolution.
   *
   * @param filePaths - Array of file paths
   * @returns Array of parse results
   */
  async parseFiles(filePaths: string[]): Promise<ParseFileResult[]> {
    const results = await understandFiles(filePaths);
    return results.map((r) => ({
      success: r.success,
      path: r.path,
      result: r.success ? r.result : undefined,
      error: r.success ? undefined : r.error,
    }));
  }

  /**
   * Parse a filelist to get recipe.
   *
   * @param filelistPath - Path to .f file
   * @returns Parsed recipe
   */
  async parseFilelist(filelistPath: string): Promise<Recipe> {
    return this.filelistParser.parse(filelistPath);
  }

  // --------------------------------------------------------------------------
  // Query Helpers
  // --------------------------------------------------------------------------

  /**
   * Get compile order for a resolved project.
   *
   * @param project - Resolved project
   * @returns Array of file paths in compile order
   */
  getCompileOrder(project: ResolvedProject): string[] {
    const graph = new DependencyGraph();
    graph.addEdges(project.dependencies);
    return graph.tryGetCompileOrder() || project.files.map((f) => f.path);
  }

  /**
   * Get files affected by a change.
   *
   * @param project - Resolved project
   * @param changedFile - File that changed
   * @returns Set of affected file paths (includes the changed file itself)
   */
  getAffectedFiles(project: ResolvedProject, changedFile: string): Set<string> {
    const graph = new DependencyGraph();
    graph.addEdges(project.dependencies);
    const affected = graph.getAllDependents(changedFile);
    affected.add(changedFile); // Include the changed file itself
    return affected;
  }
}

/**
 * Result from parsing a file.
 */
export interface ParseFileResult {
  success: boolean;
  path: string;
  result?: FileUnderstanderResult;
  error?: string;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new SVIndexer instance.
 *
 * @returns New SVIndexer
 */
export function createSVIndexer(): SVIndexer {
  return new SVIndexer();
}
