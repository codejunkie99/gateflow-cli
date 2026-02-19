/**
 * MemoryService - Unified facade for memory and knowledge management
 *
 * Provides a single point of access for:
 * - MemoryManager (project context, approvals, history archiving)
 * - KnowledgeStore (learned patterns, keyword-based retrieval)
 *
 * Benefits:
 * - Coordinated initialization and shutdown
 * - Token budget enforcement across both stores
 * - Debounced saves to prevent excessive I/O
 * - Simplified agent integration
 */

import type { EventBus } from "../events/index.js";
import { AsyncMutex } from "../concurrency/index.js";
import {
  MemoryManager,
  type ProjectMemory,
  type MemoryConfig,
} from "./store/manager.js";
import {
  KnowledgeStore,
  type KnowledgeStoreConfig,
  type KnowledgeQuery,
} from "./ParentKnowledgeStore.js";
import {
  TieredKnowledgeStore,
  type TieredStoreConfig,
  createTieredStore,
} from "./tiered-store.js";
import { estimateTokens } from "./utils.js";
import { KnowledgeService } from "./knowledge-service/index.js";
import type { ResolvedProject } from "../indexer/types/index.js";

// ============================================================================
// Types
// ============================================================================

interface MemoryServiceConfig {
  /** MemoryManager configuration */
  memory?: Partial<MemoryConfig>;
  /** KnowledgeStore configuration */
  knowledge?: Partial<KnowledgeStoreConfig>;
  /** Total token budget for context injection (default: 2000) */
  contextTokenBudget?: number;
  /** Tiered storage configuration (optional - enables memory optimization) */
  tiering?: Partial<TieredStoreConfig>;
  /** Function to get the current project (for structural knowledge queries) */
  projectGetter?: () => ResolvedProject | null;
}

interface ContextInjection {
  /** Project context from MemoryManager */
  memoryContext: string;
  /** Knowledge context from KnowledgeStore */
  knowledgeContext: string;
  /** Estimated total tokens used */
  totalTokens: number;
}

// ============================================================================
// MemoryService Implementation
// ============================================================================

export class MemoryService {
  private memoryManager: MemoryManager;
  private knowledgeStore: KnowledgeStore;
  private knowledgeService: KnowledgeService;
  private tieredStore?: TieredKnowledgeStore;
  private initialized = false;
  private initMutex = new AsyncMutex();
  private contextTokenBudget: number;

  constructor(
    private projectRoot: string,
    private bus: EventBus,
    config?: MemoryServiceConfig,
  ) {
    this.memoryManager = new MemoryManager(projectRoot, bus, config?.memory);
    this.knowledgeStore = new KnowledgeStore(
      projectRoot,
      bus,
      config?.knowledge,
    );
    this.contextTokenBudget = config?.contextTokenBudget ?? 2000;

    // Create KnowledgeService for unified structural + learned knowledge queries
    // Use provided projectGetter or default to null (no structural knowledge)
    const projectGetter = config?.projectGetter ?? (() => null);
    this.knowledgeService = new KnowledgeService(projectGetter, this.knowledgeStore);

    // Create tiered storage if configured
    if (config?.tiering) {
      this.tieredStore = createTieredStore(config.tiering);
    }
  }

  /**
   * Initialize both stores
   * Safe to call multiple times - only initializes once
   * Throws if initialization fails, allowing retry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    return this.initMutex.withLock(async () => {
      if (this.initialized) return;

      try {
        await Promise.all([
          this.memoryManager.load(),
          this.knowledgeStore.load(),
        ]);

        // Wire tiered storage to knowledge store after loading
        if (this.tieredStore) {
          this.tieredStore.initialize(this.knowledgeStore.getItems(), (id) =>
            this.knowledgeStore.getItemById(id),
          );
        }

        this.initialized = true;
      } catch (error) {
        // Ensure initialized stays false on error to allow retry
        this.initialized = false;
        throw error;
      }
    });
  }

  /**
   * Save both stores sequentially
   * Uses shared lock file, so sequential saves avoid contention
   */
  async save(): Promise<void> {
    await this.memoryManager.save();
    await this.knowledgeStore.save();
  }

  /**
   * Flush any pending writes and save both stores
   * Call before process exit to ensure all data is persisted
   */
  async shutdown(): Promise<void> {
    // Flush both stores to clear any pending debounced saves
    await Promise.all([
      this.memoryManager.flush(),
      this.knowledgeStore.flush(),
    ]);
  }

  /**
   * Get context for AI injection with token budget enforcement
   *
   * Uses KnowledgeService for combined structural + learned knowledge context.
   *
   * @param query Optional query to filter knowledge by file/module/task
   * @returns Combined context from both stores within budget
   */
  getContextForAI(query?: KnowledgeQuery): ContextInjection {
    // Return empty context if not initialized
    if (!this.initialized) {
      return {
        memoryContext: "",
        knowledgeContext: "",
        totalTokens: 0,
      };
    }

    // Split budget: 40% memory, 60% knowledge (adjustable)
    const memoryBudget = Math.floor(this.contextTokenBudget * 0.4);
    const knowledgeBudget = this.contextTokenBudget - memoryBudget;

    const memoryContext = this.memoryManager.getContextForAI();
    const memoryTokens = estimateTokens(memoryContext);

    // Adjust knowledge budget if memory underutilized
    const actualMemoryTokens = Math.min(memoryTokens, memoryBudget);
    const adjustedKnowledgeBudget =
      knowledgeBudget + (memoryBudget - actualMemoryTokens);

    // Use KnowledgeService for combined structural + learned knowledge context
    // Method signature: getContextForAI(query?, filePath?, moduleName?, maxTokens?)
    const knowledgeContext = this.knowledgeService.getContextForAI(
      {
        query: query?.query,
        filePath: query?.filePath,
        moduleName: query?.moduleName,
        knowledgeTypes: query?.types,
        tags: query?.tags,
        maxResults: query?.maxResults,
        minConfidence: query?.minConfidence,
        defineContextId: query?.defineContextId,
        compileOrderId: query?.compileOrderId,
        relaxedScope: query?.relaxedScope,
      },
      adjustedKnowledgeBudget,
    );
    const knowledgeTokens = estimateTokens(knowledgeContext);

    // Mark accessed items in tiered storage for promotion tracking
    if (this.tieredStore) {
      this.markTieredAccess(knowledgeContext);
    }

    // Truncate memory context only if it exceeds budget
    const truncatedMemoryContext =
      memoryTokens > memoryBudget
        ? this.truncateToTokenBudget(memoryContext, memoryBudget)
        : memoryContext;

    return {
      memoryContext: truncatedMemoryContext,
      knowledgeContext,
      totalTokens: actualMemoryTokens + knowledgeTokens,
    };
  }

  /**
   * Truncate text to fit within a token budget
   * Uses binary search for efficiency
   */
  private truncateToTokenBudget(text: string, maxTokens: number): string {
    if (estimateTokens(text) <= maxTokens) return text;

    // Binary search for optimal cut point
    let low = 0;
    let high = text.length;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (estimateTokens(text.slice(0, mid)) <= maxTokens) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    return text.slice(0, low);
  }

  /**
   * Mark items as accessed in tiered storage based on context content
   */
  private markTieredAccess(knowledgeContext: string): void {
    if (!this.tieredStore) return;

    // Extract item titles from context and mark as accessed
    const titleRegex = /^### (.+)$/gm;
    let match;
    while ((match = titleRegex.exec(knowledgeContext)) !== null) {
      const title = match[1];
      // Find item by title and mark accessed
      const items = this.knowledgeStore.getItems();
      const item = items.find((i) => i.title === title);
      if (item) {
        this.tieredStore.markAccessed(item.id);
      }
    }
  }

  /**
   * Get combined context as a single string
   * Convenience method for simple integration
   * Returns empty string if not initialized
   */
  getContextString(query?: KnowledgeQuery): string {
    // getContextForAI already handles initialization check
    const ctx = this.getContextForAI(query);
    const parts: string[] = [];

    if (ctx.memoryContext.trim()) {
      parts.push(ctx.memoryContext);
    }
    if (ctx.knowledgeContext.trim()) {
      parts.push(ctx.knowledgeContext);
    }

    return parts.join("\n\n");
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Access the underlying MemoryManager
   * Use for memory-specific operations (approvals, history, etc.)
   */
  get memory(): MemoryManager {
    return this.memoryManager;
  }

  /**
   * Access the underlying KnowledgeStore
   * Use for knowledge-specific operations (learning, search, etc.)
   */
  get knowledge(): KnowledgeStore {
    return this.knowledgeStore;
  }

  /**
   * Access the tiered storage (if configured)
   * Use for memory optimization stats and manual tier management
   */
  get tiering(): TieredKnowledgeStore | undefined {
    return this.tieredStore;
  }

  /**
   * Get the KnowledgeService for unified structural + learned knowledge queries.
   * Use this for tools that need combined search across both sources.
   */
  getKnowledgeService(): KnowledgeService {
    return this.knowledgeService;
  }

  /**
   * Get project memory if loaded
   * Returns null if not initialized
   */
  getProjectMemory(): ProjectMemory | null {
    if (!this.initialized) {
      return null;
    }
    return this.memoryManager.getMemory();
  }

  /**
   * Get project ID
   * Returns empty string if not initialized
   */
  getProjectId(): string {
    if (!this.initialized) {
      return "";
    }
    return this.memoryManager.getProjectId();
  }

  /**
   * Set active context to be used for knowledge queries.
   */
  setActiveContext(defineContextId?: string, compileOrderId?: string): void {
    this.knowledgeStore.setActiveContext(defineContextId, compileOrderId);
  }
}

// ============================================================================
// Factory Functions & Singleton Management
// ============================================================================

/** Global singleton instance - null until explicitly set */
let globalMemoryService: MemoryService | null = null;

/**
 * Get the global MemoryService singleton.
 * @returns The singleton instance, or null if not yet initialized
 */
export function getMemoryService(): MemoryService | null {
  return globalMemoryService;
}

/**
 * Set the global MemoryService singleton.
 * Call this once during app initialization after creating the service.
 *
 * @param service - The initialized MemoryService instance
 */
export function setGlobalMemoryService(service: MemoryService): void {
  globalMemoryService = service;
}

/**
 * Create a new MemoryService instance
 */
export function createMemoryService(
  projectRoot: string,
  bus: EventBus,
  config?: MemoryServiceConfig,
): MemoryService {
  return new MemoryService(projectRoot, bus, config);
}
