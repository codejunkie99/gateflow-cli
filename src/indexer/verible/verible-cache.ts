/**
 * Verible CST Cache Module
 *
 * Caches Verible parse results by file content hash to avoid re-parsing
 * unchanged files. This provides significant performance benefits
 * for incremental workflows.
 *
 * Cache strategy:
 * - Hash file content (SHA-256)
 * - Store parsed CST and mapped results keyed by hash
 * - Optionally persist to disk for cross-session caching
 *
 * @module verible/verible-cache
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { VeribleParseResult, VeribleNode, VeribleError } from './types.js';
import type { Declaration } from '../types/declaration.js';
import type { Reference } from '../types/reference.js';
import type { Instance } from '../types/instance.js';
import type { Directive } from '../types/directive.js';
import type { ParseError } from '../types/location.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Mapped results from CST processing.
 */
export interface VeribleMappedResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  directives: Directive[];
  errors: ParseError[];
  treeWasNull?: boolean;
}

/**
 * Cache entry containing parsed CST and optional mapped results.
 */
export interface VeribleCacheEntry {
  /** SHA-256 hash of file content */
  contentHash: string;

  /** File path (for reference) */
  filePath: string;

  /** When this entry was created */
  timestamp: number;

  /** Verible version used (for invalidation on upgrade) */
  veribleVersion: string;

  /** Raw parse result from Verible */
  parseResult: {
    tree: VeribleNode | null;
    errors: VeribleError[];
  };

  /** Pre-mapped results (optional, for faster startup) */
  mapped?: VeribleMappedResult;
}

/**
 * Cache options.
 */
export interface VeribleCacheOptions {
  /** Enable disk persistence (default: true) */
  persistent?: boolean;

  /** Directory for disk cache (default: ~/.gateflow/cache/verible) */
  cacheDir?: string;

  /** Maximum age in milliseconds before invalidation (default: 7 days) */
  maxAge?: number;

  /** Maximum number of entries in memory cache (default: 200) */
  maxEntries?: number;

  /** Verible version for cache invalidation */
  veribleVersion?: string;
}

/**
 * Cache statistics.
 */
export interface VeribleCacheStats {
  /** Number of entries in memory */
  memoryEntries: number;

  /** Number of cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;

  /** Hit rate (0-1) */
  hitRate: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_CACHE_DIR = join(homedir(), '.gateflow', 'cache', 'verible');
const CACHE_FILE_PREFIX = 'verible-';
const CACHE_FILE_EXTENSION = '.json';

// ============================================================================
// VeribleCache Class
// ============================================================================

/**
 * Cache for Verible parse results.
 *
 * @example
 * ```typescript
 * const cache = new VeribleCache({ persistent: true });
 *
 * const contentHash = cache.hashContent(fileContent);
 * let result = cache.get(contentHash);
 *
 * if (!result) {
 *   result = await parseWithVerible(filePath);
 *   cache.set(contentHash, filePath, result);
 * }
 * ```
 */
export class VeribleCache {
  private readonly memoryCache: Map<string, VeribleCacheEntry>;
  private readonly options: Required<VeribleCacheOptions>;
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: VeribleCacheOptions = {}) {
    this.memoryCache = new Map();
    this.options = {
      persistent: options.persistent ?? true,
      cacheDir: options.cacheDir ?? DEFAULT_CACHE_DIR,
      maxAge: options.maxAge ?? DEFAULT_MAX_AGE,
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      veribleVersion: options.veribleVersion ?? 'unknown',
    };

    // Ensure cache directory exists if persistent
    if (this.options.persistent) {
      this.ensureCacheDir();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get a cached result by content hash.
   *
   * @param contentHash - SHA-256 hash of file content
   * @returns Cached entry or undefined if not found/expired
   */
  get(contentHash: string): VeribleCacheEntry | undefined {
    // Try memory cache first
    const memEntry = this.memoryCache.get(contentHash);
    if (memEntry && this.isValid(memEntry)) {
      this.hits++;
      return memEntry;
    }

    // Try disk cache if persistent
    if (this.options.persistent) {
      const diskEntry = this.loadFromDisk(contentHash);
      if (diskEntry && this.isValid(diskEntry)) {
        // Populate memory cache
        this.memoryCache.set(contentHash, diskEntry);
        this.hits++;
        return diskEntry;
      }
    }

    this.misses++;
    return undefined;
  }

  /**
   * Store a result in the cache.
   *
   * @param contentHash - SHA-256 hash of file content
   * @param filePath - Path to the file (for reference)
   * @param parseResult - Raw parse result from Verible
   * @param mapped - Optional pre-mapped results
   */
  set(
    contentHash: string,
    filePath: string,
    parseResult: { tree: VeribleNode | null; errors: VeribleError[] },
    mapped?: VeribleMappedResult
  ): void {
    const entry: VeribleCacheEntry = {
      contentHash,
      filePath,
      timestamp: Date.now(),
      veribleVersion: this.options.veribleVersion,
      parseResult,
      mapped,
    };

    // Store in memory
    this.memoryCache.set(contentHash, entry);

    // Enforce memory limit
    this.pruneMemoryCache();

    // Persist to disk if enabled
    if (this.options.persistent) {
      this.saveToDisk(contentHash, entry);
    }
  }

  /**
   * Check if a content hash is in the cache (and valid).
   * Note: This does NOT increment hit/miss counters.
   *
   * @param contentHash - Hash to check
   * @returns true if cached and valid
   */
  has(contentHash: string): boolean {
    // Check memory cache first
    const memEntry = this.memoryCache.get(contentHash);
    if (memEntry && this.isValid(memEntry)) {
      return true;
    }

    // Check disk cache if persistent
    if (this.options.persistent) {
      const diskEntry = this.loadFromDisk(contentHash);
      if (diskEntry && this.isValid(diskEntry)) {
        // Populate memory cache for future access
        this.memoryCache.set(contentHash, diskEntry);
        return true;
      }
    }

    return false;
  }

  /**
   * Remove a specific entry from the cache.
   *
   * @param contentHash - Hash to remove
   */
  delete(contentHash: string): void {
    this.memoryCache.delete(contentHash);

    if (this.options.persistent) {
      this.deleteFromDisk(contentHash);
    }
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.memoryCache.clear();
    this.hits = 0;
    this.misses = 0;

    if (this.options.persistent) {
      this.clearDiskCache();
    }
  }

  /**
   * Get cache statistics.
   */
  getStats(): VeribleCacheStats {
    const total = this.hits + this.misses;
    return {
      memoryEntries: this.memoryCache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Hash Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a hash for file content.
   *
   * @param content - File content to hash
   * @returns SHA-256 hash (first 32 hex chars)
   */
  hashContent(content: string): string {
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex').substring(0, 32);
  }

  /**
   * Update the Verible version used for cache validation.
   *
   * @param version - Detected Verible version
   */
  setVeribleVersion(version: string): void {
    this.options.veribleVersion = version;
  }

  /**
   * Get the currently configured Verible version.
   */
  getVeribleVersion(): string {
    return this.options.veribleVersion;
  }

  // ---------------------------------------------------------------------------
  // Private: Validation
  // ---------------------------------------------------------------------------

  /**
   * Check if a cache entry is still valid.
   */
  private isValid(entry: VeribleCacheEntry): boolean {
    // Check age
    const age = Date.now() - entry.timestamp;
    if (age > this.options.maxAge) {
      return false;
    }

    // Check verible version
    if (entry.veribleVersion !== this.options.veribleVersion) {
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private: Memory Cache Management
  // ---------------------------------------------------------------------------

  /**
   * Remove oldest entries when cache exceeds max size.
   */
  private pruneMemoryCache(): void {
    if (this.memoryCache.size <= this.options.maxEntries) {
      return;
    }

    // Sort by timestamp, remove oldest
    const entries = Array.from(this.memoryCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, entries.length - this.options.maxEntries);
    for (const [key] of toRemove) {
      this.memoryCache.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Disk Persistence
  // ---------------------------------------------------------------------------

  /**
   * Ensure cache directory exists.
   */
  private ensureCacheDir(): void {
    if (!existsSync(this.options.cacheDir)) {
      mkdirSync(this.options.cacheDir, { recursive: true });
    }
  }

  /**
   * Get disk cache file path for a hash.
   */
  private getCacheFilePath(hash: string): string {
    return join(this.options.cacheDir, `${CACHE_FILE_PREFIX}${hash}${CACHE_FILE_EXTENSION}`);
  }

  /**
   * Load a cache entry from disk.
   */
  private loadFromDisk(hash: string): VeribleCacheEntry | undefined {
    const filePath = this.getCacheFilePath(hash);

    try {
      if (!existsSync(filePath)) {
        return undefined;
      }

      const content = readFileSync(filePath, 'utf-8');
      const entry = JSON.parse(content) as VeribleCacheEntry;
      return entry;
    } catch {
      // Corrupted cache file, ignore
      return undefined;
    }
  }

  /**
   * Save a cache entry to disk.
   */
  private saveToDisk(hash: string, entry: VeribleCacheEntry): void {
    const filePath = this.getCacheFilePath(hash);

    try {
      const content = JSON.stringify(entry, null, 2);
      writeFileSync(filePath, content, 'utf-8');
    } catch {
      // Failed to write, silently continue
    }
  }

  /**
   * Delete a cache entry from disk.
   */
  private deleteFromDisk(hash: string): void {
    const filePath = this.getCacheFilePath(hash);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Failed to delete, silently continue
    }
  }

  /**
   * Clear all disk cache entries.
   */
  private clearDiskCache(): void {
    try {
      if (!existsSync(this.options.cacheDir)) {
        return;
      }

      const files = readdirSync(this.options.cacheDir) as string[];

      for (const file of files) {
        if (file.startsWith(CACHE_FILE_PREFIX) && file.endsWith(CACHE_FILE_EXTENSION)) {
          const filePath = join(this.options.cacheDir, file);
          unlinkSync(filePath);
        }
      }
    } catch {
      // Failed to clear, silently continue
    }
  }
}

// ============================================================================
// Singleton & Factory Functions
// ============================================================================

/**
 * Default cache instance (persistent).
 */
let defaultVeribleCache: VeribleCache | undefined;

/**
 * Get the default Verible cache instance.
 *
 * @returns Default cache instance (creates on first call)
 */
export function getVeribleCache(): VeribleCache {
  if (!defaultVeribleCache) {
    defaultVeribleCache = new VeribleCache();
  }
  return defaultVeribleCache;
}

/**
 * Create a persistent cache instance with custom options.
 *
 * @param cacheDir - Directory for cache files
 * @param veribleVersion - Verible version for invalidation
 * @returns Persistent cache instance
 */
export function createVeriblePersistentCache(
  cacheDir?: string,
  veribleVersion?: string
): VeribleCache {
  return new VeribleCache({
    persistent: true,
    cacheDir: cacheDir ?? DEFAULT_CACHE_DIR,
    veribleVersion,
  });
}
