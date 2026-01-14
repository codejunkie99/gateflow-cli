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

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { EventBus } from '../../events/index.js';
import { AsyncMutex } from '../../concurrency/index.js';
import { estimateTokens } from '../utils.js';
import { KnowledgeIndexManager } from '../knowledge-index.js';
import {
    DEFAULT_KNOWLEDGE_STORE_CONFIG,
    type KnowledgeIndex,
    type KnowledgeItem,
    type KnowledgeQuery,
    type KnowledgeSearchResult,
    type KnowledgeStoreConfig,
    type KnowledgeType
} from '../knowledge-types.js';
import { KnowledgeStoreLockManager } from './lock-manager.js';
import {
    arraysEqual,
    computeFingerprint,
    createDefaultIndex,
    migrateIndex,
    updateStats
} from './store-utils.js';
import {
    extractFromLintSession,
    extractFromCodeGen,
    learnFromCorrection,
    type ExtractionDependencies
} from './extraction.js';
import { pruneLowestScoring, pruneStaleItems } from './pruning.js';

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

    private readonly SAVE_DEBOUNCE_MS = 5000;
    private readonly LOCK_TIMEOUT_MS = 5000;

    constructor(
        private projectRoot: string,
        private bus: EventBus,
        config?: Partial<KnowledgeStoreConfig>
    ) {
        this.projectId = crypto
            .createHash('md5')
            .update(path.resolve(projectRoot))
            .digest('hex')
            .slice(0, 12);

        this.config = { ...DEFAULT_KNOWLEDGE_STORE_CONFIG, ...config };
        this.knowledgePath = path.join(this.config.knowledgeDir, `${this.projectId}-knowledge.json`);
        this.lockPath = path.join(this.config.knowledgeDir, `${this.projectId}-knowledge.lock`);
        this.indexManager = new KnowledgeIndexManager(this.projectId);
        this.lockManager = new KnowledgeStoreLockManager(this.lockPath, this.LOCK_TIMEOUT_MS);
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    async load(): Promise<KnowledgeIndex> {
        return this.ioMutex.withLock(async () => {
            await fs.mkdir(this.config.knowledgeDir, { recursive: true });

            try {
                const content = await fs.readFile(this.knowledgePath, 'utf-8');
                this.index = migrateIndex(JSON.parse(content) as KnowledgeIndex, this.projectId);
                this.pruneStaleItems();
                this.indexManager.rebuild(this.index.items);
                return this.index;
            } catch (error) {
                // Bug 1.3 fix: Distinguish between error types
                const errCode = (error as NodeJS.ErrnoException).code;

                // Case 1: File doesn't exist - this is fine on first run
                if (errCode === 'ENOENT') {
                    this.index = createDefaultIndex(this.projectId);
                    this.indexManager.clear();
                    return this.index;
                }

                // Case 2: Permission denied - user needs to fix this
                if (errCode === 'EACCES' || errCode === 'EPERM') {
                    console.error(
                        `KnowledgeStore: Permission denied reading ${this.knowledgePath}\n` +
                        `Please check file permissions.`
                    );
                    throw error;
                }

                // Case 3: I/O error - disk problem
                if (errCode === 'EIO' || errCode === 'EROFS') {
                    console.error(
                        `KnowledgeStore: I/O error reading ${this.knowledgePath}\n` +
                        `Please check disk health.`
                    );
                    throw error;
                }

                // Case 4: JSON parse error or schema error - file is corrupted
                console.warn(
                    `KnowledgeStore: File corrupted or invalid at ${this.knowledgePath}\n` +
                    `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n` +
                    `Creating backup and starting fresh.`
                );

                // Attempt to backup the corrupted file
                try {
                    const backupPath = `${this.knowledgePath}.corrupted.${Date.now()}`;
                    await fs.rename(this.knowledgePath, backupPath);
                    console.warn(`KnowledgeStore: Corrupted file backed up to ${backupPath}`);
                } catch (backupError) {
                    console.warn(
                        `KnowledgeStore: Could not create backup: ` +
                        `${backupError instanceof Error ? backupError.message : 'Unknown error'}`
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
                await fs.writeFile(tempPath, payload, 'utf-8');
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

    destroy(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
    }

    // ========================================================================
    // Knowledge CRUD
    // ========================================================================

    addKnowledge(item: Omit<KnowledgeItem, 'id' | 'fingerprint' | 'created' | 'updated' | 'useCount' | 'lastAccessed'>): KnowledgeItem {
        if (!this.index) throw new Error('KnowledgeStore not loaded');

        const now = Date.now();
        const fingerprint = computeFingerprint(item.type, item.title, item.scope);

        // Check for duplicate
        const existing = this.indexManager.getByFingerprint(fingerprint);
        if (existing) {
            // Bug 1.1 fix: Check if content changed and rebuild indices
            const contentChanged = existing.content !== item.content ||
                                   !arraysEqual(existing.tags, item.tags) ||
                                   !arraysEqual(existing.keywords, item.keywords);

            if (contentChanged) {
                this.indexManager.remove(existing);
            }

            existing.content = item.content;
            existing.confidence = Math.max(existing.confidence, item.confidence);
            // Bug 1.1 fix: When content changes, replace tags/keywords instead of merging
            // to ensure old terms are removed from indices
            if (contentChanged) {
                existing.tags = [...item.tags];
                existing.keywords = [...item.keywords];
            } else {
                // Only merge when content hasn't changed (additive updates)
                existing.tags = [...new Set([...existing.tags, ...item.tags])];
                existing.keywords = [...new Set([...existing.keywords, ...item.keywords])];
            }
            existing.updated = now;

            if (contentChanged) {
                this.indexManager.add(existing, this.index.items.length);
            }

            this.markDirty();
            return existing;
        }

        // Enforce max items
        if (this.index.items.length >= this.config.maxItems) {
            this.pruneLowestScoring();
        }

        const knowledge: KnowledgeItem = {
            id: crypto.randomUUID(),
            fingerprint,
            ...item,
            useCount: 0,
            lastAccessed: now,
            created: now,
            updated: now
        };

        this.index.items.push(knowledge);
        this.indexManager.add(knowledge, this.index.items.length);
        this.markDirty();

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
            if (this.dirty) {
                try {
                    await this.save();
                } catch (e) {
                    console.error('Auto-save failed:', e);
                }
            }
        }, this.SAVE_DEBOUNCE_MS);
    }

    // ========================================================================
    // Search (BM25)
    // ========================================================================

    search(query: KnowledgeQuery): KnowledgeSearchResult[] {
        if (!this.index || this.index.items.length === 0) return [];
        return this.indexManager.search(this.index.items, query);
    }

    getContextKnowledge(
        filePath?: string,
        moduleName?: string,
        taskDescription?: string,
        maxTokens = 1000
    ): string {
        const results = this.search({
            query: taskDescription,
            filePath,
            moduleName,
            maxResults: 20,
            minConfidence: 0.5,
            relaxedScope: true  // Allow broader context retrieval with penalties
        });

        if (results.length === 0) return '';

        const parts: string[] = ['## Relevant Knowledge\n'];
        let tokens = 10;

        for (const { item } of results) {
            const text = `### ${item.title}\n${item.content}\n`;
            const itemTokens = estimateTokens(text);
            if (tokens + itemTokens > maxTokens) break;
            parts.push(text);
            tokens += itemTokens;
            this.markUsed(item.id);
        }

        return parts.join('\n');
    }

    // ========================================================================
    // Pruning
    // ========================================================================

    private pruneStaleItems(): void {
        if (!this.index) return;

        const { items, pruned } = pruneStaleItems(this.index.items, this.config.maxUnusedAge);
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
        fixes: Array<{ file: string; original: string; fixed: string }>
    ): KnowledgeItem[] {
        return extractFromLintSession(this.getExtractionDeps(), sessionId, errors, fixes);
    }

    extractFromCodeGen(
        sessionId: string,
        code: string,
        metadata: {
            moduleName?: string;
            type: 'testbench' | 'module' | 'function' | 'fsm' | 'package';
            description?: string;
        }
    ): KnowledgeItem | null {
        return extractFromCodeGen(this.getExtractionDeps(), sessionId, code, metadata);
    }

    learnFromCorrection(
        original: string,
        corrected: string,
        metadata: {
            type?: KnowledgeType;
            tags?: string[];
            filePath?: string;
            moduleName?: string;
        }
    ): KnowledgeItem {
        return learnFromCorrection(this.getExtractionDeps(), original, corrected, metadata);
    }

    private getExtractionDeps(): ExtractionDependencies {
        return {
            projectId: this.projectId,
            addKnowledge: this.addKnowledge.bind(this),
            scheduleSave: this.scheduleSave.bind(this)
        };
    }

    // ========================================================================
    // Public Accessors
    // ========================================================================

    getByType(type: KnowledgeType): KnowledgeItem[] {
        return this.index?.items.filter(i => i.type === type) ?? [];
    }

    getStats(): KnowledgeIndex['stats'] | null {
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

