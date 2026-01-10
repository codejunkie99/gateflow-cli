/**
 * Merge Module
 *
 * Provides functionality to combine Layer A (syntactic) and Layer B (semantic)
 * parsing results into a unified index, along with a query API for IDE features.
 *
 * ## Architecture
 *
 * ```
 * Slang (primary)  ──────────┐
 *                            ├──► Index Merger ──► Merged Index ──► Query API
 * Verible (directives)  ─────┘
 * ```
 *
 * ## Usage
 *
 * @example Basic merging
 * ```typescript
 * import { mergeIndices, combineFileResults, createQueryAPI } from './merge/index.js';
 *
 * // Combine individual file results into Layer A
 * const layerA = combineFileResults(fileResults);
 *
 * // Get Layer B from slang (if available)
 * const layerB = await slangBackend.analyzeRecipe(recipe);
 *
 * // Merge
 * const merged = mergeIndices(layerA, layerB.success ? layerB : undefined);
 *
 * // Create query interface
 * const api = createQueryAPI(merged);
 *
 * // Use IDE features
 * const def = api.goToDefinition('/path/file.sv', 10, 5);
 * const refs = api.findReferences('decl:abc123');
 * const matches = api.searchSymbols('counter');
 * ```
 *
 * @module merge
 */

// ============================================================================
// Index Merger Exports
// ============================================================================

export {
  // Main function
  mergeIndices,

  // Utilities
  combineFileResults,
  buildHierarchy,
  buildDependencies,
  toResolvedProject,

  // Types
  type LayerAResult,
  type MergedIndex,
  type MergeMeta,
} from './index-merger.js';

// ============================================================================
// Query API Exports
// ============================================================================

export {
  // Class
  QueryAPI,

  // Factory
  createQueryAPI,

  // Types
  type IndexQuery,
  type DefinitionResult,
  type ReferencesResult,
  type HoverInfo,
  type SymbolMatch,
  type SearchOptions,
} from './query-api.js';
