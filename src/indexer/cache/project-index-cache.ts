/**
 * Project Index Cache Module
 *
 * Master cache for the complete project index. This is the highest-level
 * cache that stores the fully resolved project state, enabling fast
 * startup times (1-3 seconds vs 20-60 seconds).
 *
 * Cache strategy:
 * - Key by project path + file mtimes hash
 * - Store complete ResolvedProject (minus large arrays that can rebuild)
 * - Quick invalidation check via file mtime comparison
 * - Coordinates with file-level caches for incremental updates
 *
 * @module cache/project-index-cache
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ResolvedProject, Declaration, Reference, Instance, Directive, HierarchyNode, FileDependency, SemanticIndex, FileRecord } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal file metadata for quick invalidation checks.
 */
export interface FileMetadata {
  path: string;
  hash: string;
  lastModified: number;
  size: number;
}

/**
 * Cache entry for the project index.
 */
export interface ProjectIndexCacheEntry {
  /** When this entry was created */
  timestamp: number;

  /** Cache format version for invalidation */
  cacheVersion: number;

  /** Tool versions used */
  versions: {
    slang?: string;
    verible?: string;
  };

  /** Project root path */
  projectPath: string;

  /** Recipe ID (if from filelist) */
  recipeId?: string;

  /** File metadata for quick invalidation */
  files: FileMetadata[];

  /** Combined hash of all file mtimes (for quick comparison) */
  filesHash: string;

  /** The cached resolved project (serializable subset) */
  project: SerializedResolvedProject;
}

/**
 * Serializable version of ResolvedProject (without functions, circular refs).
 */
export interface SerializedResolvedProject {
  /** File records (without lineOffsets) */
  files: Omit<FileRecord, 'lineOffsets'>[];

  /** All declarations */
  declarations: Declaration[];

  /** All references (with resolved IDs where possible) */
  references: Reference[];

  /** All instances */
  instances: Instance[];

  /** All directives */
  directives: Directive[];

  /** Module hierarchy */
  hierarchy: HierarchyNode[];

  /** File dependencies */
  dependencies: FileDependency[];

  /** Whether semantic analysis was used */
  hasSemanticAnalysis: boolean;

  /** Semantic index metadata (if available) */
  semanticStats?: {
    source: 'slang' | 'verible';
    analysisTimeMs: number;
    resolvedCount: number;
    unresolvedCount: number;
  };
}

/**
 * Result from invalidation check.
 */
export interface InvalidationResult {
  /** Whether any invalidation occurred */
  isValid: boolean;

  /** Files that changed */
  changedFiles: string[];

  /** Files that were deleted */
  deletedFiles: string[];

  /** Files that are new */
  newFiles: string[];

  /** Whether tool versions changed */
  versionMismatch: boolean;

  /** Reason for invalidation (if any) */
  reason?: string;
}

/**
 * Cache options.
 */
export interface ProjectIndexCacheOptions {
  /** Enable disk persistence (default: true) */
  persistent?: boolean;

  /** Directory for disk cache (default: ~/.gateflow/cache/projects) */
  cacheDir?: string;

  /** Maximum age in milliseconds before invalidation (default: 7 days) */
  maxAge?: number;

  /** Slang version for cache invalidation */
  slangVersion?: string;

  /** Verible version for cache invalidation */
  veribleVersion?: string;
}

/**
 * Cache statistics.
 */
export interface ProjectIndexCacheStats {
  /** Number of cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;

  /** Hit rate (0-1) */
  hitRate: number;

  /** Last invalidation reason */
  lastInvalidationReason?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CACHE_FORMAT_VERSION = 1;
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_CACHE_DIR = join(homedir(), '.gateflow', 'cache', 'projects');

// ============================================================================
// ProjectIndexCache Class
// ============================================================================

/**
 * Cache for the complete project index.
 *
 * @example
 * ```typescript
 * const cache = new ProjectIndexCache();
 *
 * // Check cache first
 * const cached = await cache.get(projectPath, filePaths);
 * if (cached) {
 *   return cached; // Cache hit!
 * }
 *
 * // Cache miss - do full indexing
 * const project = await indexer.indexProject(filelistPath);
 *
 * // Store in cache
 * await cache.set(projectPath, filePaths, project);
 * ```
 */
export class ProjectIndexCache {
  private readonly options: Required<ProjectIndexCacheOptions>;
  private hits: number = 0;
  private misses: number = 0;
  private lastInvalidationReason?: string;
  private memoryCache: Map<string, ProjectIndexCacheEntry> = new Map();

  constructor(options: ProjectIndexCacheOptions = {}) {
    this.options = {
      persistent: options.persistent ?? true,
      cacheDir: options.cacheDir ?? DEFAULT_CACHE_DIR,
      maxAge: options.maxAge ?? DEFAULT_MAX_AGE,
      slangVersion: options.slangVersion ?? 'unknown',
      veribleVersion: options.veribleVersion ?? 'unknown',
    };

    if (this.options.persistent) {
      this.ensureCacheDir();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get a cached project index.
   *
   * @param projectPath - Root path of the project
   * @param currentFiles - Current list of files (for invalidation check)
   * @returns Cached project or undefined if not found/invalid
   */
  async get(
    projectPath: string,
    currentFiles: string[]
  ): Promise<ResolvedProject | undefined> {
    const projectId = this.getProjectId(projectPath);

    // Try memory cache first
    let entry = this.memoryCache.get(projectId);

    // Try disk cache
    if (!entry && this.options.persistent) {
      entry = this.loadFromDisk(projectId);
      if (entry) {
        this.memoryCache.set(projectId, entry);
      }
    }

    if (!entry) {
      this.misses++;
      this.lastInvalidationReason = 'not_found';
      return undefined;
    }

    // Validate entry
    const validation = await this.validateEntry(entry, currentFiles);
    if (!validation.isValid) {
      this.misses++;
      this.lastInvalidationReason = validation.reason;
      return undefined;
    }

    this.hits++;
    return this.deserializeProject(entry.project);
  }

  /**
   * Store a project index in the cache.
   *
   * @param projectPath - Root path of the project
   * @param files - List of files in the project
   * @param project - The resolved project to cache
   * @param recipeId - Optional recipe ID (if from filelist)
   */
  async set(
    projectPath: string,
    files: string[],
    project: ResolvedProject,
    recipeId?: string
  ): Promise<void> {
    const projectId = this.getProjectId(projectPath);

    // Build file metadata
    const fileMetadata = await this.buildFileMetadata(files);
    const filesHash = this.hashFileMetadata(fileMetadata);

    const entry: ProjectIndexCacheEntry = {
      timestamp: Date.now(),
      cacheVersion: CACHE_FORMAT_VERSION,
      versions: {
        slang: this.options.slangVersion,
        verible: this.options.veribleVersion,
      },
      projectPath,
      recipeId,
      files: fileMetadata,
      filesHash,
      project: this.serializeProject(project),
    };

    // Store in memory
    this.memoryCache.set(projectId, entry);

    // Persist to disk
    if (this.options.persistent) {
      this.saveToDisk(projectId, entry);
    }
  }

  /**
   * Check if a project has a valid cache.
   *
   * @param projectPath - Root path of the project
   * @param currentFiles - Current list of files
   * @returns Validation result with details
   */
  async check(
    projectPath: string,
    currentFiles: string[]
  ): Promise<InvalidationResult> {
    const projectId = this.getProjectId(projectPath);
    let entry = this.memoryCache.get(projectId);

    if (!entry && this.options.persistent) {
      entry = this.loadFromDisk(projectId);
    }

    if (!entry) {
      return {
        isValid: false,
        changedFiles: [],
        deletedFiles: [],
        newFiles: currentFiles,
        versionMismatch: false,
        reason: 'not_found',
      };
    }

    return this.validateEntry(entry, currentFiles);
  }

  /**
   * Invalidate a project cache.
   *
   * @param projectPath - Root path of the project
   */
  invalidate(projectPath: string): void {
    const projectId = this.getProjectId(projectPath);
    this.memoryCache.delete(projectId);

    if (this.options.persistent) {
      this.deleteFromDisk(projectId);
    }
  }

  /**
   * Clear all caches.
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
  getStats(): ProjectIndexCacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      lastInvalidationReason: this.lastInvalidationReason,
    };
  }

  /**
   * Update tool versions.
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
   * Validate a cache entry against current state.
   */
  private async validateEntry(
    entry: ProjectIndexCacheEntry,
    currentFiles: string[]
  ): Promise<InvalidationResult> {
    // Check cache format version
    if (entry.cacheVersion !== CACHE_FORMAT_VERSION) {
      return {
        isValid: false,
        changedFiles: [],
        deletedFiles: [],
        newFiles: [],
        versionMismatch: true,
        reason: 'cache_format_changed',
      };
    }

    // Check age
    const age = Date.now() - entry.timestamp;
    if (age > this.options.maxAge) {
      return {
        isValid: false,
        changedFiles: [],
        deletedFiles: [],
        newFiles: [],
        versionMismatch: false,
        reason: 'cache_expired',
      };
    }

    // Check tool versions
    if (
      (this.options.slangVersion !== 'unknown' &&
        entry.versions.slang !== 'unknown' &&
        entry.versions.slang !== this.options.slangVersion) ||
      (this.options.veribleVersion !== 'unknown' &&
        entry.versions.verible !== 'unknown' &&
        entry.versions.verible !== this.options.veribleVersion)
    ) {
      return {
        isValid: false,
        changedFiles: [],
        deletedFiles: [],
        newFiles: [],
        versionMismatch: true,
        reason: 'tool_version_changed',
      };
    }

    // Quick check: compare file lists
    const cachedPaths = new Set(entry.files.map((f) => f.path));
    const currentPaths = new Set(currentFiles);

    const deletedFiles = entry.files
      .filter((f) => !currentPaths.has(f.path))
      .map((f) => f.path);

    const newFiles = currentFiles.filter((f) => !cachedPaths.has(f));

    if (deletedFiles.length > 0 || newFiles.length > 0) {
      return {
        isValid: false,
        changedFiles: [],
        deletedFiles,
        newFiles,
        versionMismatch: false,
        reason: 'file_list_changed',
      };
    }

    // Check file mtimes (fast check)
    const changedFiles: string[] = [];
    for (const cachedFile of entry.files) {
      try {
        const stats = statSync(cachedFile.path);
        if (stats.mtimeMs !== cachedFile.lastModified) {
          changedFiles.push(cachedFile.path);
        }
      } catch {
        // File no longer accessible
        changedFiles.push(cachedFile.path);
      }
    }

    if (changedFiles.length > 0) {
      return {
        isValid: false,
        changedFiles,
        deletedFiles: [],
        newFiles: [],
        versionMismatch: false,
        reason: 'files_modified',
      };
    }

    return {
      isValid: true,
      changedFiles: [],
      deletedFiles: [],
      newFiles: [],
      versionMismatch: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize a ResolvedProject for storage.
   */
  private serializeProject(project: ResolvedProject): SerializedResolvedProject {
    return {
      files: project.files.map(({ lineOffsets, ...rest }) => rest),
      declarations: project.declarations,
      references: project.references,
      instances: project.instances,
      directives: project.directives,
      hierarchy: project.hierarchy,
      dependencies: project.dependencies,
      hasSemanticAnalysis: project.hasSemanticAnalysis,
      semanticStats: project.semantic
        ? {
            source: project.semantic.source,
            analysisTimeMs: project.semantic.stats.analysisTimeMs,
            resolvedCount: project.semantic.stats.resolvedCount,
            unresolvedCount: project.semantic.stats.unresolvedCount,
          }
        : undefined,
    };
  }

  /**
   * Deserialize a project from cache.
   */
  private deserializeProject(serialized: SerializedResolvedProject): ResolvedProject {
    return {
      files: serialized.files.map((f) => ({
        ...f,
        lineOffsets: [], // Must be rebuilt from file content if needed
      })),
      declarations: serialized.declarations,
      references: serialized.references,
      instances: serialized.instances,
      directives: serialized.directives,
      hierarchy: serialized.hierarchy,
      dependencies: serialized.dependencies,
      hasSemanticAnalysis: serialized.hasSemanticAnalysis,
      semantic: serialized.semanticStats
        ? {
            declarations: [], // Not stored - use project.declarations
            references: [],
            instances: [],
            source: serialized.semanticStats.source,
            stats: {
              analysisTimeMs: serialized.semanticStats.analysisTimeMs,
              resolvedCount: serialized.semanticStats.resolvedCount,
              unresolvedCount: serialized.semanticStats.unresolvedCount,
            },
          }
        : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: File Metadata
  // ---------------------------------------------------------------------------

  /**
   * Build file metadata for cache entry.
   */
  private async buildFileMetadata(files: string[]): Promise<FileMetadata[]> {
    const metadata: FileMetadata[] = [];

    for (const filePath of files) {
      try {
        const stats = statSync(filePath);
        const content = readFileSync(filePath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex').substring(0, 16);

        metadata.push({
          path: filePath,
          hash,
          lastModified: stats.mtimeMs,
          size: stats.size,
        });
      } catch {
        // File not accessible, skip
      }
    }

    return metadata;
  }

  /**
   * Create a hash from file metadata for quick comparison.
   */
  private hashFileMetadata(metadata: FileMetadata[]): string {
    const sorted = [...metadata].sort((a, b) => a.path.localeCompare(b.path));
    const data = sorted.map((f) => `${f.path}:${f.lastModified}:${f.size}`).join('|');
    return createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  // ---------------------------------------------------------------------------
  // Private: Hashing
  // ---------------------------------------------------------------------------

  /**
   * Generate a project ID from the project path.
   */
  private getProjectId(projectPath: string): string {
    return createHash('md5').update(projectPath).digest('hex').substring(0, 12);
  }

  // ---------------------------------------------------------------------------
  // Private: Disk Persistence
  // ---------------------------------------------------------------------------

  private ensureCacheDir(): void {
    if (!existsSync(this.options.cacheDir)) {
      mkdirSync(this.options.cacheDir, { recursive: true });
    }
  }

  private getCacheFilePath(projectId: string): string {
    return join(this.options.cacheDir, `${projectId}.json`);
  }

  private loadFromDisk(projectId: string): ProjectIndexCacheEntry | undefined {
    const filePath = this.getCacheFilePath(projectId);

    try {
      if (!existsSync(filePath)) {
        return undefined;
      }

      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ProjectIndexCacheEntry;
    } catch {
      return undefined;
    }
  }

  private saveToDisk(projectId: string, entry: ProjectIndexCacheEntry): void {
    const filePath = this.getCacheFilePath(projectId);

    try {
      const content = JSON.stringify(entry);
      writeFileSync(filePath, content, 'utf-8');
    } catch {
      // Failed to write, silently continue
    }
  }

  private deleteFromDisk(projectId: string): void {
    const filePath = this.getCacheFilePath(projectId);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Failed to delete, silently continue
    }
  }

  private clearDiskCache(): void {
    // Implementation: iterate cache dir and delete all .json files
    // Simplified for now - just clear memory
  }
}

// ============================================================================
// Singleton & Factory Functions
// ============================================================================

let defaultProjectIndexCache: ProjectIndexCache | undefined;

/**
 * Get the default ProjectIndexCache instance.
 */
export function getProjectIndexCache(): ProjectIndexCache {
  if (!defaultProjectIndexCache) {
    defaultProjectIndexCache = new ProjectIndexCache();
  }
  return defaultProjectIndexCache;
}

/**
 * Create a project index cache with custom options.
 */
export function createProjectIndexCache(
  options?: ProjectIndexCacheOptions
): ProjectIndexCache {
  return new ProjectIndexCache(options);
}
