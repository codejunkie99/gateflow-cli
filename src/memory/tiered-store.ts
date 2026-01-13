/**
 * Tiered Knowledge Storage
 *
 * Manages knowledge items across three tiers for memory optimization:
 * - Hot tier: Recently/frequently accessed items (in memory)
 * - Warm tier: Less frequently accessed items (metadata only, load on demand)
 * - Cold tier: Rarely accessed items (archived to disk)
 *
 * This implementation is designed to be simple and robust:
 * - All items are still stored in the main JSON file for durability
 * - Tier tracking is purely for runtime memory optimization
 * - No separate files needed for warm/cold items
 */

import type { KnowledgeItem } from './KnowledgeStore.js';

// ============================================================================
// Types
// ============================================================================

export interface TieredStoreConfig {
    /** Maximum items to keep hot (default: 100) */
    hotSize: number;
    /** Access count threshold for warm tier (default: 3) */
    warmThreshold: number;
    /** Days before demotion to cold (default: 30) */
    coldAgeDays: number;
    /** Enable tier tracking (default: true) */
    enabled: boolean;
}

export interface ItemMetadata {
    /** Item ID */
    id: string;
    /** Access count in this session */
    accessCount: number;
    /** Last access timestamp */
    lastAccessed: number;
    /** Current tier */
    tier: 'hot' | 'warm' | 'cold';
    /** Estimated memory size (bytes) */
    estimatedSize: number;
}

export interface TieredStoreStats {
    /** Items in hot tier */
    hotCount: number;
    /** Items in warm tier */
    warmCount: number;
    /** Items in cold tier */
    coldCount: number;
    /** Estimated memory usage (bytes) */
    memoryUsage: number;
    /** Total access count */
    totalAccesses: number;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_TIERED_CONFIG: TieredStoreConfig = {
    hotSize: 100,
    warmThreshold: 3,
    coldAgeDays: 30,
    enabled: true
};

// Average bytes per character in JSON
const BYTES_PER_CHAR = 2;

// ============================================================================
// TieredKnowledgeStore
// ============================================================================

export class TieredKnowledgeStore {
    private config: TieredStoreConfig;

    /** Full items in hot tier */
    private hotItems = new Map<string, KnowledgeItem>();

    /** Metadata for all items (tracks tier and access patterns) */
    private metadata = new Map<string, ItemMetadata>();

    /** Reference to full item storage (for lazy loading from warm/cold) */
    private itemLookup?: (id: string) => KnowledgeItem | undefined;

    constructor(config: Partial<TieredStoreConfig> = {}) {
        this.config = { ...DEFAULT_TIERED_CONFIG, ...config };
    }

    /**
     * Initialize with items and a lookup function
     *
     * @param items All knowledge items
     * @param lookupFn Function to lookup item by ID (for lazy loading)
     */
    initialize(
        items: KnowledgeItem[],
        lookupFn: (id: string) => KnowledgeItem | undefined
    ): void {
        if (!lookupFn) {
            throw new Error('lookupFn is required for tiered store operation');
        }
        this.itemLookup = lookupFn;
        this.hotItems.clear();
        this.metadata.clear();

        if (!this.config.enabled) {
            // When disabled, put everything in hot tier
            for (const item of items) {
                this.hotItems.set(item.id, item);
                this.metadata.set(item.id, this.createMetadata(item, 'hot'));
            }
            return;
        }

        // Classify items by access patterns
        const now = Date.now();
        const coldAgeMs = this.config.coldAgeDays * 24 * 60 * 60 * 1000;

        // Sort by relevance score for initial tier assignment
        const scored = items.map(item => ({
            item,
            score: this.calculateRelevanceScore(item, now)
        }));
        scored.sort((a, b) => b.score - a.score);

        for (let i = 0; i < scored.length; i++) {
            const { item } = scored[i];
            let tier: 'hot' | 'warm' | 'cold';

            if (i < this.config.hotSize) {
                // Top items go to hot tier
                tier = 'hot';
                this.hotItems.set(item.id, item);
            } else if (now - item.lastAccessed < coldAgeMs) {
                // Recently accessed but not hot -> warm
                tier = 'warm';
            } else {
                // Old items -> cold
                tier = 'cold';
            }

            this.metadata.set(item.id, this.createMetadata(item, tier));
        }
    }

    /**
     * Get an item, promoting through tiers as needed
     *
     * @param id Item ID
     * @returns Item if found, undefined otherwise
     */
    getItem(id: string): KnowledgeItem | undefined {
        const meta = this.metadata.get(id);
        if (!meta) return undefined;

        // Record access
        meta.accessCount++;
        meta.lastAccessed = Date.now();

        // Check hot tier first
        if (this.hotItems.has(id)) {
            return this.hotItems.get(id);
        }

        // Item is in warm/cold tier - need to load it
        const item = this.itemLookup?.(id);
        if (!item) return undefined;

        // Promote based on access pattern
        // Note: We already verified item is not in hotItems, so promotion is needed
        if (meta.accessCount >= this.config.warmThreshold) {
            this.promoteToHot(id, item);
            // Sync metadata tier in case it was stale
            meta.tier = 'hot';
            // Return from hot tier to ensure consistency
            return this.hotItems.get(id) ?? item;
        } else if (meta.tier === 'cold') {
            // Promote cold to warm
            meta.tier = 'warm';
        }

        return item;
    }

    /**
     * Add a new item (starts in hot tier)
     *
     * @param item Item to add
     */
    addItem(item: KnowledgeItem): void {
        // New items always start hot with current timestamp for session tracking
        this.hotItems.set(item.id, item);
        this.metadata.set(item.id, this.createMetadata(item, 'hot', true));

        // Check if we need to demote
        if (this.hotItems.size > this.config.hotSize) {
            this.demoteColdest();
        }
    }

    /**
     * Remove an item from all tiers
     *
     * @param id Item ID
     */
    removeItem(id: string): void {
        this.hotItems.delete(id);
        this.metadata.delete(id);
    }

    /**
     * Mark an item as accessed (and promote if threshold reached)
     *
     * @param id Item ID
     */
    markAccessed(id: string): void {
        const meta = this.metadata.get(id);
        if (!meta) return;

        meta.accessCount++;
        meta.lastAccessed = Date.now();

        // Promote if threshold reached and not already hot
        if (meta.accessCount >= this.config.warmThreshold && !this.hotItems.has(id)) {
            const item = this.itemLookup?.(id);
            if (item) {
                this.promoteToHot(id, item);
                meta.tier = 'hot';
            }
        }
    }

    /**
     * Get current stats
     */
    getStats(): TieredStoreStats {
        let hotCount = 0;
        let warmCount = 0;
        let coldCount = 0;
        let memoryUsage = 0;
        let totalAccesses = 0;

        for (const meta of this.metadata.values()) {
            switch (meta.tier) {
                case 'hot':
                    hotCount++;
                    memoryUsage += meta.estimatedSize;
                    break;
                case 'warm':
                    warmCount++;
                    // Warm tier: only metadata in memory
                    memoryUsage += 100; // ~100 bytes for metadata
                    break;
                case 'cold':
                    coldCount++;
                    // Cold tier: only ID in memory
                    memoryUsage += 50;
                    break;
            }
            totalAccesses += meta.accessCount;
        }

        return {
            hotCount,
            warmCount,
            coldCount,
            memoryUsage,
            totalAccesses
        };
    }

    /**
     * Check if item is in hot tier (in memory)
     */
    isHot(id: string): boolean {
        return this.hotItems.has(id);
    }

    /**
     * Get all hot items (for fast iteration)
     */
    getHotItems(): KnowledgeItem[] {
        return Array.from(this.hotItems.values());
    }

    /**
     * Get tier for an item
     */
    getTier(id: string): 'hot' | 'warm' | 'cold' | undefined {
        return this.metadata.get(id)?.tier;
    }

    /**
     * Force rebalance of tiers
     */
    rebalance(): void {
        if (!this.config.enabled) return;

        const now = Date.now();
        const coldAgeMs = this.config.coldAgeDays * 24 * 60 * 60 * 1000;

        // Score all items
        const scored: Array<{ id: string; score: number; meta: ItemMetadata }> = [];

        for (const [id, meta] of this.metadata) {
            const item = this.hotItems.get(id);
            // Use Math.max(0, ...) to handle clock skew where lastAccessed could be in the future
            const daysSinceAccess = Math.max(0, (now - meta.lastAccessed) / (24 * 60 * 60 * 1000));
            const score = item
                ? this.calculateRelevanceScore(item, now)
                : meta.accessCount * 10 - daysSinceAccess;
            scored.push({ id, score, meta });
        }

        scored.sort((a, b) => b.score - a.score);

        // Reassign tiers
        for (let i = 0; i < scored.length; i++) {
            const { id, meta } = scored[i];

            if (i < this.config.hotSize) {
                // Should be hot
                if (meta.tier !== 'hot') {
                    // Promote to hot
                    const item = this.itemLookup?.(id);
                    if (item) {
                        this.hotItems.set(id, item);
                        meta.tier = 'hot';
                    }
                }
            } else if (now - meta.lastAccessed < coldAgeMs) {
                // Should be warm
                if (meta.tier === 'hot') {
                    this.hotItems.delete(id);
                }
                meta.tier = 'warm';
            } else {
                // Should be cold
                if (meta.tier === 'hot') {
                    this.hotItems.delete(id);
                }
                meta.tier = 'cold';
            }
        }
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private createMetadata(
        item: KnowledgeItem,
        tier: 'hot' | 'warm' | 'cold',
        useCurrentTime = false
    ): ItemMetadata {
        return {
            id: item.id,
            // Session-specific access count, starts at 0
            accessCount: 0,
            // Use item's historical lastAccessed for initialize() to preserve tier classification,
            // but use current time for addItem() to track session access patterns
            lastAccessed: useCurrentTime ? Date.now() : item.lastAccessed,
            tier,
            estimatedSize: this.estimateSize(item)
        };
    }

    private estimateSize(item: KnowledgeItem): number {
        // Rough estimate of JSON serialized size
        const jsonSize = JSON.stringify(item).length * BYTES_PER_CHAR;
        return jsonSize;
    }

    private calculateRelevanceScore(item: KnowledgeItem, now: number): number {
        let score = 0;

        // Confidence contributes
        score += item.confidence * 20;

        // Use count contributes
        score += Math.min(item.useCount * 5, 50);

        // Recency contributes (decay over time)
        // Use Math.max(0, ...) to handle clock skew where lastAccessed could be in the future
        const daysSinceAccess = Math.max(0, (now - item.lastAccessed) / (24 * 60 * 60 * 1000));
        score -= Math.min(daysSinceAccess, 30);

        // User-provided items get bonus
        if (item.source.method === 'user_provided') {
            score += 30;
        }

        return score;
    }

    private promoteToHot(id: string, item: KnowledgeItem): void {
        this.hotItems.set(id, item);
        const meta = this.metadata.get(id);
        if (meta) {
            meta.tier = 'hot';
        }

        // May need to demote something
        if (this.hotItems.size > this.config.hotSize) {
            this.demoteColdest();
        }
    }

    private demoteColdest(): void {
        // Find the least valuable hot item
        let lowestScore = Infinity;
        let lowestId: string | null = null;

        const now = Date.now();
        for (const [id, item] of this.hotItems) {
            const meta = this.metadata.get(id);
            // Consider both stored useCount and session accessCount
            const score = this.calculateRelevanceScore(item, now) + (meta?.accessCount ?? 0) * 5;

            if (score < lowestScore) {
                lowestScore = score;
                lowestId = id;
            }
        }

        if (lowestId) {
            this.hotItems.delete(lowestId);
            const meta = this.metadata.get(lowestId);
            if (meta) {
                meta.tier = 'warm';
            }
        }
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a tiered knowledge store
 */
export function createTieredStore(
    config?: Partial<TieredStoreConfig>
): TieredKnowledgeStore {
    return new TieredKnowledgeStore(config);
}
