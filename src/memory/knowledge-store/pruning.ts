/**
 * KnowledgeStore Pruning
 * @module knowledge-store/pruning
 *
 * Manages knowledge store capacity by removing low-value items.
 *
 * ## Pruning Strategies
 *
 * ### 1. Stale Item Pruning (`pruneStaleItems`)
 * Removes items that haven't been accessed within `maxUnusedAge`.
 * **Exception**: User-provided items are never pruned (they represent
 * explicit preferences that should persist indefinitely).
 *
 * ### 2. Capacity Pruning (`pruneLowestScoring`)
 * When the store reaches `maxItems`, removes the lowest 10% by score.
 *
 * ## Scoring Formula
 * ```
 * score = (confidence × 10) + (useCount × 2) - daysSinceAccess + userBonus
 * ```
 * Where `userBonus = 20` for user_provided items.
 *
 * This prioritizes:
 * - High confidence items (from reliable sources)
 * - Frequently used items
 * - Recently accessed items
 * - User-provided items (explicit preferences)
 */

import type { KnowledgeIndex, KnowledgeItem } from '../knowledge-types.js';
import type { KnowledgeIndexManager } from '../knowledge-index.js';

/**
 * Remove items that haven't been accessed within the max age.
 * User-provided items are exempt from pruning.
 *
 * @param items - Current items array
 * @param maxUnusedAge - Maximum age in milliseconds
 * @returns New items array and whether any were pruned
 */
export function pruneStaleItems(
    items: KnowledgeItem[],
    maxUnusedAge: number
): { items: KnowledgeItem[]; pruned: boolean } {
    const now = Date.now();
    const before = items.length;

    const prunedItems = items.filter(item => {
        const age = now - item.lastAccessed;
        return age < maxUnusedAge || item.source.method === 'user_provided';
    });

    return { items: prunedItems, pruned: prunedItems.length < before };
}

/**
 * Remove the lowest-scoring 10% of items to make room for new knowledge.
 * Also removes items from the search index.
 *
 * @param index - The knowledge index containing items
 * @param indexManager - The search index manager
 * @returns true if any items were pruned
 */
export function pruneLowestScoring(
    index: KnowledgeIndex,
    indexManager: KnowledgeIndexManager
): boolean {
    if (index.items.length === 0) return false;

    const now = Date.now();
    const scored = index.items.map(item => ({
        item,
        score: pruneScore(item, now)
    }));
    scored.sort((a, b) => a.score - b.score);

    const removeCount = Math.ceil(index.items.length * 0.1);
    const toRemove = new Set(scored.slice(0, removeCount).map(s => s.item.id));

    for (const id of toRemove) {
        const item = indexManager.getById(id);
        if (item) indexManager.remove(item);
    }

    index.items = index.items.filter(i => !toRemove.has(i.id));
    return toRemove.size > 0;
}

/**
 * Calculate a pruning score for an item.
 * Lower scores are pruned first.
 */
function pruneScore(item: KnowledgeItem, now: number): number {
    let score = item.confidence * 10 + item.useCount * 2;
    const daysSinceAccess = (now - item.lastAccessed) / (24 * 60 * 60 * 1000);
    score -= daysSinceAccess;
    if (item.source.method === 'user_provided') score += 20;
    return score;
}

