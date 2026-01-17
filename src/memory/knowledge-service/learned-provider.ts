// src/memory/knowledge-service/learned-provider.ts

import type { KnowledgeStore } from '../knowledge-store/KnowledgeStore.js';
import type {
  KnowledgeItem,
  KnowledgeType,
  KnowledgeSearchResult,
} from '../knowledge-types.js';
import type {
  UnifiedKnowledgeResult,
  UnifiedKnowledgeQuery,
  LearnedKnowledgeType,
} from './types.js';

/**
 * Learned knowledge types that belong in KnowledgeStore.
 * These are patterns, fixes, and user knowledge - NOT structural facts.
 */
export const LEARNED_TYPES: LearnedKnowledgeType[] = [
  'code_pattern',
  'lint_fix',
  'test_pattern',
  'style_preference',
  'workflow',
  'debug_solution',
  'tool_usage',
];

/**
 * LearnedKnowledgeProvider - Provides learned knowledge from KnowledgeStore.
 *
 * This provider wraps the KnowledgeStore to provide learned patterns,
 * lint fixes, style preferences, and other user knowledge in the
 * unified knowledge format.
 *
 * It explicitly filters OUT structural types (module_info, dependency,
 * project_context) which should come from the indexer instead.
 */
export class LearnedKnowledgeProvider {
  constructor(private knowledgeStore: KnowledgeStore) {}

  // ========================================================================
  // Search
  // ========================================================================

  /**
   * Search learned knowledge using BM25.
   * Filters to only include learned types (not structural).
   */
  search(query: UnifiedKnowledgeQuery): UnifiedKnowledgeResult[] {
    // Build knowledge query, filtering to learned types only
    const knowledgeTypes: LearnedKnowledgeType[] =
      query.knowledgeTypes ?? LEARNED_TYPES;

    // Ensure we only search learned types
    const filteredTypes = knowledgeTypes.filter(
      (t): t is KnowledgeType => LEARNED_TYPES.includes(t)
    );

    if (filteredTypes.length === 0) {
      // If no learned types requested, use all learned types
      filteredTypes.push(...LEARNED_TYPES);
    }

    const results = this.knowledgeStore.search({
      query: query.query,
      types: filteredTypes,
      tags: query.tags,
      filePath: query.filePath,
      moduleName: query.moduleName,
      maxResults: query.maxResults ?? 20,
      minConfidence: query.minConfidence,
      defineContextId: query.defineContextId,
      compileOrderId: query.compileOrderId,
      relaxedScope: query.relaxedScope,
    });

    return results.map((r) => this.toUnifiedResult(r));
  }

  // ========================================================================
  // CRUD Operations
  // ========================================================================

  /**
   * Add learned knowledge.
   * Validates that the type is a learned type.
   *
   * @throws Error if trying to add non-learned types
   */
  addKnowledge(
    item: Omit<
      KnowledgeItem,
      'id' | 'fingerprint' | 'created' | 'updated' | 'useCount' | 'lastAccessed'
    >
  ): KnowledgeItem {
    // Validate that this is a learned type
    if (!LEARNED_TYPES.includes(item.type)) {
      throw new Error(
        `Cannot add knowledge type '${item.type}' to KnowledgeStore. ` +
          `Valid learned types are: ${LEARNED_TYPES.join(', ')}`
      );
    }

    return this.knowledgeStore.addKnowledge(item);
  }

  /**
   * Remove learned knowledge by ID.
   */
  removeKnowledge(id: string): boolean {
    return this.knowledgeStore.removeKnowledge(id);
  }

  /**
   * Mark a knowledge item as used.
   */
  markUsed(id: string): void {
    this.knowledgeStore.markUsed(id);
  }

  /**
   * Get knowledge items by type.
   * Filters to only return learned types.
   */
  getByType(type: LearnedKnowledgeType): KnowledgeItem[] {
    if (!LEARNED_TYPES.includes(type)) {
      return [];
    }
    return this.knowledgeStore.getByType(type as KnowledgeType);
  }

  // ========================================================================
  // Conversion
  // ========================================================================

  /**
   * Convert a KnowledgeSearchResult to a UnifiedKnowledgeResult.
   */
  toUnifiedResult(result: KnowledgeSearchResult): UnifiedKnowledgeResult {
    return {
      id: result.item.id,
      title: result.item.title,
      content: result.item.content,
      relevance: result.relevance,
      matchReason: result.matchReason,
      source: 'learned',
      knowledgeItem: result.item,
    };
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Save the knowledge store.
   */
  async save(): Promise<void> {
    await this.knowledgeStore.save();
  }
}
