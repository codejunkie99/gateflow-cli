/**
 * KnowledgeStore Types and Constants
 * 
 * Type definitions, interfaces, and constants for the KnowledgeStore system.
 */

import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeItem {
    id: string;
    fingerprint: string;
    type: KnowledgeType;
    title: string;
    content: string;
    tags: string[];
    keywords: string[];
    /**
     * Optional LLM-derived tags for semantic matching.
     */
    aiTags?: string[];
    /**
     * Optional LLM-derived summary for display or future ranking.
     */
    aiSummary?: string;
    /**
     * Timestamp of last AI enrichment.
     */
    aiEnrichedAt?: number;
    scope: KnowledgeScope;
    source: KnowledgeSource;
    confidence: number;
    useCount: number;
    lastAccessed: number;
    created: number;
    updated: number;
}

export type KnowledgeType =
    | 'code_pattern'
    | 'lint_fix'
    | 'test_pattern'
    | 'module_info'
    | 'dependency'
    | 'style_preference'
    | 'workflow'
    | 'debug_solution'
    | 'tool_usage'
    | 'project_context';

export interface KnowledgeScope {
    global: boolean;
    projectIds?: string[];
    filePatterns?: string[];
    modules?: string[];
    /**
     * Hash of defines + include paths for the compilation context.
     * Used to prevent mixing knowledge across incompatible build contexts.
     */
    defineContextId?: string;

    /**
     * Hash of ordered file list (only for MFCU toolchains).
     * Used to distinguish compile-order-sensitive contexts.
     */
    compileOrderId?: string;
}

export interface KnowledgeSource {
    method: 'extracted' | 'inferred' | 'user_provided' | 'tool_result';
    sessionId?: string;
    filePath?: string;
    tool?: string;
}

export interface KnowledgeSearchResult {
    item: KnowledgeItem;
    relevance: number;
    matchReason: string;
}

export interface KnowledgeQuery {
    query?: string;
    types?: KnowledgeType[];
    tags?: string[];
    filePath?: string;
    moduleName?: string;
    maxResults?: number;
    minConfidence?: number;
    /**
     * Restrict search to a specific define context.
     */
    defineContextId?: string;

    /**
     * Optional compile order context (MFCU only).
     */
    compileOrderId?: string;

    /**
     * If true, include items with scope mismatches but apply score penalty.
     * This allows broader searches while still preferring exact matches.
     *
     * Default: false (strict scope matching)
     */
    relaxedScope?: boolean;
}

export interface KnowledgeStoreConfig {
    knowledgeDir: string;
    maxItems: number;
    minExtractionConfidence: number;
    maxUnusedAge: number;
    /**
     * Maximum number of active define contexts to retain.
     */
    maxActiveContexts: number;

    /**
     * Maximum age (ms) before a context becomes eligible for eviction.
     */
    contextMaxAgeMs: number;

    /**
     * Minimum number of items to keep for a context to be protected from eviction.
     */
    minItemsToProtect: number;

    /**
     * Optional LLM enrichment configuration.
     */
    llm?: KnowledgeLlmConfig;
}

export interface KnowledgeLlmConfig {
    enabled: boolean;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    queryExpansion?: boolean;
    semanticTags?: boolean;
    maxConcurrent?: number;
    queryCacheSize?: number;
}

export interface KnowledgeIndex {
    version: number;
    projectId: string;
    items: KnowledgeItem[];
    stats: {
        totalItems: number;
        byType: Record<KnowledgeType, number>;
        lastUpdated: number;
    };
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_KNOWLEDGE_STORE_CONFIG: KnowledgeStoreConfig = {
    knowledgeDir: path.join(os.homedir(), '.gateflow'),
    maxItems: 500,
    minExtractionConfidence: 0.6,
    maxUnusedAge: 30 * 24 * 60 * 60 * 1000,
    maxActiveContexts: 4,
    contextMaxAgeMs: 48 * 60 * 60 * 1000,
    minItemsToProtect: 20,
    llm: {
        enabled: false,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 512,
        temperature: 0.2,
        queryExpansion: false,
        semanticTags: false,
        maxConcurrent: 2,
        queryCacheSize: 500
    }
};

// BM25 parameters
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
