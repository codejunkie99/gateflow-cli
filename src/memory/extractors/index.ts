/**
 * Knowledge extractors for converting indexer output to KnowledgeStore items
 *
 * @module memory/extractors
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
    // Main orchestrator function
    extractFromIndex,

    // Lightweight variant
    extractModulesOnly,

    // Helper functions
    createExtractionOptions,
    formatExtractionSummary
} from './indexer-extractor.js';

// ═══════════════════════════════════════════════════════════════════════════
// Individual Extractors (for advanced usage)
// ═══════════════════════════════════════════════════════════════════════════

export { extractModuleInfo } from './module-extractor.js';
export { extractDependencies } from './dependency-extractor.js';
export { extractHierarchy } from './hierarchy-extractor.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type {
    ExtractedCount,
    ExtractionOptions,
    ExtractionResult,
    ExtractableKnowledgeType,
    ExtractableDeclarationKind
} from './types.js';

export { validateExtractionOptions } from './types.js';
