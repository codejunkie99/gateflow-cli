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
    maxUnusedAge: 30 * 24 * 60 * 60 * 1000
};

// BM25 parameters
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
