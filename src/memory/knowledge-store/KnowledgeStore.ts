/**
 * KnowledgeStore - Persistent learned patterns for context-aware retrieval
 * @module knowledge-store/KnowledgeStore
 *
 * The main class orchestrating knowledge persistence and retrieval. Delegates
 * specialized concerns to focused modules:
 *
 * - Search/indexing     → KnowledgeIndexManager (BM25 algorithm)
 * - File locking        → KnowledgeStoreLockManager
 * - Pattern extraction  → extraction.ts
 * - Capacity pruning    → pruning.ts
 *
 * ## Knowledge Types Stored
 * - Code patterns (naming conventions, module structures)
 * - Common lint fixes and error patterns
 * - User preferences in code style
 * - Module relationships and dependencies
 *
 * ## Persistence Model
 * - JSON file per project (keyed by MD5 hash of project root)
 * - Debounced auto-save (5s) to reduce disk I/O
 * - Cross-process file locking with stale lock detection
 * - Atomic writes via temp file + rename
 *
 * ## Search Algorithm
 * - BM25 (Okapi) scoring for relevance ranking
 * - Inverted index for O(k) candidate selection where k = matching docs
 * - Scope-aware scoring with penalties for out-of-scope matches
 *
 * @see ../knowledge-index.ts - BM25 implementation
 * @see ./lock-manager.ts - File locking
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import type { EventBus } from "../../events/index.js";
import { AsyncMutex } from "../../concurrency/index.js";
import { estimateTokens } from "../utils.js";
import { KnowledgeIndexManager } from "../knowledge-index.js";
import {
  DEFAULT_KNOWLEDGE_STORE_CONFIG,
  REMOVED_STRUCTURAL_TYPES,
  type KnowledgeIndex,
  type KnowledgeItem,
  type KnowledgeQuery,
  type KnowledgeSearchResult,
  type KnowledgeStoreConfig,
  type KnowledgeScope,
  type KnowledgeSource,
  type KnowledgeType,
} from "../knowledge-types.js";
import { KnowledgeStoreLockManager } from "./lock-manager.js";
import {
  arraysEqual,
  computeFingerprint,
  createDefaultIndex,
  migrateIndex,
  updateStats,
} from "./store-utils.js";
import {
  extractFromLintSession,
  extractFromCodeGen,
  learnFromCorrection,
  type ExtractionDependencies,
} from "./extraction.js";
import { pruneLowestScoring, pruneStaleItems } from "./pruning.js";
import { KnowledgeLlmService } from "../llm/knowledge-llm.js";

// ============================================================================
// KnowledgeStore
// ============================================================================

export class KnowledgeStore {
  private config: KnowledgeStoreConfig;
  private projectId: string;
  private index: KnowledgeIndex | null = null;
  private knowledgePath: string;
  private lockPath: string;
  private dirty = false;
  private revision = 0;
  private ioMutex = new AsyncMutex();
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private indexManager: KnowledgeIndexManager;
  private lockManager: KnowledgeStoreLockManager;
  private activeDefineContextId?: string;
  private activeCompileOrderId?: string;
  private contextAccess = new Map<
    string,
    { lastAccessed: number; accessCount: number }
  >();
  private llmService: KnowledgeLlmService;

  private readonly SAVE_DEBOUNCE_MS = 5000;
  private readonly LOCK_TIMEOUT_MS = 5000;

  constructor(
    private projectRoot: string,
    private bus: EventBus,
    config?: Partial<KnowledgeStoreConfig>,
  ) {
    this.projectId = crypto
      .createHash("md5")
      .update(path.resolve(projectRoot))
      .digest("hex")
      .slice(0, 12);

    this.config = { ...DEFAULT_KNOWLEDGE_STORE_CONFIG, ...config };
    this.knowledgePath = path.join(
      this.config.knowledgeDir,
      `${this.projectId}-knowledge.json`,
    );
    this.lockPath = path.join(
      this.config.knowledgeDir,
      `${this.projectId}-knowledge.lock`,
    );
    this.indexManager = new KnowledgeIndexManager(this.projectId);
    this.lockManager = new KnowledgeStoreLockManager(
      this.lockPath,
      this.LOCK_TIMEOUT_MS,
    );
    this.llmService = new KnowledgeLlmService(
      this.config.llm,
      this.applyEnrichment.bind(this),
    );
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  async load(): Promise<KnowledgeIndex> {
    return this.ioMutex.withLock(async () => {
      await fs.mkdir(this.config.knowledgeDir, { recursive: true });

      try {
        const content = await fs.readFile(this.knowledgePath, "utf-8");
        this.index = migrateIndex(
          JSON.parse(content) as KnowledgeIndex,
          this.projectId,
        );
        this.index.items = this.migrateLegacyItems(this.index.items);
        // Filter out stale structural items extracted by indexer (migration)
        const filteredResult = this.filterExtractedStructuralItems(this.index.items);
        if (filteredResult.removedCount > 0) {
          console.log(
            `KnowledgeStore: Removed ${filteredResult.removedCount} stale structural items during migration`,
          );
          this.index.items = filteredResult.items;
          this.markDirty();
        }
        this.pruneStaleItems();
        this.indexManager.rebuild(this.index.items);
        return this.index;
      } catch (error) {
        // Bug 1.3 fix: Distinguish between error types
        const errCode = (error as NodeJS.ErrnoException).code;

        // Case 1: File doesn't exist - this is fine on first run
        if (errCode === "ENOENT") {
          this.index = createDefaultIndex(this.projectId);
          this.indexManager.clear();
          return this.index;
        }

        // Case 2: Permission denied - user needs to fix this
        if (errCode === "EACCES" || errCode === "EPERM") {
          console.error(
            `KnowledgeStore: Permission denied reading ${this.knowledgePath}\n` +
              `Please check file permissions.`,
          );
          throw error;
        }

        // Case 3: I/O error - disk problem
        if (errCode === "EIO" || errCode === "EROFS") {
          console.error(
            `KnowledgeStore: I/O error reading ${this.knowledgePath}\n` +
              `Please check disk health.`,
          );
          throw error;
        }

        // Case 4: JSON parse error or schema error - file is corrupted
        console.warn(
          `KnowledgeStore: File corrupted or invalid at ${this.knowledgePath}\n` +
            `Error: ${error instanceof Error ? error.message : "Unknown error"}\n` +
            `Creating backup and starting fresh.`,
        );

        // Attempt to backup the corrupted file
        try {
          const backupPath = `${this.knowledgePath}.corrupted.${Date.now()}`;
          await fs.rename(this.knowledgePath, backupPath);
          console.warn(
            `KnowledgeStore: Corrupted file backed up to ${backupPath}`,
          );
        } catch (backupError) {
          console.warn(
            `KnowledgeStore: Could not create backup: ` +
              `${backupError instanceof Error ? backupError.message : "Unknown error"}`,
          );
        }

        // Start fresh
        this.index = createDefaultIndex(this.projectId);
        this.indexManager.clear();
        return this.index;
      }
    });
  }

  async save(): Promise<void> {
    return this.ioMutex.withLock(async () => {
      if (!this.index || !this.dirty) return;

      const saveRevision = this.revision;
      const acquired = await this.lockManager.acquire();
      if (!acquired) {
        throw new Error(`Failed to acquire lock: ${this.lockPath}`);
      }

      try {
        updateStats(this.index);
        const tempPath = `${this.knowledgePath}.${Date.now()}.tmp`;
        const payload = JSON.stringify(this.index, null, 2);
        await fs.writeFile(tempPath, payload, "utf-8");
        await fs.rename(tempPath, this.knowledgePath);
        if (this.revision === saveRevision) {
          this.dirty = false;
        }
      } finally {
        await this.lockManager.release();
      }
    });
  }

  async flush(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.dirty) {
      await this.save();
    }
  }

  async destroy(): Promise<void> {
    // Flush any pending saves before destroying
    await this.flush();
    this.contextAccess.clear();
  }

  // ========================================================================
  // Knowledge CRUD
  // ========================================================================

  addKnowledge(
    item: Omit<
      KnowledgeItem,
      "id" | "fingerprint" | "created" | "updated" | "useCount" | "lastAccessed"
    >,
  ): KnowledgeItem {
    if (!this.index) throw new Error("KnowledgeStore not loaded");

    // Validate title and confidence
    if (!item.title || item.title.trim().length === 0) {
      throw new Error("Knowledge item must have a non-empty title");
    }
    if (item.confidence < 0 || item.confidence > 1) {
      throw new Error(
        `Knowledge item confidence must be between 0 and 1, got ${item.confidence}`,
      );
    }

    this.validateScope(item.scope, item.source);
    const now = Date.now();
    const fingerprint = computeFingerprint(item.type, item.title, item.scope);

    // Check for duplicate
    const existing = this.indexManager.getByFingerprint(fingerprint);
    if (existing) {
      // Bug 1.1 fix: Check if content changed and rebuild indices
      const contentChanged =
        existing.content !== item.content ||
        !arraysEqual(existing.tags, item.tags) ||
        !arraysEqual(existing.keywords, item.keywords);

      existing.content = item.content;
      existing.confidence = Math.max(existing.confidence, item.confidence);
      // Bug 1.1 fix: When content changes, replace tags/keywords instead of merging
      // to ensure old terms are removed from indices
      if (contentChanged) {
        existing.tags = [...item.tags];
        existing.keywords = [...item.keywords];
        existing.aiTags = undefined;
        existing.aiSummary = undefined;
        existing.aiEnrichedAt = undefined;
      } else {
        // Only merge when content hasn't changed (additive updates)
        existing.tags = [...new Set([...existing.tags, ...item.tags])];
        existing.keywords = [
          ...new Set([...existing.keywords, ...item.keywords]),
        ];
      }
      existing.updated = now;

      if (contentChanged) {
        this.indexManager.update(existing);
      }

      this.markDirty();
      this.maybeEnrich(existing);
      return existing;
    }

    // Enforce max items
    if (this.index.items.length >= this.config.maxItems) {
      this.enforceCapacity();
    }

    const knowledge: KnowledgeItem = {
      id: crypto.randomUUID(),
      fingerprint,
      ...item,
      useCount: 0,
      lastAccessed: now,
      created: now,
      updated: now,
    };

    this.index.items.push(knowledge);
    this.indexManager.add(knowledge);
    this.markDirty();

    if (this.getActiveContextIds().length > this.config.maxActiveContexts) {
      this.evictColdContexts();
    }

    if (this.index.items.length > this.config.maxItems) {
      this.enforceCapacity();
    }
    this.maybeEnrich(knowledge);

    return knowledge;
  }

  removeKnowledge(id: string): boolean {
    if (!this.index) return false;

    const item = this.indexManager.getById(id);
    if (!item) return false;

    const idx = this.index.items.indexOf(item);
    if (idx === -1) return false;

    this.indexManager.remove(item);
    this.index.items.splice(idx, 1);
    this.markDirty();
    return true;
  }

  markUsed(id: string): void {
    const item = this.indexManager.getById(id);
    if (item) {
      item.useCount++;
      item.lastAccessed = Date.now();
      if (item.scope.defineContextId) {
        this.touchContext(item.scope.defineContextId);
      }
      this.markDirty();
    }
  }

  private markDirty(): void {
    this.dirty = true;
    this.revision += 1;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveTimeout = setTimeout(async () => {
      this.saveTimeout = null;
      if (!this.dirty) {
        return;
      }

      // Retry logic with exponential backoff
      const delays = [1000, 2000, 4000]; // 1s, 2s, 4s
      let lastError: unknown;

      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          await this.save();
          return; // Success
        } catch (error) {
          lastError = error;
          if (attempt < delays.length) {
            console.warn(
              `Auto-save failed (attempt ${attempt + 1}/${delays.length + 1}), retrying in ${delays[attempt]}ms:`,
              error,
            );
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
          }
        }
      }

      console.error("Auto-save failed after all retries:", lastError);
    }, this.SAVE_DEBOUNCE_MS);
  }

  // ========================================================================
  // Search (BM25)
  // ========================================================================

  search(query: KnowledgeQuery): KnowledgeSearchResult[] {
    if (!this.index || this.index.items.length === 0) return [];
    const effectiveQuery = this.enrichQuery(query);
    const rawQuery = effectiveQuery.query?.trim();
    let results: KnowledgeSearchResult[];

    if (rawQuery && this.llmService.shouldExpand()) {
      const terms = this.llmService.expandQuery(rawQuery);
      const merged = new Map<string, KnowledgeSearchResult>();
      const perTermLimit = Math.max(effectiveQuery.maxResults ?? 10, 10);

      for (const term of terms) {
        const termResults = this.indexManager.search(this.index.items, {
          ...effectiveQuery,
          query: term,
          maxResults: perTermLimit,
        });
        for (const result of termResults) {
          const existing = merged.get(result.item.id);
          if (!existing || result.relevance > existing.relevance) {
            merged.set(result.item.id, result);
          }
        }
      }

      results = Array.from(merged.values())
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, effectiveQuery.maxResults ?? 10);
    } else {
      results = this.indexManager.search(this.index.items, effectiveQuery);
    }
    if (effectiveQuery.defineContextId) {
      this.touchContext(effectiveQuery.defineContextId);
    }
    return results;
  }

  /**
   * Interpret a natural language query (LLM optional) and search knowledge.
   * Falls back to raw query terms if LLM is unavailable.
   */
  async searchNaturalLanguage(
    naturalQuery: string,
  ): Promise<KnowledgeSearchResult[]> {
    const interpreted = await this.llmService.interpretQuery(naturalQuery);
    return this.search({
      query: interpreted.query || naturalQuery,
      tags: interpreted.tags,
      moduleName: interpreted.moduleName,
    });
  }

  /**
   * Set the active context to be used for default query scoping.
   */
  setActiveContext(defineContextId?: string, compileOrderId?: string): void {
    this.activeDefineContextId = defineContextId;
    this.activeCompileOrderId = compileOrderId;
    if (defineContextId) {
      this.touchContext(defineContextId);
    }
  }

  getContextKnowledge(
    filePath?: string,
    moduleName?: string,
    taskDescription?: string,
    maxTokens = 1000,
  ): string {
    const results = this.search({
      query: taskDescription,
      filePath,
      moduleName,
      maxResults: 20,
      minConfidence: 0.5,
      relaxedScope: true, // Allow broader context retrieval with penalties
    });

    if (results.length === 0) return "";

    const parts: string[] = ["## Relevant Knowledge\n"];
    let tokens = 10;

    for (const { item } of results) {
      const text = `### ${item.title}\n${item.content}\n`;
      const itemTokens = estimateTokens(text);
      if (tokens + itemTokens > maxTokens) break;
      parts.push(text);
      tokens += itemTokens;
      this.markUsed(item.id);
    }

    return parts.join("\n");
  }

  // ========================================================================
  // Context + Capacity Helpers
  // ========================================================================

  private enrichQuery(query: KnowledgeQuery): KnowledgeQuery {
    if (!this.activeDefineContextId && !this.activeCompileOrderId) {
      return query;
    }
    return {
      ...query,
      defineContextId: query.defineContextId ?? this.activeDefineContextId,
      compileOrderId: query.compileOrderId ?? this.activeCompileOrderId,
    };
  }

  private maybeEnrich(item: KnowledgeItem): void {
    if (!this.llmService.shouldEnrich()) return;
    if (item.aiTags && item.aiTags.length > 0) return;
    this.llmService.enqueueEnrichment(item);
  }

  private applyEnrichment(
    itemId: string,
    result: { aiTags?: string[]; aiSummary?: string },
  ): void {
    const item = this.indexManager.getById(itemId);
    if (!item) return;

    const nextTags = result.aiTags?.length ? result.aiTags : item.aiTags;
    const nextSummary = result.aiSummary ?? item.aiSummary;

    if (nextTags === item.aiTags && nextSummary === item.aiSummary) {
      return;
    }

    item.aiTags = nextTags;
    item.aiSummary = nextSummary;
    item.aiEnrichedAt = Date.now();
    item.updated = Date.now();

    this.indexManager.update(item);
    this.markDirty();
  }

  private touchContext(defineContextId: string): void {
    const now = Date.now();
    const existing = this.contextAccess.get(defineContextId);
    if (existing) {
      existing.lastAccessed = now;
      existing.accessCount += 1;
    } else {
      this.contextAccess.set(defineContextId, {
        lastAccessed: now,
        accessCount: 1,
      });
    }
  }

  private validateScope(scope: KnowledgeScope, source: KnowledgeSource): void {
    if (
      !scope.global &&
      source.method !== "user_provided" &&
      !scope.defineContextId
    ) {
      scope.defineContextId = this.activeDefineContextId ?? "legacy";
    }
  }

  private migrateLegacyItems(items: KnowledgeItem[]): KnowledgeItem[] {
    return items.map((item) => {
      if (
        !item.scope?.defineContextId &&
        item.source.method !== "user_provided" &&
        !item.scope?.global
      ) {
        const updated = {
          ...item,
          scope: {
            ...item.scope,
            defineContextId: "legacy",
          },
          tags: [...(item.tags || []), "legacy-context"],
        };
        updated.fingerprint = computeFingerprint(
          updated.type,
          updated.title,
          updated.scope,
        );
        return updated;
      }
      return item;
    });
  }

  /**
   * Filter out stale structural items that were extracted by the indexer.
   * These types (module_info, dependency, project_context) are no longer supported
   * and should be removed during migration.
   */
  private filterExtractedStructuralItems(
    items: KnowledgeItem[],
  ): { items: KnowledgeItem[]; removedCount: number } {
    const structuralTypes: readonly string[] = REMOVED_STRUCTURAL_TYPES;
    const originalCount = items.length;

    const filtered = items.filter((item) => {
      // Only filter items that were extracted by the indexer
      if (
        item.source.method === "extracted" &&
        item.source.tool === "indexer" &&
        structuralTypes.includes(item.type as string)
      ) {
        return false;
      }
      return true;
    });

    return {
      items: filtered,
      removedCount: originalCount - filtered.length,
    };
  }

  private enforceCapacity(): void {
    if (!this.index) return;

    this.evictColdContexts();

    const maxPerContext = Math.max(
      1,
      Math.floor(this.config.maxItems / this.config.maxActiveContexts),
    );

    for (const defineContextId of this.getActiveContextIds()) {
      const contextItems = this.getItemsByContext(defineContextId);
      if (contextItems.length > maxPerContext) {
        this.pruneOldestInContext(defineContextId, contextItems, maxPerContext);
      }
    }

    if (this.index.items.length > this.config.maxItems) {
      this.pruneLowestScoring();
    }
  }

  private getActiveContextIds(): string[] {
    if (!this.index) return [];
    const ids = new Set<string>();
    for (const item of this.index.items) {
      const id = item.scope.defineContextId;
      if (id) ids.add(id);
    }
    return [...ids];
  }

  private getItemsByContext(defineContextId: string): KnowledgeItem[] {
    if (!this.index) return [];
    return this.index.items.filter(
      (item) => item.scope.defineContextId === defineContextId,
    );
  }

  private pruneOldestInContext(
    defineContextId: string,
    contextItems: KnowledgeItem[],
    maxCount: number,
  ): void {
    if (!this.index) return;

    const removable = contextItems.filter(
      (item) => !item.scope.global && item.source.method !== "user_provided",
    );
    if (removable.length <= maxCount) return;

    const sorted = [...removable].sort(
      (a, b) => a.lastAccessed - b.lastAccessed,
    );
    const toRemove = new Set(
      sorted
        .slice(0, Math.max(0, removable.length - maxCount))
        .map((item) => item.id),
    );

    for (const id of toRemove) {
      const item = this.indexManager.getById(id);
      if (item) this.indexManager.remove(item);
    }
    this.index.items = this.index.items.filter(
      (item) => !toRemove.has(item.id),
    );
    if (toRemove.size > 0) {
      this.markDirty();
    }
  }

  private evictColdContexts(): void {
    if (!this.index) return;

    const contexts = this.getContextMetadata();
    if (contexts.length <= this.config.maxActiveContexts) return;

    const now = Date.now();
    const candidates = contexts
      .filter((ctx) => ctx.id !== "legacy" && ctx.id !== "default")
      .map((ctx) => ({
        ...ctx,
        score: this.computeEvictionScore(ctx, now),
      }))
      .sort((a, b) => b.score - a.score);

    let remaining = contexts.length;
    for (const ctx of candidates) {
      if (remaining <= this.config.maxActiveContexts) break;
      if (
        this.config.minItemsToProtect > 0 &&
        ctx.itemCount >= this.config.minItemsToProtect
      ) {
        continue;
      }
      this.removeItemsByContext(ctx.id);
      this.contextAccess.delete(ctx.id);
      remaining -= 1;
    }
  }

  private computeEvictionScore(
    ctx: { lastAccessed: number; itemCount: number; accessCount: number },
    now: number,
  ): number {
    const age = now - ctx.lastAccessed;
    const beyondTtl = Math.max(0, age - this.config.contextMaxAgeMs);
    const ageScore =
      this.config.contextMaxAgeMs > 0
        ? beyondTtl / this.config.contextMaxAgeMs
        : beyondTtl > 0
          ? 1
          : 0;
    return (
      ageScore * 0.5 +
      (1 / (ctx.itemCount + 1)) * 0.3 +
      (ctx.accessCount === 0 ? 0.2 : 0)
    );
  }

  private getContextMetadata(): Array<{
    id: string;
    lastAccessed: number;
    accessCount: number;
    itemCount: number;
  }> {
    if (!this.index) return [];

    const counts = new Map<string, number>();
    for (const item of this.index.items) {
      const id = item.scope.defineContextId;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    const contexts: Array<{
      id: string;
      lastAccessed: number;
      accessCount: number;
      itemCount: number;
    }> = [];

    for (const [id, itemCount] of counts) {
      const meta = this.contextAccess.get(id);
      contexts.push({
        id,
        lastAccessed: meta?.lastAccessed ?? 0,
        accessCount: meta?.accessCount ?? 0,
        itemCount,
      });
    }

    return contexts;
  }

  private removeItemsByContext(defineContextId: string): void {
    if (!this.index) return;

    const toRemove = new Set<string>();
    for (const item of this.index.items) {
      if (item.scope.defineContextId !== defineContextId) continue;
      if (item.scope.global || item.source.method === "user_provided") continue;
      toRemove.add(item.id);
    }

    for (const id of toRemove) {
      const item = this.indexManager.getById(id);
      if (item) this.indexManager.remove(item);
    }
    this.index.items = this.index.items.filter(
      (item) => !toRemove.has(item.id),
    );
    if (toRemove.size > 0) {
      this.markDirty();
    }
  }

  // ========================================================================
  // Pruning
  // ========================================================================

  private pruneStaleItems(): void {
    if (!this.index) return;

    const { items, pruned } = pruneStaleItems(
      this.index.items,
      this.config.maxUnusedAge,
      this.indexManager,
    );
    if (pruned) {
      this.index.items = items;
      this.markDirty();
    }
  }

  private pruneLowestScoring(): void {
    if (!this.index) return;

    if (pruneLowestScoring(this.index, this.indexManager)) {
      this.markDirty();
    }
  }

  // ========================================================================
  // Knowledge Extraction
  // ========================================================================

  extractFromLintSession(
    sessionId: string,
    errors: Array<{ file: string; message: string; fix?: string }>,
    fixes: Array<{ file: string; original: string; fixed: string }>,
  ): KnowledgeItem[] {
    return extractFromLintSession(
      this.getExtractionDeps(),
      sessionId,
      errors,
      fixes,
    );
  }

  extractFromCodeGen(
    sessionId: string,
    code: string,
    metadata: {
      moduleName?: string;
      type: "testbench" | "module" | "function" | "fsm" | "package";
      description?: string;
    },
  ): KnowledgeItem | null {
    return extractFromCodeGen(
      this.getExtractionDeps(),
      sessionId,
      code,
      metadata,
    );
  }

  learnFromCorrection(
    original: string,
    corrected: string,
    metadata: {
      type?: KnowledgeType;
      tags?: string[];
      filePath?: string;
      moduleName?: string;
    },
  ): KnowledgeItem {
    return learnFromCorrection(
      this.getExtractionDeps(),
      original,
      corrected,
      metadata,
    );
  }

  private getExtractionDeps(): ExtractionDependencies {
    return {
      projectId: this.projectId,
      defineContextId: this.activeDefineContextId,
      compileOrderId: this.activeCompileOrderId,
      addKnowledge: this.addKnowledge.bind(this),
      scheduleSave: this.scheduleSave.bind(this),
    };
  }

  // ========================================================================
  // Public Accessors
  // ========================================================================

  getByType(type: KnowledgeType): KnowledgeItem[] {
    return this.index?.items.filter((i) => i.type === type) ?? [];
  }

  getStats(): KnowledgeIndex["stats"] | null {
    if (!this.index) return null;
    updateStats(this.index);
    return this.index.stats;
  }

  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Get all knowledge items (for TieredKnowledgeStore initialization)
   */
  getItems(): KnowledgeItem[] {
    return this.index?.items ?? [];
  }

  /**
   * Get a knowledge item by ID (for TieredKnowledgeStore lazy loading)
   */
  getItemById(id: string): KnowledgeItem | undefined {
    return this.indexManager.getById(id);
  }
}
