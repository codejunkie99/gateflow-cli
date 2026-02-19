/**
 * File Result Cache Module
 *
 * Caches FileUnderstanderResult by file content hash to avoid
 * re-parsing and re-merging unchanged files.
 *
 * This is the highest-level per-file cache that stores the final
 * merged result from both Slang and Verible parsing.
 *
 * Cache strategy:
 * - Hash file content (SHA-256)
 * - Store complete FileUnderstanderResult keyed by hash
 * - Optionally persist to disk for cross-session caching
 *
 * @module cache/file-result-cache
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { FileUnderstanderResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry containing the FileUnderstanderResult.
 */
interface FileResultCacheEntry {
  /** SHA-256 hash of file content */
  contentHash: string;

  /** File path (for reference) */
  filePath: string;

  /** When this entry was created */
  timestamp: number;

  /** Tool versions used for cache invalidation */
  versions: {
    slang?: string;
    verible?: string;
    cacheFormat: number;
  };

  /** The cached result (without line offsets - too large) */
  result: Omit<FileUnderstanderResult, 'file'> & {
    file: Omit<FileUnderstanderResult['file'], 'lineOffsets'>;
  };
}

/**
 * Cache options.
 */
export interface FileResultCacheOptions {
  /** Enable disk persistence (default: true) */
  persistent?: boolean;

  /** Directory for disk cache (default: ~/.gateflow/cache/files) */
  cacheDir?: string;

  /** Maximum age in milliseconds before invalidation (default: 7 days) */
  maxAge?: number;

  /** Maximum number of entries in memory cache (default: 500) */
  maxEntries?: number;

  /** Slang version for cache invalidation */
  slangVersion?: string;

  /** Verible version for cache invalidation */
  veribleVersion?: string;
}

/**
 * Cache statistics.
 */
interface FileResultCacheStats {
  /** Number of entries in memory */
  memoryEntries: number;

  /** Number of entries on disk */
  diskEntries: number;

  /** Number of cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;

  /** Hit rate (0-1) */
  hitRate: number;

  /** Total disk size in bytes */
  diskSizeBytes: number;
}

// ============================================================================
// Constants
// ============================================================================

const CACHE_FORMAT_VERSION = 1;
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_CACHE_DIR = join(homedir(), '.gateflow', 'cache', 'files');
const CACHE_FILE_PREFIX = 'file-';
const CACHE_FILE_EXTENSION = '.json';

// ============================================================================
// FileResultCache Class
// ============================================================================

/**
 * Cache for FileUnderstanderResult.
 *
 * @example
 * ```typescript
 * const cache = new FileResultCache();
 *
 * const contentHash = cache.hashContent(fileContent);
 * let result = cache.get(contentHash);
 *
 * if (!result) {
 *   result = await understander.understand(filePath);
 *   cache.set(contentHash, filePath, result);
 * }
 * ```
 */
export class FileResultCache {
  private readonly memoryCache: Map<string, FileResultCacheEntry>;
  private readonly options: Required<FileResultCacheOptions>;
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: FileResultCacheOptions = {}) {
    this.memoryCache = new Map();
    this.options = {
      persistent: options.persistent ?? true,
      cacheDir: options.cacheDir ?? DEFAULT_CACHE_DIR,
      maxAge: options.maxAge ?? DEFAULT_MAX_AGE,
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      slangVersion: options.slangVersion ?? 'unknown',
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
   * @returns Cached result or undefined if not found/expired
   */
  get(contentHash: string): FileUnderstanderResult | undefined {
    // Try memory cache first
    const memEntry = this.memoryCache.get(contentHash);
    if (memEntry && this.isValid(memEntry)) {
      this.hits++;
      return this.reconstructResult(memEntry);
    }

    // Try disk cache if persistent
    if (this.options.persistent) {
      const diskEntry = this.loadFromDisk(contentHash);
      if (diskEntry && this.isValid(diskEntry)) {
        // Populate memory cache
        this.memoryCache.set(contentHash, diskEntry);
        this.hits++;
        return this.reconstructResult(diskEntry);
      }
    }

    this.misses++;
    return undefined;
  }

  /**
   * Store a result in the cache.
   *
   * @param contentHash - SHA-256 hash of file content
   * @param filePath - Path to the file
   * @param result - The FileUnderstanderResult to cache
   */
  set(contentHash: string, filePath: string, result: FileUnderstanderResult): void {
    // Strip line offsets to reduce storage (they can be rebuilt)
    const { lineOffsets, ...fileWithoutOffsets } = result.file;

    const entry: FileResultCacheEntry = {
      contentHash,
      filePath,
      timestamp: Date.now(),
      versions: {
        slang: this.options.slangVersion,
        verible: this.options.veribleVersion,
        cacheFormat: CACHE_FORMAT_VERSION,
      },
      result: {
        file: fileWithoutOffsets,
        declarations: result.declarations,
        references: result.references,
        instances: result.instances,
        directives: result.directives,
        errors: result.errors,
        stats: result.stats,
      },
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
   */
  has(contentHash: string): boolean {
    const memEntry = this.memoryCache.get(contentHash);
    if (memEntry && this.isValid(memEntry)) {
      return true;
    }

    if (this.options.persistent) {
      const diskEntry = this.loadFromDisk(contentHash);
      if (diskEntry && this.isValid(diskEntry)) {
        this.memoryCache.set(contentHash, diskEntry);
        return true;
      }
    }

    return false;
  }

  /**
   * Remove a specific entry from the cache.
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
  getStats(): FileResultCacheStats {
    const total = this.hits + this.misses;
    const diskStats = this.getDiskStats();

    return {
      memoryEntries: this.memoryCache.size,
      diskEntries: diskStats.count,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      diskSizeBytes: diskStats.totalSize,
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
   * Update tool versions used for cache validation.
   */
  setVersions(slangVersion?: string, veribleVersion?: string): void {
    if (slangVersion) {
      this.options.slangVersion = slangVersion;
    }
    if (veribleVersion) {
      this.options.veribleVersion = veribleVersion;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Validation
  // ---------------------------------------------------------------------------

  /**
   * Check if a cache entry is still valid.
   */
  private isValid(entry: FileResultCacheEntry): boolean {
    // Check format version
    if (entry.versions.cacheFormat !== CACHE_FORMAT_VERSION) {
      return false;
    }

    // Check age
    const age = Date.now() - entry.timestamp;
    if (age > this.options.maxAge) {
      return false;
    }

    // Check tool versions (if we know them)
    if (
      this.options.slangVersion !== 'unknown' &&
      entry.versions.slang !== 'unknown' &&
      entry.versions.slang !== this.options.slangVersion
    ) {
      return false;
    }

    if (
      this.options.veribleVersion !== 'unknown' &&
      entry.versions.verible !== 'unknown' &&
      entry.versions.verible !== this.options.veribleVersion
    ) {
      return false;
    }

    return true;
  }

  /**
   * Reconstruct full FileUnderstanderResult from cache entry.
   * Note: lineOffsets will be empty (must be rebuilt if needed)
   */
  private reconstructResult(entry: FileResultCacheEntry): FileUnderstanderResult {
    return {
      file: {
        ...entry.result.file,
        lineOffsets: [], // Must be rebuilt from file content if needed
      },
      declarations: entry.result.declarations,
      references: entry.result.references,
      instances: entry.result.instances,
      directives: entry.result.directives,
      errors: entry.result.errors,
      stats: entry.result.stats,
    };
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

  private ensureCacheDir(): void {
    if (!existsSync(this.options.cacheDir)) {
      mkdirSync(this.options.cacheDir, { recursive: true });
    }
  }

  private getCacheFilePath(hash: string): string {
    return join(this.options.cacheDir, `${CACHE_FILE_PREFIX}${hash}${CACHE_FILE_EXTENSION}`);
  }

  private loadFromDisk(hash: string): FileResultCacheEntry | undefined {
    const filePath = this.getCacheFilePath(hash);

    try {
      if (!existsSync(filePath)) {
        return undefined;
      }

      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as FileResultCacheEntry;
    } catch {
      return undefined;
    }
  }

  private saveToDisk(hash: string, entry: FileResultCacheEntry): void {
    const filePath = this.getCacheFilePath(hash);

    try {
      const content = JSON.stringify(entry);
      writeFileSync(filePath, content, 'utf-8');
    } catch {
      // Failed to write, silently continue
    }
  }

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

  private clearDiskCache(): void {
    try {
      if (!existsSync(this.options.cacheDir)) {
        return;
      }

      const files = readdirSync(this.options.cacheDir);

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

  private getDiskStats(): { count: number; totalSize: number } {
    if (!this.options.persistent || !existsSync(this.options.cacheDir)) {
      return { count: 0, totalSize: 0 };
    }

    try {
      const files = readdirSync(this.options.cacheDir);
      let count = 0;
      let totalSize = 0;

      for (const file of files) {
        if (file.startsWith(CACHE_FILE_PREFIX) && file.endsWith(CACHE_FILE_EXTENSION)) {
          count++;
          const filePath = join(this.options.cacheDir, file);
          const stats = statSync(filePath);
          totalSize += stats.size;
        }
      }

      return { count, totalSize };
    } catch {
      return { count: 0, totalSize: 0 };
    }
  }
}

// ============================================================================
// Singleton & Factory Functions
// ============================================================================

let defaultFileResultCache: FileResultCache | undefined;

/**
 * Get the default FileResultCache instance.
 */
export function getFileResultCache(): FileResultCache {
  if (!defaultFileResultCache) {
    defaultFileResultCache = new FileResultCache();
  }
  return defaultFileResultCache;
}

/**
 * Create a persistent cache instance with custom options.
 */
function createFileResultPersistentCache(
  cacheDir?: string,
  slangVersion?: string,
  veribleVersion?: string
): FileResultCache {
  return new FileResultCache({
    persistent: true,
    cacheDir: cacheDir ?? DEFAULT_CACHE_DIR,
    slangVersion,
    veribleVersion,
  });
}
