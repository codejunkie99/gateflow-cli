/**
 * Types for knowledge extraction from indexer output
 * @module memory/extractors/types
 *
 * NOTE: Structural extraction has been removed. The ExtractedCount interface
 * is now empty but kept for API compatibility.
 */

/**
 * Statistics returned after extraction completes
 *
 * NOTE: Structural counts (modules, interfaces, packages, dependencies, hierarchy)
 * have been removed since structural extraction is no longer supported.
 * The KnowledgeStore now focuses on learned patterns only.
 */
export interface ExtractedCount {
    // Empty - structural extraction has been removed
}

/**
 * Options controlling extraction behavior
 */
export interface ExtractionOptions {
    /**
     * Project identifier (12-char MD5 hash of project path)
     * Used for scoping knowledge to the current project
     */
    projectId: string;

    /**
     * Unique session identifier (UUID)
     * Used for tracking source of extracted knowledge
     */
    sessionId: string;

    /**
     * Hash of defines + include paths for the compilation context.
     */
    defineContextId?: string;

    /**
     * Hash of ordered file list (MFCU only).
     */
    compileOrderId?: string;

    /**
     * Whether to extract module/interface/package information
     * @default true
     */
    extractModules?: boolean;

    /**
     * Whether to extract file dependency relationships
     * @default true
     */
    extractDependencies?: boolean;

    /**
     * Whether to extract module hierarchy
     * @default true
     */
    extractHierarchy?: boolean;

    /**
     * Minimum confidence level for extracted items
     * Items from indexer typically have 0.9-1.0 confidence
     * @default 0.9
     */
    minConfidence?: number;

    /**
     * Maximum number of items to extract per category
     * Prevents overwhelming the knowledge store from large projects
     * @default 500
     */
    maxItemsPerCategory?: number;

    /**
     * File patterns to include (glob syntax)
     * If specified, only extracts from matching files
     * @example ['src/**\/*.sv', 'rtl/**\/*.v']
     */
    includePatterns?: string[];

    /**
     * File patterns to exclude (glob syntax)
     * @example ['**\/test\/**', '**\/tb_*']
     */
    excludePatterns?: string[];
}

/**
 * Result of a single extraction operation
 */
export interface ExtractionResult {
    /** Whether extraction completed successfully */
    success: boolean;

    /** Counts of extracted items by category */
    counts: ExtractedCount;

    /** Error message if extraction failed */
    error?: string;

    /** Duration of extraction in milliseconds */
    durationMs: number;
}

/**
 * Knowledge item types that can be extracted from indexer
 *
 * @deprecated Structural extraction has been removed. This type is kept
 * for backwards compatibility but should not be used.
 */
type ExtractableKnowledgeType = never;

/**
 * Declaration kinds that are extracted as module_info
 *
 * @deprecated Structural extraction has been removed. This type is kept
 * for backwards compatibility but should not be used.
 */
type ExtractableDeclarationKind = never;

/**
 * Validate extraction options at runtime
 */
function validateExtractionOptions(
    options: Partial<ExtractionOptions>
): ExtractionOptions {
    if (!options.projectId) {
        throw new Error('ExtractionOptions.projectId is required');
    }
    if (!options.sessionId) {
        throw new Error('ExtractionOptions.sessionId is required');
    }

    return {
        projectId: options.projectId,
        sessionId: options.sessionId,
        defineContextId: options.defineContextId,
        compileOrderId: options.compileOrderId,
        extractModules: options.extractModules ?? true,
        extractDependencies: options.extractDependencies ?? true,
        extractHierarchy: options.extractHierarchy ?? true,
        minConfidence: options.minConfidence ?? 0.9,
        maxItemsPerCategory: options.maxItemsPerCategory ?? 500,
        includePatterns: options.includePatterns,
        excludePatterns: options.excludePatterns
    };
}
