/**
 * knowledge-store/ - Modular KnowledgeStore Implementation
 *
 * This folder contains the refactored KnowledgeStore split into focused modules:
 *
 * @module KnowledgeStore      - Main class: lifecycle, CRUD, search delegation
 * @module factory             - Singleton management and construction
 * @module lock-manager        - Cross-process file locking with stale detection
 * @module extraction          - Knowledge extraction from lint/codegen/corrections
 * @module analysis-utils      - Diff analysis, pattern detection, normalization
 * @module pruning             - Stale item removal and capacity enforcement
 * @module store-utils         - Fingerprinting, migration, statistics
 *
 * Architecture:
 * ```
 *   KnowledgeStore (main)
 *        │
 *        ├── KnowledgeIndexManager (../knowledge-index.ts) - BM25 search
 *        ├── KnowledgeStoreLockManager (lock-manager.ts)   - File locking
 *        ├── extraction.ts                                  - Knowledge builders
 *        │       └── analysis-utils.ts                      - Pattern analysis
 *        ├── pruning.ts                                     - Capacity management
 *        └── store-utils.ts                                 - Utilities
 * ```
 */

// Main class
export { KnowledgeStore } from './KnowledgeStore.js';

// Factory/singleton
export {
    getKnowledgeStore,
    createKnowledgeStore,
    setGlobalKnowledgeStore
} from './factory.js';

// Lock management
export { KnowledgeStoreLockManager } from './lock-manager.js';

// Extraction
export {
    extractFromLintSession,
    extractFromCodeGen,
    learnFromCorrection,
    type ExtractionDependencies,
    type KnowledgeAddInput
} from './extraction.js';

// Analysis utilities
export {
    normalizeErrorMessage,
    extractKeywordsFromError,
    inferFilePatterns,
    findCommonPrefix,
    analyzeDiff,
    detectNamingStyle,
    analyzeGeneratedCode,
    detectCorrectionType,
    toGlobPattern
} from './analysis-utils.js';

// Pruning
export { pruneStaleItems, pruneLowestScoring } from './pruning.js';

// Store utilities
export {
    arraysEqual,
    computeFingerprint,
    createDefaultIndex,
    migrateIndex,
    updateStats
} from './store-utils.js';
