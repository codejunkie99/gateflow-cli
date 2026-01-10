/**
 * SV Indexer - New SystemVerilog Indexer
 *
 * A comprehensive indexer for SystemVerilog codebases that extracts
 * declarations, references, instances, and directives, then resolves
 * cross-file connections.
 *
 * ## Architecture: Two-Layer Indexing
 *
 * The indexer uses a two-layer architecture for optimal performance and accuracy:
 *
 * - **Layer A (Verible/regex)**: Fast, syntactic parsing for instant feedback
 * - **Layer B (slang)**: Accurate semantic analysis when available
 *
 * Layer A always runs first, providing immediate results. If slang is available,
 * Layer B runs in parallel and its results are merged to provide accurate
 * reference resolution, evaluated parameters, and complete type information.
 *
 * ## Features
 *
 * - **Parses SystemVerilog files** to extract entities
 * - **Handles preprocessor directives** (`define, `include, `ifdef)
 * - **Tracks scope** (packages, modules, classes, functions)
 * - **Resolves connections** between files
 * - **Builds module hierarchy** tree
 * - **Generates dependency graph** for compile order
 * - **Semantic analysis** via slang (when available)
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
 * // Check if semantic analysis was performed
 * if (project.hasSemanticAnalysis) {
 *   console.log('Semantic analysis available');
 * }
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
  SemanticIndex,
} from './types/index.js';

// Slang (Layer B)
export {
  SlangBackend,
  canUseSlang,
  analyzeWithSlang,
  type SlangBackendResult,
  type SlangBackendOptions,
} from './slang/index.js';

// Merge
export {
  mergeIndices,
  combineFileResults,
  createQueryAPI,
  QueryAPI,
  type MergedIndex,
  type LayerAResult,
} from './merge/index.js';

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

import type { ResolvedProject, FileUnderstanderResult, SemanticIndex } from './types/index.js';
import { FileUnderstander, understandFiles } from './understander/index.js';
import { FilelistParser, type Recipe } from './recipe/index.js';
import { ProjectResolver } from './resolver/index.js';
import { DependencyGraph } from './analyzer/index.js';
import { SlangBackend, type SlangBackendOptions, type SlangBackendResult } from './slang/index.js';
import { mergeIndices, combineFileResults, toResolvedProject, type MergedIndex } from './merge/index.js';

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
/**
 * Options for SVIndexer.
 */
export interface SVIndexerOptions {
  /**
   * Enable semantic analysis (Layer B) using slang.
   * When enabled, slang will run in parallel with syntactic parsing
   * to provide accurate reference resolution and evaluated parameters.
   *
   * Default: true (if slang is available)
   */
  enableSemanticAnalysis?: boolean;

  /**
   * Options for slang semantic analysis.
   */
  slangOptions?: SlangBackendOptions;
}

export class SVIndexer {
  private understander: FileUnderstander;
  private filelistParser: FilelistParser;
  private slangBackend: SlangBackend;
  private options: SVIndexerOptions;

  constructor(options: SVIndexerOptions = {}) {
    this.understander = new FileUnderstander();
    this.filelistParser = new FilelistParser();
    this.slangBackend = new SlangBackend(options.slangOptions);
    this.options = {
      enableSemanticAnalysis: options.enableSemanticAnalysis ?? true,
      slangOptions: options.slangOptions,
    };
  }

  /**
   * Check if semantic analysis (slang) is available.
   *
   * @returns true if slang can be used
   */
  async isSemanticAnalysisAvailable(): Promise<boolean> {
    if (!this.options.enableSemanticAnalysis) {
      return false;
    }
    return this.slangBackend.isAvailable();
  }

  // --------------------------------------------------------------------------
  // Main Methods
  // --------------------------------------------------------------------------

  /**
   * Index a project from a filelist.
   *
   * This method:
   * 1. Parses the filelist to get the recipe
   * 2. Runs Layer A (syntactic parsing) on all files
   * 3. Optionally runs Layer B (semantic analysis) via slang
   * 4. Merges results from both layers
   * 5. Resolves cross-file connections
   *
   * @param filelistPath - Path to .f file
   * @returns Resolved project with all entities
   */
  async indexProject(filelistPath: string): Promise<ResolvedProject> {
    // Parse filelist
    const recipe = await this.filelistParser.parse(filelistPath);

    // Run Layer A and Layer B in parallel
    const [layerAResults, layerBResult] = await Promise.all([
      // Layer A: Syntactic parsing
      this.parseFiles(recipe.files),

      // Layer B: Semantic analysis (if available)
      this.runSemanticAnalysis(recipe),
    ]);

    // Check if we should use merged approach or legacy approach
    if (layerBResult?.success) {
      // Use new merged approach
      const fileResults = layerAResults
        .filter((r) => r.success && r.result)
        .map((r) => r.result!);

      const layerA = combineFileResults(fileResults);
      const merged = mergeIndices(layerA, layerBResult);

      // Convert to ResolvedProject format with semantic data
      const project = toResolvedProject(merged);

      // Add semantic index info
      return {
        ...project,
        semantic: {
          declarations: layerBResult.declarations,
          references: layerBResult.references,
          instances: layerBResult.instances,
          source: 'slang',
          stats: {
            analysisTimeMs: layerBResult.meta.analysisTimeMs,
            resolvedCount: merged.meta.stats.referencesResolved + merged.meta.stats.instancesResolved,
            unresolvedCount: layerBResult.references.filter((r) => !r.resolvedId).length,
          },
        },
        hasSemanticAnalysis: true,
      };
    }

    // Fallback to legacy approach (Layer A only)
    const resolver = new ProjectResolver(recipe);
    for (const result of layerAResults) {
      if (result.success && result.result) {
        resolver.addFile(result.result);
      }
    }

    const project = await resolver.resolve();
    return {
      ...project,
      hasSemanticAnalysis: false,
    };
  }

  /**
   * Run semantic analysis (Layer B) if available.
   *
   * @param recipe - Project recipe
   * @returns Semantic analysis result or undefined
   */
  private async runSemanticAnalysis(recipe: Recipe): Promise<SlangBackendResult | undefined> {
    if (!this.options.enableSemanticAnalysis) {
      return undefined;
    }

    try {
      const available = await this.slangBackend.isAvailable();
      if (!available) {
        return undefined;
      }

      return await this.slangBackend.analyzeRecipe(recipe, this.options.slangOptions);
    } catch (error) {
      // Semantic analysis failed - continue with Layer A only
      console.warn('Semantic analysis failed:', error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  /**
   * Index specific files (without filelist).
   *
   * @param filePaths - Array of file paths
   * @param recipe - Optional recipe for include resolution
   * @returns Resolved project
   */
  async indexFiles(filePaths: string[], recipe?: Recipe): Promise<ResolvedProject> {
    // Create a synthetic recipe if none provided
    const effectiveRecipe: Recipe = recipe || {
      id: `files-${filePaths.length}`,
      sourceFile: filePaths[0],
      files: filePaths,
      includePaths: [],
      defines: {},
      nestedFilelists: [],
    };

    // Run Layer A and Layer B in parallel
    const [layerAResults, layerBResult] = await Promise.all([
      this.parseFiles(filePaths),
      this.runSemanticAnalysis(effectiveRecipe),
    ]);

    // Check if we should use merged approach
    if (layerBResult?.success) {
      const fileResults = layerAResults
        .filter((r) => r.success && r.result)
        .map((r) => r.result!);

      const layerA = combineFileResults(fileResults);
      const merged = mergeIndices(layerA, layerBResult);
      const project = toResolvedProject(merged);

      return {
        ...project,
        semantic: {
          declarations: layerBResult.declarations,
          references: layerBResult.references,
          instances: layerBResult.instances,
          source: 'slang',
          stats: {
            analysisTimeMs: layerBResult.meta.analysisTimeMs,
            resolvedCount: merged.meta.stats.referencesResolved + merged.meta.stats.instancesResolved,
            unresolvedCount: layerBResult.references.filter((r) => !r.resolvedId).length,
          },
        },
        hasSemanticAnalysis: true,
      };
    }

    // Fallback to legacy approach
    const resolver = new ProjectResolver(effectiveRecipe);
    for (const result of layerAResults) {
      if (result.success && result.result) {
        resolver.addFile(result.result);
      }
    }

    const project = await resolver.resolve();
    return {
      ...project,
      hasSemanticAnalysis: false,
    };
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
 * @param options - Optional configuration
 * @returns New SVIndexer
 *
 * @example
 * ```typescript
 * // Default (semantic analysis enabled if slang available)
 * const indexer = createSVIndexer();
 *
 * // Disable semantic analysis
 * const fastIndexer = createSVIndexer({ enableSemanticAnalysis: false });
 *
 * // With custom slang options
 * const customIndexer = createSVIndexer({
 *   slangOptions: {
 *     topModule: 'top',
 *     timeout: 120000,
 *   }
 * });
 * ```
 */
export function createSVIndexer(options?: SVIndexerOptions): SVIndexer {
  return new SVIndexer(options);
}
