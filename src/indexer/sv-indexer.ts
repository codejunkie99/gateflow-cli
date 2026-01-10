/**
 * SV Indexer - New SystemVerilog Indexer
 *
 * A comprehensive indexer for SystemVerilog codebases that extracts
 * declarations, references, instances, and directives, then resolves
 * cross-file connections.
 *
 * ## Architecture: Slang-Primary with Verible
 *
 * The indexer uses a two-parser architecture:
 *
 * - **Slang (primary)**: Full SV 2017 semantic analysis - declarations, references, instances
 * - **Verible (directives)**: Fast CST parsing for preprocessor directives only
 *
 * Both parsers run in parallel. Slang provides better semantic analysis while
 * Verible extracts directives (which Slang evaluates but doesn't report).
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

  /**
   * Enable verbose logging for debugging and performance analysis.
   * When enabled, logs detailed timing information and Layer B status.
   *
   * Default: false
   */
  verbose?: boolean;
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
      verbose: options.verbose ?? false,
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
    const startTime = performance.now();

    // Parse filelist
    const parseStart = performance.now();
    const recipe = await this.filelistParser.parse(filelistPath);
    const parseTime = performance.now() - parseStart;

    if (this.options.verbose) {
      console.log(`[Perf] Filelist parsing: ${parseTime.toFixed(2)}ms`);
      console.log(`[Perf] Files to index: ${recipe.files.length}`);
    }

    // Run Layer A and Layer B in parallel
    const parallelStart = performance.now();
    const [layerAResults, layerBResult] = await Promise.all([
      // Layer A: Syntactic parsing
      this.parseFiles(recipe.files),

      // Layer B: Semantic analysis (if available)
      this.runSemanticAnalysis(recipe),
    ]);
    const parallelTime = performance.now() - parallelStart;

    if (this.options.verbose) {
      console.log(`[Perf] Parallel analysis completed: ${parallelTime.toFixed(2)}ms`);
    }

    // Check if we should use merged approach or legacy approach
    if (layerBResult?.success) {
      // Use new merged approach
      const mergeStart = performance.now();
      const fileResults = layerAResults
        .filter((r) => r.success && r.result)
        .map((r) => r.result!);

      const layerA = combineFileResults(fileResults);
      const merged = mergeIndices(layerA, layerBResult);
      const mergeTime = performance.now() - mergeStart;

      if (this.options.verbose) {
        console.log(`[Perf] Index merging: ${mergeTime.toFixed(2)}ms`);
      }

      // Convert to ResolvedProject format with semantic data
      const buildStart = performance.now();
      const project = toResolvedProject(merged);
      const buildTime = performance.now() - buildStart;

      const totalTime = performance.now() - startTime;

      if (this.options.verbose) {
        console.log(`[Perf] Project building: ${buildTime.toFixed(2)}ms`);
        console.log(`[Perf] Total indexing time: ${totalTime.toFixed(2)}ms`);
        console.log(`[Perf] Breakdown: parse=${parseTime.toFixed(0)}ms, analysis=${parallelTime.toFixed(0)}ms, merge=${mergeTime.toFixed(0)}ms, build=${buildTime.toFixed(0)}ms`);
      }

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
    const resolveStart = performance.now();
    const resolver = new ProjectResolver(recipe);
    for (const result of layerAResults) {
      if (result.success && result.result) {
        resolver.addFile(result.result);
      }
    }

    const project = await resolver.resolve();
    const resolveTime = performance.now() - resolveStart;
    const totalTime = performance.now() - startTime;

    if (this.options.verbose) {
      console.log(`[Perf] Project resolution: ${resolveTime.toFixed(2)}ms`);
      console.log(`[Perf] Total indexing time: ${totalTime.toFixed(2)}ms`);
    }

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
      if (this.options.verbose) {
        console.log('[Layer B] Semantic analysis disabled - using syntactic analysis only');
      }
      return undefined;
    }

    try {
      const available = await this.slangBackend.isAvailable();
      if (!available) {
        console.warn('[Layer B] Slang not available - falling back to syntactic analysis');
        console.warn('[Layer B] Install Slang for improved accuracy: https://github.com/MikePopoloski/slang');
        return undefined;
      }

      if (this.options.verbose) {
        console.log('[Layer B] Running semantic analysis with Slang...');
      }

      const result = await this.slangBackend.analyzeRecipe(recipe, this.options.slangOptions);

      if (!result.success) {
        console.warn('[Layer B] Semantic analysis completed with errors:');
        console.warn(`[Layer B] ${result.diagnostics.filter(d => d.severity === 'error').length} errors, ${result.diagnostics.filter(d => d.severity === 'warning').length} warnings`);
        if (this.options.verbose && result.diagnostics.length > 0) {
          result.diagnostics.slice(0, 5).forEach(d => {
            console.warn(`[Layer B]   ${d.severity}: ${d.message}`);
          });
          if (result.diagnostics.length > 5) {
            console.warn(`[Layer B]   ... and ${result.diagnostics.length - 5} more diagnostics`);
          }
        }
        return result; // Still return result even if not fully successful
      }

      if (this.options.verbose) {
        console.log(`[Layer B] Semantic analysis successful (cached: ${result.meta.cached})`);
        console.log(`[Layer B] Analysis time: ${result.meta.analysisTimeMs}ms`);
      }

      return result;
    } catch (error) {
      // Semantic analysis failed - continue with Layer A only
      console.error('[Layer B] Semantic analysis error:', error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack && this.options.verbose) {
        console.error('[Layer B] Stack trace:', error.stack);
      }
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
