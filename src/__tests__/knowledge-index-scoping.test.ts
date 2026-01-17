/**
 * KnowledgeIndexManager Scoping Tests
 *
 * Tests for compileOrderId scoping behavior in the knowledge index system.
 * Verifies proper filtering, penalties, and score calculations based on
 * compile order context matching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeIndexManager } from '../memory/knowledge-index.js';
import type { KnowledgeItem, KnowledgeQuery } from '../memory/knowledge-types.js';

/**
 * Helper to create a minimal KnowledgeItem for testing
 */
function createTestItem(
    id: string,
    overrides: Partial<KnowledgeItem> = {}
): KnowledgeItem {
    const now = Date.now();
    return {
        id,
        fingerprint: `fp-${id}`,
        type: 'code_pattern',
        title: `Test Item ${id}`,
        content: `Content for ${id}`,
        tags: ['test'],
        keywords: ['test', id],
        scope: { global: false },
        source: { method: 'extracted' },
        confidence: 0.8,
        useCount: 5,
        lastAccessed: now,
        created: now,
        updated: now,
        ...overrides
    };
}

describe('KnowledgeIndexManager - compileOrderId Scoping', () => {
    let indexManager: KnowledgeIndexManager;
    const projectId = 'test-project';

    beforeEach(() => {
        indexManager = new KnowledgeIndexManager(projectId);
    });

    describe('Current Behavior (Both Present)', () => {
        it('should return full score when compileOrderIds match', () => {
            const item = createTestItem('item-1', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['alpha', 'beta']
            });

            indexManager.rebuild([item]);

            const results = indexManager.search([item], {
                query: 'alpha',
                compileOrderId: 'order-abc'
            });

            expect(results).toHaveLength(1);
            expect(results[0].item.id).toBe('item-1');
            // Full score - no penalty applied for matching compileOrderId
            expect(results[0].matchReason).not.toContain('Compile order mismatch');
        });

        it('should apply 0.9 penalty when compileOrderIds mismatch', () => {
            const matchingItem = createTestItem('item-match', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search', 'term']
            });
            const mismatchItem = createTestItem('item-mismatch', {
                scope: { global: false, compileOrderId: 'order-xyz' },
                keywords: ['search', 'term']
            });

            const items = [matchingItem, mismatchItem];
            indexManager.rebuild(items);

            const results = indexManager.search(items, {
                query: 'search term',
                compileOrderId: 'order-abc'
            });

            expect(results).toHaveLength(2);

            // Find results by id
            const matchResult = results.find(r => r.item.id === 'item-match');
            const mismatchResult = results.find(r => r.item.id === 'item-mismatch');

            expect(matchResult).toBeDefined();
            expect(mismatchResult).toBeDefined();

            // Matching item should have higher relevance
            expect(matchResult!.relevance).toBeGreaterThan(mismatchResult!.relevance);

            // Mismatch should show in reason
            expect(mismatchResult!.matchReason).toContain('Compile order mismatch');
        });

        it('should apply exactly 0.9x multiplier for mismatch', () => {
            // Create two identical items except for compileOrderId
            const baseItem = createTestItem('item-base', {
                scope: { global: false },
                keywords: ['unique', 'keyword'],
                confidence: 1.0
            });

            const matchItem = createTestItem('item-match', {
                ...baseItem,
                id: 'item-match',
                fingerprint: 'fp-item-match',
                scope: { global: false, compileOrderId: 'order-abc' }
            });

            const mismatchItem = createTestItem('item-mismatch', {
                ...baseItem,
                id: 'item-mismatch',
                fingerprint: 'fp-item-mismatch',
                scope: { global: false, compileOrderId: 'order-xyz' }
            });

            const items = [matchItem, mismatchItem];
            indexManager.rebuild(items);

            const results = indexManager.search(items, {
                query: 'unique keyword',
                compileOrderId: 'order-abc'
            });

            expect(results).toHaveLength(2);

            const matchResult = results.find(r => r.item.id === 'item-match');
            const mismatchResult = results.find(r => r.item.id === 'item-mismatch');

            // Since items are identical except compileOrderId, ratio should be ~0.9
            // Allow small tolerance for floating point
            const ratio = mismatchResult!.relevance / matchResult!.relevance;
            expect(ratio).toBeCloseTo(0.9, 1);
        });
    });

    describe('Query Without compileOrderId (Strict Mode)', () => {
        it('should NOT return items with compileOrderId scope when query omits compileOrderId in strict mode', () => {
            // Strict mode (default): items with compileOrderId are filtered out
            // when query doesn't specify one
            const itemWithOrderId = createTestItem('item-with-order', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });

            indexManager.rebuild([itemWithOrderId]);

            const results = indexManager.search([itemWithOrderId], {
                query: 'search'
                // Note: no compileOrderId in query, relaxedScope defaults to false
            });

            // Strict mode: item is filtered out (not returned)
            expect(results).toHaveLength(0);
        });

        it('should only return items without compileOrderId scope when query omits compileOrderId', () => {
            // In strict mode, only items without compileOrderId scope are returned
            const itemWithOrderId = createTestItem('item-with-order', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });
            const itemWithoutOrderId = createTestItem('item-without-order', {
                scope: { global: false },
                keywords: ['search']
            });

            const items = [itemWithOrderId, itemWithoutOrderId];
            indexManager.rebuild(items);

            const results = indexManager.search(items, {
                query: 'search'
                // No compileOrderId - strict mode filters out scoped items
            });

            // Only the item without compileOrderId should be returned
            expect(results).toHaveLength(1);
            expect(results[0].item.id).toBe('item-without-order');
        });
    });

    describe('Query Without compileOrderId (Relaxed Mode)', () => {
        it('should return items with compileOrderId scope in relaxed mode with penalty', () => {
            // Relaxed mode: items with compileOrderId are returned but penalized
            const itemWithOrderId = createTestItem('item-with-order', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });

            indexManager.rebuild([itemWithOrderId]);

            const results = indexManager.search([itemWithOrderId], {
                query: 'search',
                relaxedScope: true  // Enable relaxed mode
            });

            // Relaxed mode: item IS returned (with penalty)
            expect(results).toHaveLength(1);
            expect(results[0].item.id).toBe('item-with-order');
        });

        it('should apply 0.5 penalty when query omits compileOrderId in relaxed mode', () => {
            // Relaxed mode: items with compileOrderId get 0.5 penalty
            const itemWithOrderId = createTestItem('item-with-order', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });
            const itemWithoutOrderId = createTestItem('item-without-order', {
                scope: { global: false },
                keywords: ['search']
            });

            const items = [itemWithOrderId, itemWithoutOrderId];
            indexManager.rebuild(items);

            const results = indexManager.search(items, {
                query: 'search',
                relaxedScope: true  // Enable relaxed mode
            });

            expect(results).toHaveLength(2);

            const withOrderResult = results.find(r => r.item.id === 'item-with-order');
            const withoutOrderResult = results.find(r => r.item.id === 'item-without-order');

            expect(withOrderResult).toBeDefined();
            expect(withoutOrderResult).toBeDefined();

            // Item with compileOrderId should have ~0.5x score of item without
            const ratio = withOrderResult!.relevance / withoutOrderResult!.relevance;
            expect(ratio).toBeCloseTo(0.5, 1);
        });
    });

    describe('Item Without compileOrderId', () => {
        it('should return items without compileOrderId when query has compileOrderId', () => {
            const itemWithoutOrderId = createTestItem('item-no-order', {
                scope: { global: false },
                keywords: ['search']
            });

            indexManager.rebuild([itemWithoutOrderId]);

            const results = indexManager.search([itemWithoutOrderId], {
                query: 'search',
                compileOrderId: 'order-abc'
            });

            // Items without compileOrderId should still be returned
            expect(results).toHaveLength(1);
            expect(results[0].item.id).toBe('item-no-order');
        });

        it('should not penalize items without compileOrderId', () => {
            const itemWithMatchingOrder = createTestItem('item-match', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });
            const itemWithoutOrder = createTestItem('item-no-order', {
                scope: { global: false },
                keywords: ['search']
            });

            const items = [itemWithMatchingOrder, itemWithoutOrder];
            indexManager.rebuild(items);

            const results = indexManager.search(items, {
                query: 'search',
                compileOrderId: 'order-abc'
            });

            expect(results).toHaveLength(2);

            const matchResult = results.find(r => r.item.id === 'item-match');
            const noOrderResult = results.find(r => r.item.id === 'item-no-order');

            // Neither should be penalized - both should have similar scores
            const ratio = noOrderResult!.relevance / matchResult!.relevance;
            expect(ratio).toBeCloseTo(1.0, 1);
        });
    });

    describe('Global Scope Behavior', () => {
        it('should return global items regardless of compileOrderId query', () => {
            const globalItem = createTestItem('global-item', {
                scope: { global: true, compileOrderId: 'order-abc' },
                keywords: ['search']
            });

            indexManager.rebuild([globalItem]);

            const results = indexManager.search([globalItem], {
                query: 'search',
                compileOrderId: 'order-xyz' // Different compileOrderId
            });

            // Global items should always be returned
            expect(results).toHaveLength(1);
            expect(results[0].item.id).toBe('global-item');
        });

        it('should give full score to global items even with mismatching compileOrderId', () => {
            const globalItem = createTestItem('global-item', {
                scope: { global: true, compileOrderId: 'order-abc' },
                keywords: ['search']
            });
            const localItem = createTestItem('local-item', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });

            const items = [globalItem, localItem];
            indexManager.rebuild(items);

            const results = indexManager.search(items, {
                query: 'search',
                compileOrderId: 'order-abc'
            });

            expect(results).toHaveLength(2);

            const globalResult = results.find(r => r.item.id === 'global-item');
            const localResult = results.find(r => r.item.id === 'local-item');

            // Both should have full scores since both match
            const ratio = globalResult!.relevance / localResult!.relevance;
            expect(ratio).toBeCloseTo(1.0, 1);
        });
    });

    describe('Combined with defineContextId', () => {
        it('should handle both defineContextId and compileOrderId matching', () => {
            const item = createTestItem('item-both', {
                scope: {
                    global: false,
                    defineContextId: 'def-ctx-1',
                    compileOrderId: 'order-abc'
                },
                keywords: ['search']
            });

            indexManager.rebuild([item]);

            const results = indexManager.search([item], {
                query: 'search',
                defineContextId: 'def-ctx-1',
                compileOrderId: 'order-abc'
            });

            expect(results).toHaveLength(1);
            expect(results[0].item.id).toBe('item-both');
        });

        it('should apply compileOrderId penalty even when defineContextId matches', () => {
            const item = createTestItem('item-both', {
                scope: {
                    global: false,
                    defineContextId: 'def-ctx-1',
                    compileOrderId: 'order-abc'
                },
                keywords: ['search']
            });

            indexManager.rebuild([item]);

            const matchingResults = indexManager.search([item], {
                query: 'search',
                defineContextId: 'def-ctx-1',
                compileOrderId: 'order-abc'
            });

            const mismatchResults = indexManager.search([item], {
                query: 'search',
                defineContextId: 'def-ctx-1',
                compileOrderId: 'order-xyz' // Different
            });

            expect(matchingResults).toHaveLength(1);
            expect(mismatchResults).toHaveLength(1);

            // Mismatching compileOrderId should have lower relevance
            expect(mismatchResults[0].relevance).toBeLessThan(matchingResults[0].relevance);
        });

        it('should filter by defineContextId in strict mode (not compileOrderId)', () => {
            const item = createTestItem('item-scoped', {
                scope: {
                    global: false,
                    defineContextId: 'def-ctx-1',
                    compileOrderId: 'order-abc'
                },
                keywords: ['search']
            });

            indexManager.rebuild([item]);

            // Strict mode query without matching defineContextId
            const results = indexManager.search([item], {
                query: 'search',
                defineContextId: 'def-ctx-2', // Different
                compileOrderId: 'order-abc',
                relaxedScope: false
            });

            // Should be filtered out due to defineContextId mismatch in strict mode
            expect(results).toHaveLength(0);
        });

        it('should apply relaxed penalty for defineContextId mismatch with compileOrderId match', () => {
            const item = createTestItem('item-scoped', {
                type: 'style_preference', // High portability (0.95)
                scope: {
                    global: false,
                    defineContextId: 'def-ctx-1',
                    compileOrderId: 'order-abc'
                },
                keywords: ['search']
            });

            indexManager.rebuild([item]);

            const results = indexManager.search([item], {
                query: 'search',
                defineContextId: 'def-ctx-2', // Different
                compileOrderId: 'order-abc', // Matching
                relaxedScope: true
            });

            expect(results).toHaveLength(1);
            // Should still be returned in relaxed mode, but with penalty
            expect(results[0].matchReason).toContain('Define context mismatch');
        });
    });

    describe('Match Reason Reporting', () => {
        it('should include compile order mismatch in match reason', () => {
            const item = createTestItem('item-1', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });

            indexManager.rebuild([item]);

            const results = indexManager.search([item], {
                query: 'search',
                compileOrderId: 'order-xyz' // Mismatching
            });

            expect(results).toHaveLength(1);
            expect(results[0].matchReason).toContain('Compile order mismatch');
        });

        it('should include scope penalty in match reason for mismatch', () => {
            const item = createTestItem('item-1', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });

            indexManager.rebuild([item]);

            const results = indexManager.search([item], {
                query: 'search',
                compileOrderId: 'order-xyz'
            });

            expect(results).toHaveLength(1);
            // Should show 10% penalty
            expect(results[0].matchReason).toContain('Scope penalty');
        });

        it('should not show penalty in match reason when compileOrderIds match', () => {
            const item = createTestItem('item-1', {
                scope: { global: false, compileOrderId: 'order-abc' },
                keywords: ['search']
            });

            indexManager.rebuild([item]);

            const results = indexManager.search([item], {
                query: 'search',
                compileOrderId: 'order-abc'
            });

            expect(results).toHaveLength(1);
            expect(results[0].matchReason).not.toContain('Compile order mismatch');
            expect(results[0].matchReason).not.toContain('Scope penalty');
        });
    });

    describe('Ranking with Multiple Items', () => {
        it('should rank matching compileOrderId higher than mismatching', () => {
            const matchingItem = createTestItem('item-match', {
                scope: { global: false, compileOrderId: 'order-target' },
                keywords: ['shared', 'keyword']
            });
            const mismatchItem1 = createTestItem('item-mismatch-1', {
                scope: { global: false, compileOrderId: 'order-other-1' },
                keywords: ['shared', 'keyword']
            });
            const mismatchItem2 = createTestItem('item-mismatch-2', {
                scope: { global: false, compileOrderId: 'order-other-2' },
                keywords: ['shared', 'keyword']
            });
            const noOrderItem = createTestItem('item-no-order', {
                scope: { global: false },
                keywords: ['shared', 'keyword']
            });

            const items = [mismatchItem1, matchingItem, noOrderItem, mismatchItem2];
            indexManager.rebuild(items);

            const results = indexManager.search(items, {
                query: 'shared keyword',
                compileOrderId: 'order-target'
            });

            expect(results).toHaveLength(4);

            // Matching and no-order items should rank higher than mismatching
            const matchIdx = results.findIndex(r => r.item.id === 'item-match');
            const noOrderIdx = results.findIndex(r => r.item.id === 'item-no-order');
            const mismatch1Idx = results.findIndex(r => r.item.id === 'item-mismatch-1');
            const mismatch2Idx = results.findIndex(r => r.item.id === 'item-mismatch-2');

            // Both matching and no-order should come before mismatches
            expect(matchIdx).toBeLessThan(mismatch1Idx);
            expect(matchIdx).toBeLessThan(mismatch2Idx);
            expect(noOrderIdx).toBeLessThan(mismatch1Idx);
            expect(noOrderIdx).toBeLessThan(mismatch2Idx);
        });
    });
});
