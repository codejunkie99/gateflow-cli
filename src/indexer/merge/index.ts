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
  
  
  toResolvedProject,

  // Types
  
  type MergedIndex,
  
} from './index-merger.js';

// ============================================================================
// Query API Exports
// ============================================================================

export {
  // Class
  

  // Factory
  

  // Types
  
  
  
  
  
  
} from './query-api.js';
