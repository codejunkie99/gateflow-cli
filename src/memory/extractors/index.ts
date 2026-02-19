/**
 * Knowledge extractors for converting indexer output to KnowledgeStore items
 *
 * @module memory/extractors
 *
 * NOTE: Structural extraction (modules, dependencies, hierarchy) has been removed.
 * The KnowledgeStore now focuses on learned patterns only.
 * These exports are kept for backwards compatibility.
 *
 * @example
 * ```typescript
 * import {
 *     extractFromIndex,
 *     createExtractionOptions,
 *     formatExtractionSummary,
 *     type ExtractionResult
 * } from './memory/extractors/index.js';
 *
 * const result = await extractFromIndex(project, store, options);
 * console.log(formatExtractionSummary(result));
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry Points
// ═══════════════════════════════════════════════════════════════════════════

export {
    // Main orchestrator function (now a no-op for structural extraction)
    extractFromIndex,

    // Lightweight variant (deprecated, same as extractFromIndex)
    

    // Helper functions
    createExtractionOptions,
    formatExtractionSummary
} from './indexer-extractor.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type {
    
    
    ExtractionResult,
    
    
} from './types.js';

;
