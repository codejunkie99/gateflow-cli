/**
 * Slang Cache Module
 *
 * Caches slang analysis results by recipe hash to avoid re-parsing
 * unchanged projects. This provides significant performance benefits
 * for incremental workflows.
 *
 * Cache strategy:
 * - Hash recipe (files + defines + include paths)
 * - Store parsed results keyed by hash
 * - Optionally persist to disk for cross-session caching
 *
 * @module slang/slang-cache
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';
import type { Recipe } from '../recipe/index.js';
import type { SlangMappingResult } from './slang-mapper.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry containing parsed results and metadata.
 */
export interface CacheEntry {
  /** Hash of the recipe that produced this result */
  recipeHash: string;

  /** When this entry was created */
  timestamp: number;

  /** Slang version used (for invalidation on upgrade) */
  slangVersion?: string;

  /** The cached mapping result */
  result: SlangMappingResult;
}

/**
 * Cache options.
 */
export interface CacheOptions {
  /** Enable disk persistence (default: false) */
  persistent?: boolean;

  /** Directory for disk cache (default: .sv-indexer-cache) */
  cacheDir?: string;

  /** Maximum age in milliseconds before invalidation (default: 24 hours) */
  maxAge?: number;

  /** Maximum number of entries in memory cache (default: 100) */
  maxEntries?: number;

  /** Slang version for cache invalidation */
  slangVersion?: string;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
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

const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_CACHE_DIR = '.sv-indexer-cache';
const CACHE_FILE_PREFIX = 'slang-';
const CACHE_FILE_EXTENSION = '.json';

// ============================================================================
// SlangCache Class
// ============================================================================

/**
 * Cache for slang analysis results.
 *
 * @example
 * ```typescript
 * const cache = new SlangCache({ persistent: true });
 *
 * const recipeHash = cache.hashRecipe(recipe);
 * let result = cache.get(recipeHash);
 *
 * if (!result) {
 *   result = await runSlangAndMap(recipe);
 *   cache.set(recipeHash, result);
 * }
 * ```
 */
export class SlangCache {
  private readonly memoryCache: Map<string, CacheEntry>;
  private readonly options: Required<CacheOptions>;
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: CacheOptions = {}) {
    this.memoryCache = new Map();
    this.options = {
      persistent: options.persistent ?? false,
      cacheDir: options.cacheDir ?? DEFAULT_CACHE_DIR,
      maxAge: options.maxAge ?? DEFAULT_MAX_AGE,
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      slangVersion: options.slangVersion ?? 'unknown',
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
   * Get a cached result by recipe hash.
   *
   * @param recipeHash - Hash of the recipe
   * @returns Cached result or undefined if not found/expired
   */
  get(recipeHash: string): SlangMappingResult | undefined {
    // Try memory cache first
    const memEntry = this.memoryCache.get(recipeHash);
    if (memEntry && this.isValid(memEntry)) {
      this.hits++;
      return memEntry.result;
    }

    // Try disk cache if persistent
    if (this.options.persistent) {
      const diskEntry = this.loadFromDisk(recipeHash);
      if (diskEntry && this.isValid(diskEntry)) {
        // Populate memory cache
        this.memoryCache.set(recipeHash, diskEntry);
        this.hits++;
        return diskEntry.result;
      }
    }

    this.misses++;
    return undefined;
  }

  /**
   * Store a result in the cache.
   *
   * @param recipeHash - Hash of the recipe
   * @param result - Mapping result to cache
   */
  set(recipeHash: string, result: SlangMappingResult): void {
    const entry: CacheEntry = {
      recipeHash,
      timestamp: Date.now(),
      slangVersion: this.options.slangVersion,
      result,
    };

    // Store in memory
    this.memoryCache.set(recipeHash, entry);

    // Enforce memory limit
    this.pruneMemoryCache();

    // Persist to disk if enabled
    if (this.options.persistent) {
      this.saveToDisk(recipeHash, entry);
    }
  }

  /**
   * Check if a recipe hash is in the cache (and valid).
   * Note: This does NOT increment hit/miss counters.
   *
   * @param recipeHash - Hash to check
   * @returns true if cached and valid
   */
  has(recipeHash: string): boolean {
    // Check memory cache first (without incrementing counters)
    const memEntry = this.memoryCache.get(recipeHash);
    if (memEntry && this.isValid(memEntry)) {
      return true;
    }

    // Check disk cache if persistent
    if (this.options.persistent) {
      const diskEntry = this.loadFromDisk(recipeHash);
      if (diskEntry && this.isValid(diskEntry)) {
        // Populate memory cache for future access
        this.memoryCache.set(recipeHash, diskEntry);
        return true;
      }
    }

    return false;
  }

  /**
   * Remove a specific entry from the cache.
   *
   * @param recipeHash - Hash to remove
   */
  delete(recipeHash: string): void {
    this.memoryCache.delete(recipeHash);

    if (this.options.persistent) {
      this.deleteFromDisk(recipeHash);
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
  getStats(): CacheStats {
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
   * Generate a hash for a recipe.
   *
   * The hash includes:
   * - All file paths (sorted for consistency)
   * - All defines (sorted)
   * - All include paths (sorted)
   *
   * @param recipe - Recipe to hash
   * @returns Hash string
   */
  hashRecipe(recipe: Recipe): string {
    const hashData = {
      // Sort for deterministic hashing
      files: [...recipe.files].sort(),
      defines: Object.entries(recipe.defines).sort(),
      includePaths: [...recipe.includePaths].sort(),
    };

    const hash = createHash('sha256');
    hash.update(JSON.stringify(hashData));
    return hash.digest('hex').substring(0, 32);
  }

  /**
   * Generate a hash that includes file modification times.
   *
   * This is more expensive but catches file content changes.
   * Also includes the configured Slang version to ensure cache
   * invalidation when Slang is upgraded.
   *
   * IMPORTANT: This now also tracks included files (via `include directives)
   * to ensure cache invalidation when headers change.
   *
   * @param recipe - Recipe to hash
   * @param slangVersion - Optional Slang version override (uses configured version if not provided)
   * @returns Hash string that includes mtimes and version
   */
  hashRecipeWithMtimes(recipe: Recipe, slangVersion?: string): string {
    const fileMtimes: Record<string, number> = {};

    // Track main source files
    for (const file of recipe.files) {
      try {
        const stat = statSync(file);
        fileMtimes[file] = stat.mtimeMs;
      } catch {
        // File doesn't exist or can't be accessed
        fileMtimes[file] = 0;
      }
    }

    // Track included files (resolves `include directives)
    const includedFiles = this.findIncludedFiles(recipe);
    for (const file of includedFiles) {
      if (!fileMtimes[file]) { // Don't duplicate if already tracked
        try {
          const stat = statSync(file);
          fileMtimes[file] = stat.mtimeMs;
        } catch {
          fileMtimes[file] = 0;
        }
      }
    }

    // Include Slang version in hash to ensure cache invalidation on upgrade
    const effectiveVersion = slangVersion ?? this.options.slangVersion;

    const hashData = {
      files: [...recipe.files].sort(),
      defines: Object.entries(recipe.defines).sort(),
      includePaths: [...recipe.includePaths].sort(),
      mtimes: Object.entries(fileMtimes).sort(),
      includedFiles: [...includedFiles].sort(), // Track which files were included
      slangVersion: effectiveVersion,
    };

    const hash = createHash('sha256');
    hash.update(JSON.stringify(hashData));
    return hash.digest('hex').substring(0, 32);
  }

  /**
   * Update the Slang version used for cache validation.
   *
   * Call this after detecting the actual Slang version to ensure
   * proper cache invalidation when Slang is upgraded.
   *
   * @param version - Detected Slang version
   */
  setSlangVersion(version: string): void {
    this.options.slangVersion = version;
  }

  /**
   * Get the currently configured Slang version.
   */
  getSlangVersion(): string {
    return this.options.slangVersion;
  }

  // ---------------------------------------------------------------------------
  // Private: Validation
  // ---------------------------------------------------------------------------

  /**
   * Check if a cache entry is still valid.
   */
  private isValid(entry: CacheEntry): boolean {
    // Check age
    const age = Date.now() - entry.timestamp;
    if (age > this.options.maxAge) {
      return false;
    }

    // Check slang version
    if (entry.slangVersion !== this.options.slangVersion) {
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
  // Private: Include File Detection
  // ---------------------------------------------------------------------------

  /**
   * Find all files included via `include directives in the recipe.
   *
   * This scans source files for `include statements and resolves them
   * using the recipe's include paths.
   *
   * @param recipe - Recipe to scan
   * @returns Set of absolute paths to included files
   */
  private findIncludedFiles(recipe: Recipe): Set<string> {
    const includedFiles = new Set<string>();
    const includePattern = /`include\s+"([^"]+)"/g;

    for (const sourceFile of recipe.files) {
      try {
        const content = readFileSync(sourceFile, 'utf-8');
        let match: RegExpExecArray | null;

        while ((match = includePattern.exec(content)) !== null) {
          const includePath = match[1];
          const resolvedPath = this.resolveIncludePath(includePath, sourceFile, recipe.includePaths);

          if (resolvedPath && existsSync(resolvedPath)) {
            includedFiles.add(resolvedPath);
          }
        }
      } catch {
        // Failed to read source file, skip
        continue;
      }
    }

    return includedFiles;
  }

  /**
   * Resolve an include path using recipe include directories.
   *
   * @param includePath - Path from `include directive
   * @param sourceFile - File containing the include
   * @param includePaths - Include directories to search
   * @returns Resolved absolute path or undefined
   */
  private resolveIncludePath(
    includePath: string,
    sourceFile: string,
    includePaths: string[]
  ): string | undefined {
    // Try as absolute path first
    if (isAbsolute(includePath) && existsSync(includePath)) {
      return includePath;
    }

    // Try relative to source file directory
    const sourceDir = dirname(sourceFile);
    const relativeToSource = resolve(sourceDir, includePath);
    if (existsSync(relativeToSource)) {
      return relativeToSource;
    }

    // Try each include path in order
    for (const incDir of includePaths) {
      const candidatePath = resolve(incDir, includePath);
      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    // Not found
    return undefined;
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
  private loadFromDisk(hash: string): CacheEntry | undefined {
    const filePath = this.getCacheFilePath(hash);

    try {
      if (!existsSync(filePath)) {
        return undefined;
      }

      const content = readFileSync(filePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry;
      return entry;
    } catch {
      // Corrupted cache file, ignore
      return undefined;
    }
  }

  /**
   * Save a cache entry to disk.
   */
  private saveToDisk(hash: string, entry: CacheEntry): void {
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
// Singleton Export
// ============================================================================

/**
 * Default cache instance (in-memory only).
 */
export const slangCache = new SlangCache();

/**
 * Create a persistent cache instance.
 *
 * @param cacheDir - Directory for cache files
 * @param slangVersion - Slang version for invalidation
 * @returns Persistent cache instance
 */
export function createPersistentCache(
  cacheDir: string,
  slangVersion?: string
): SlangCache {
  return new SlangCache({
    persistent: true,
    cacheDir,
    slangVersion,
  });
}
