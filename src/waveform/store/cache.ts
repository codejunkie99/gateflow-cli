/**
 * Waveform Store Cache
 * LRU cache for signal data with size-aware eviction
 */

import type { CacheEntry, CacheStats, SignalData, TimeRange } from './types.js';

// ============================================================================
// LRU Cache
// ============================================================================

/**
 * Configuration for LRU cache
 */
interface LRUCacheConfig {
    /** Maximum cache size in bytes */
    maxSize: number;
    /** Maximum number of entries */
    maxEntries: number;
    /** Optional time-to-live in milliseconds */
    ttlMs?: number;
}

/**
 * Generic LRU (Least Recently Used) cache
 * Evicts oldest entries when size or count limits are exceeded
 */
class LRUCache<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private currentSize: number = 0;
    private hits: number = 0;
    private misses: number = 0;

    constructor(private config: LRUCacheConfig) {}

    /**
     * Get an item from cache, updating access time
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this.misses++;
            return undefined;
        }

        // Check TTL if configured
        if (this.config.ttlMs !== undefined) {
            const age = Date.now() - entry.accessTime;
            if (age > this.config.ttlMs) {
                this.delete(key);
                this.misses++;
                return undefined;
            }
        }

        // Update access time (move to "front" of LRU)
        entry.accessTime = Date.now();
        this.hits++;

        return entry.data;
    }

    /**
     * Add or update an item in cache
     */
    set(key: string, value: T, size: number): void {
        // Remove existing entry if present
        if (this.cache.has(key)) {
            this.delete(key);
        }

        // Evict entries if needed
        this.evictIfNeeded(size);

        // Add new entry
        const entry: CacheEntry<T> = {
            data: value,
            size,
            accessTime: Date.now(),
            key
        };

        this.cache.set(key, entry);
        this.currentSize += size;
    }

    /**
     * Check if key exists in cache
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // Check TTL
        if (this.config.ttlMs !== undefined) {
            const age = Date.now() - entry.accessTime;
            if (age > this.config.ttlMs) {
                this.delete(key);
                return false;
            }
        }

        return true;
    }

    /**
     * Delete an entry from cache
     */
    delete(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        this.currentSize -= entry.size;
        this.cache.delete(key);
        return true;
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.cache.clear();
        this.currentSize = 0;
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            size: this.currentSize,
            entries: this.cache.size,
            hitRate: total > 0 ? this.hits / total : 0
        };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get all keys in cache
     */
    keys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Evict entries until we have room for new entry
     */
    private evictIfNeeded(newEntrySize: number): void {
        // Check size limit
        while (this.currentSize + newEntrySize > this.config.maxSize && this.cache.size > 0) {
            this.evictOldest();
        }

        // Check entry count limit
        while (this.cache.size >= this.config.maxEntries) {
            this.evictOldest();
        }
    }

    /**
     * Evict the least recently used entry
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache) {
            if (entry.accessTime < oldestTime) {
                oldestTime = entry.accessTime;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.delete(oldestKey);
        }
    }
}

// ============================================================================
// Signal Data Cache
// ============================================================================

/**
 * Specialized cache for signal data with time-range aware caching
 */
export class SignalDataCache {
    private cache: LRUCache<SignalData>;

    constructor(config: LRUCacheConfig) {
        this.cache = new LRUCache(config);
    }

    /**
     * Generate cache key for signal data
     */
    getCacheKey(signalId: string, range?: TimeRange): string {
        if (!range) {
            return `signal:${signalId}:full`;
        }
        return `signal:${signalId}:${range.start}:${range.end}`;
    }

    /**
     * Get signal data from cache
     */
    get(signalId: string, range?: TimeRange): SignalData | undefined {
        const key = this.getCacheKey(signalId, range);
        return this.cache.get(key);
    }

    /**
     * Store signal data in cache
     */
    set(signalId: string, data: SignalData): void {
        const key = this.getCacheKey(signalId, data.isPartial ? data.timeRange : undefined);
        const size = this.estimateSize(data);
        this.cache.set(key, data, size);
    }

    /**
     * Check if signal data is cached
     */
    has(signalId: string, range?: TimeRange): boolean {
        const key = this.getCacheKey(signalId, range);
        return this.cache.has(key);
    }

    /**
     * Try to find cached data that covers the requested range
     * Returns null if no suitable cached data found
     */
    findCoveringData(signalId: string, range: TimeRange): SignalData | null {
        // First check for full data
        const fullData = this.cache.get(`signal:${signalId}:full`);
        if (fullData) {
            return fullData;
        }

        // Check for exact range match
        const exactMatch = this.cache.get(this.getCacheKey(signalId, range));
        if (exactMatch) {
            return exactMatch;
        }

        // Could implement smarter range matching here:
        // - Check for overlapping ranges
        // - Merge adjacent cached windows
        // For now, return null to force a fetch

        return null;
    }

    /**
     * Clear all cached data for a signal
     */
    clearSignal(signalId: string): void {
        const keysToRemove = this.cache.keys().filter(k => k.startsWith(`signal:${signalId}:`));
        for (const key of keysToRemove) {
            this.cache.delete(key);
        }
    }

    /**
     * Clear all cached data
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        return this.cache.getStats();
    }

    /**
     * Estimate memory size of signal data
     */
    private estimateSize(data: SignalData): number {
        // Base size for metadata
        let size = 200;

        // Each value entry: time (8 bytes as bigint) + value (varies)
        for (const v of data.values) {
            size += 8; // time
            if (typeof v.value === 'number') {
                size += 8; // number
            } else {
                size += v.value.length * 2; // string (UTF-16)
            }
        }

        return size;
    }
}

// ============================================================================
// Metadata Cache
// ============================================================================

/**
 * Simple cache for file metadata (doesn't need LRU - just stores one)
 */
class MetadataCache {
    private metadata: Map<string, { data: unknown; timestamp: number }> = new Map();
    private ttlMs: number;

    constructor(ttlMs: number = 300000) { // 5 minute default TTL
        this.ttlMs = ttlMs;
    }

    get<T>(key: string): T | undefined {
        const entry = this.metadata.get(key);
        if (!entry) return undefined;

        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.metadata.delete(key);
            return undefined;
        }

        return entry.data as T;
    }

    set<T>(key: string, data: T): void {
        this.metadata.set(key, { data, timestamp: Date.now() });
    }

    delete(key: string): boolean {
        return this.metadata.delete(key);
    }

    clear(): void {
        this.metadata.clear();
    }
}
