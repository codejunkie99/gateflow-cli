/**
 * Slang Backend
 *
 * High-level API for semantic analysis using slang.
 * This is the main entry point for Layer B analysis.
 *
 * Key responsibilities:
 * - Orchestrate slang execution and result mapping
 * - Manage caching for performance
 * - Provide graceful degradation when slang unavailable
 * - Expose clean API for integration with SVIndexer
 *
 * @module slang/slang-backend
 */

import { homedir } from 'os';
import { join } from 'path';
import type { Recipe } from '../recipe/index.js';
import type { Declaration } from '../types/declaration.js';
import type { Reference } from '../types/reference.js';
import type { Instance } from '../types/instance.js';
import type { SlangDiagnostic } from './slang-types.js';
import { findSlangBinary, isSlangAvailable, getSlangVersion } from './binary-manager.js';
import { runSlangForRecipe, type SlangExecOptions } from './subprocess.js';
import {
  mapSlangAst,
  resolveReferences,
  resolveInstances,
  type SlangMappingResult,
} from './slang-mapper.js';
import { SlangCache, createPersistentCache, type CacheOptions } from './slang-cache.js';

// Default cache directory under ~/.gateflow/cache/slang/
const DEFAULT_SLANG_CACHE_DIR = join(homedir(), '.gateflow', 'cache', 'slang');

// ============================================================================
// Types
// ============================================================================

/**
 * Result from slang semantic analysis.
 */
export interface SlangBackendResult {
  /** Whether analysis succeeded */
  success: boolean;

  /** Declarations extracted from slang AST */
  declarations: Declaration[];

  /** References with resolved IDs */
  references: Reference[];

  /** Instances with resolved IDs and evaluated params */
  instances: Instance[];

  /** Diagnostics (errors, warnings) from slang */
  diagnostics: SlangDiagnostic[];

  /** Analysis metadata */
  meta: {
    /** Slang version used */
    slangVersion?: string;

    /** Whether result came from cache */
    cached: boolean;

    /** Total analysis time in milliseconds */
    analysisTimeMs: number;

    /** Time spent in slang subprocess */
    slangTimeMs?: number;

    /** Time spent mapping AST */
    mappingTimeMs?: number;
  };
}

/**
 * Options for slang backend.
 */
export interface SlangBackendOptions {
  /** Enable caching (default: true) */
  caching?: boolean;

  /** Cache options */
  cacheOptions?: CacheOptions;

  /** Top module for elaboration */
  topModule?: string;

  /** Include detailed type info */
  detailedTypes?: boolean;

  /** Timeout for slang subprocess in milliseconds */
  timeout?: number;

  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

// ============================================================================
// SlangBackend Class
// ============================================================================

/**
 * Backend for semantic analysis using slang.
 *
 * @example
 * ```typescript
 * const backend = new SlangBackend();
 *
 * // Check availability
 * if (await backend.isAvailable()) {
 *   const result = await backend.analyzeRecipe(recipe);
 *   if (result.success) {
 *     console.log(`Found ${result.declarations.length} declarations`);
 *   }
 * }
 * ```
 */
export class SlangBackend {
  private cache: SlangCache;
  private slangVersion?: string;
  private initialized: boolean = false;

  constructor(options: SlangBackendOptions = {}) {
    const caching = options.caching ?? true;

    if (!caching) {
      // Caching explicitly disabled
      this.cache = new SlangCache({ maxEntries: 0 });
    } else if (options.cacheOptions?.persistent === false) {
      // Persistent explicitly disabled, use memory-only cache
      this.cache = new SlangCache(options.cacheOptions);
    } else {
      // Default: persistent caching enabled
      // Use provided cacheDir or default to ~/.gateflow/cache/slang/
      const cacheDir = options.cacheOptions?.cacheDir || DEFAULT_SLANG_CACHE_DIR;
      this.cache = createPersistentCache(cacheDir, options.cacheOptions?.slangVersion);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check if slang is available for use.
   *
   * @returns true if slang binary is found
   */
  async isAvailable(): Promise<boolean> {
    return isSlangAvailable();
  }

  /**
   * Get slang version.
   *
   * @returns Version string or undefined
   */
  async getVersion(): Promise<string | undefined> {
    if (!this.slangVersion) {
      this.slangVersion = await getSlangVersion();
    }
    return this.slangVersion;
  }

  /**
   * Initialize the backend (find binary, detect version).
   *
   * @throws Error if slang not available
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const location = await findSlangBinary();
    this.slangVersion = location.version;
    this.initialized = true;
  }

  /**
   * Analyze a recipe using slang.
   *
   * This is the main entry point for semantic analysis.
   *
   * @param recipe - Parsed recipe/filelist
   * @param options - Analysis options
   * @returns Analysis result with declarations, references, instances
   *
   * @example
   * ```typescript
   * const result = await backend.analyzeRecipe(recipe, {
   *   topModule: 'top',
   *   detailedTypes: true,
   * });
   *
   * if (result.success) {
   *   // Use resolved declarations
   *   for (const decl of result.declarations) {
   *     console.log(`${decl.kind}: ${decl.name}`);
   *   }
   * }
   * ```
   */
  async analyzeRecipe(
    recipe: Recipe,
    options: SlangBackendOptions = {}
  ): Promise<SlangBackendResult> {
    const startTime = performance.now();

    // Ensure we have the Slang version for cache keying
    if (!this.slangVersion) {
      try {
        this.slangVersion = await getSlangVersion();
        if (this.slangVersion) {
          this.cache.setSlangVersion(this.slangVersion);
        }
      } catch {
        // Version detection failed, continue with 'unknown'
      }
    }

    // Check cache first (includes version in hash)
    const cacheHash = this.cache.hashRecipeWithMtimes(recipe, this.slangVersion);
    const cached = this.cache.get(cacheHash);

    if (cached) {
      return {
        success: true,
        declarations: cached.declarations,
        references: cached.references,
        instances: cached.instances,
        diagnostics: [],
        meta: {
          slangVersion: this.slangVersion,
          cached: true,
          analysisTimeMs: performance.now() - startTime,
        },
      };
    }

    // Run slang
    const slangStartTime = performance.now();
    const execOptions: SlangExecOptions = {
      timeout: options.timeout,
      signal: options.signal,
      topModule: options.topModule,
      detailedTypes: options.detailedTypes,
    };

    const slangResult = await runSlangForRecipe(recipe, execOptions);
    const slangTimeMs = performance.now() - slangStartTime;

    // Handle failure
    if (!slangResult.success || !slangResult.compilation) {
      return {
        success: false,
        declarations: [],
        references: [],
        instances: [],
        diagnostics: slangResult.diagnostics,
        meta: {
          slangVersion: this.slangVersion,
          cached: false,
          analysisTimeMs: performance.now() - startTime,
          slangTimeMs,
        },
      };
    }

    // Map AST to our types
    const mappingStartTime = performance.now();
    const mapped = mapSlangAst(slangResult.compilation);
    const mappingTimeMs = performance.now() - mappingStartTime;

    // Resolve references and instances
    const resolvedRefs = resolveReferences(mapped.references, mapped.declarations);
    const resolvedInsts = resolveInstances(mapped.instances, mapped.declarations);

    // Cache the result
    const cacheResult: SlangMappingResult = {
      declarations: mapped.declarations,
      references: resolvedRefs,
      instances: resolvedInsts,
      stats: mapped.stats,
    };
    this.cache.set(cacheHash, cacheResult);

    return {
      success: true,
      declarations: mapped.declarations,
      references: resolvedRefs,
      instances: resolvedInsts,
      diagnostics: slangResult.diagnostics,
      meta: {
        slangVersion: this.slangVersion,
        cached: false,
        analysisTimeMs: performance.now() - startTime,
        slangTimeMs,
        mappingTimeMs,
      },
    };
  }

  /**
   * Analyze specific files (not a full recipe).
   *
   * Useful for quick single-file analysis.
   *
   * @param files - Files to analyze
   * @param options - Analysis options
   * @returns Analysis result
   */
  async analyzeFiles(
    files: string[],
    options: SlangBackendOptions & {
      includePaths?: string[];
      defines?: Record<string, string>;
    } = {}
  ): Promise<SlangBackendResult> {
    // Create a minimal recipe
    const recipe: Recipe = {
      id: `files-${files.join('-')}`,
      sourceFile: files[0],
      files,
      includePaths: options.includePaths || [],
      defines: options.defines || {},
      nestedFilelists: [],
    };

    return this.analyzeRecipe(recipe, options);
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return this.cache.getStats();
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Default backend instance.
 */
let defaultBackend: SlangBackend | undefined;

/**
 * Get the default slang backend instance.
 *
 * Creates one on first call (lazy initialization).
 *
 * @returns Default backend instance
 */
export function getSlangBackend(): SlangBackend {
  if (!defaultBackend) {
    defaultBackend = new SlangBackend();
  }
  return defaultBackend;
}

/**
 * Quick analysis function for one-off use.
 *
 * @param recipe - Recipe to analyze
 * @param options - Analysis options
 * @returns Analysis result
 *
 * @example
 * ```typescript
 * const result = await analyzeWithSlang(recipe);
 * if (result.success) {
 *   console.log('Analysis complete!');
 * }
 * ```
 */
export async function analyzeWithSlang(
  recipe: Recipe,
  options: SlangBackendOptions = {}
): Promise<SlangBackendResult> {
  const backend = getSlangBackend();
  return backend.analyzeRecipe(recipe, options);
}

/**
 * Check if slang semantic analysis is available.
 *
 * @returns true if slang can be used
 */
export async function canUseSlang(): Promise<boolean> {
  const backend = getSlangBackend();
  return backend.isAvailable();
}

// ============================================================================
// Type Re-exports for Convenience
// ============================================================================

export type { SlangDiagnostic } from './slang-types.js';
export type { SlangMappingResult } from './slang-mapper.js';
