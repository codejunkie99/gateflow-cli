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

import type { EventBus } from '../events/index.js';
import { AsyncMutex } from '../concurrency/index.js';
import { MemoryManager, type ProjectMemory, type MemoryConfig } from './manager.js';
import { KnowledgeStore, type KnowledgeStoreConfig, type KnowledgeQuery } from './KnowledgeStore.js';
import { TieredKnowledgeStore, type TieredStoreConfig, createTieredStore } from './tiered-store.js';
import { estimateTokens } from './utils.js';

// ============================================================================
// Types
// ============================================================================

export interface MemoryServiceConfig {
    /** MemoryManager configuration */
    memory?: Partial<MemoryConfig>;
    /** KnowledgeStore configuration */
    knowledge?: Partial<KnowledgeStoreConfig>;
    /** Total token budget for context injection (default: 2000) */
    contextTokenBudget?: number;
    /** Tiered storage configuration (optional - enables memory optimization) */
    tiering?: Partial<TieredStoreConfig>;
}

export interface ContextInjection {
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
    private tieredStore?: TieredKnowledgeStore;
    private initialized = false;
    private initMutex = new AsyncMutex();
    private contextTokenBudget: number;

    constructor(
        private projectRoot: string,
        private bus: EventBus,
        config?: MemoryServiceConfig
    ) {
        this.memoryManager = new MemoryManager(projectRoot, bus, config?.memory);
        this.knowledgeStore = new KnowledgeStore(projectRoot, bus, config?.knowledge);
        this.contextTokenBudget = config?.contextTokenBudget ?? 2000;

        // Create tiered storage if configured
        if (config?.tiering) {
            this.tieredStore = createTieredStore(config.tiering);
        }
    }

    /**
     * Initialize both stores
     * Safe to call multiple times - only initializes once
     */
    async initialize(): Promise<void> {
        return this.initMutex.withLock(async () => {
            if (this.initialized) return;

            await Promise.all([
                this.memoryManager.load(),
                this.knowledgeStore.load()
            ]);

            // Wire tiered storage to knowledge store after loading
            if (this.tieredStore) {
                this.tieredStore.initialize(
                    this.knowledgeStore.getItems(),
                    (id) => this.knowledgeStore.getItemById(id)
                );
            }

            this.initialized = true;
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
            this.knowledgeStore.flush()
        ]);
    }

    /**
     * Get context for AI injection with token budget enforcement
     *
     * @param query Optional query to filter knowledge by file/module/task
     * @returns Combined context from both stores within budget
     */
    getContextForAI(query?: KnowledgeQuery): ContextInjection {
        // Split budget: 40% memory, 60% knowledge (adjustable)
        const memoryBudget = Math.floor(this.contextTokenBudget * 0.4);
        const knowledgeBudget = this.contextTokenBudget - memoryBudget;

        const memoryContext = this.memoryManager.getContextForAI();
        const memoryTokens = estimateTokens(memoryContext);

        // Adjust knowledge budget if memory underutilized
        const actualMemoryTokens = Math.min(memoryTokens, memoryBudget);
        const adjustedKnowledgeBudget = knowledgeBudget + (memoryBudget - actualMemoryTokens);

        const knowledgeContext = this.knowledgeStore.getContextKnowledge(
            query?.filePath,
            query?.moduleName,
            query?.query,
            adjustedKnowledgeBudget
        );
        const knowledgeTokens = estimateTokens(knowledgeContext);

        return {
            memoryContext: memoryContext.slice(0, memoryBudget * 4), // Truncate if needed
            knowledgeContext,
            totalTokens: actualMemoryTokens + knowledgeTokens
        };
    }

    /**
     * Get combined context as a single string
     * Convenience method for simple integration
     */
    getContextString(query?: KnowledgeQuery): string {
        const ctx = this.getContextForAI(query);
        const parts: string[] = [];

        if (ctx.memoryContext.trim()) {
            parts.push(ctx.memoryContext);
        }
        if (ctx.knowledgeContext.trim()) {
            parts.push(ctx.knowledgeContext);
        }

        return parts.join('\n\n');
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
     * Get project memory if loaded
     */
    getProjectMemory(): ProjectMemory | null {
        return this.memoryManager.getMemory();
    }

    /**
     * Get project ID
     */
    getProjectId(): string {
        return this.memoryManager.getProjectId();
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new MemoryService instance
 */
export function createMemoryService(
    projectRoot: string,
    bus: EventBus,
    config?: MemoryServiceConfig
): MemoryService {
    return new MemoryService(projectRoot, bus, config);
}
