/**
 * KnowledgeStore - Persistent learned patterns for context-aware retrieval
 *
 * Stores knowledge learned from working with the project:
 * - Code patterns (naming conventions, module structures)
 * - Common lint fixes
 * - User preferences in code style
 * - Module relationships and dependencies
 *
 * Retrieval: BM25 scoring with inverted index for O(k) candidate selection.
 * All indices are in-memory Maps rebuilt on load().
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import picomatch from 'picomatch';
import type { EventBus } from '../events/index.js';
import { AsyncMutex } from '../concurrency/index.js';
import { estimateTokens } from './utils.js';

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeItem {
    id: string;
    fingerprint: string;
    type: KnowledgeType;
    title: string;
    content: string;
    tags: string[];
    keywords: string[];
    scope: KnowledgeScope;
    source: KnowledgeSource;
    confidence: number;
    useCount: number;
    lastAccessed: number;
    created: number;
    updated: number;
}

export type KnowledgeType =
    | 'code_pattern'
    | 'lint_fix'
    | 'test_pattern'
    | 'module_info'
    | 'dependency'
    | 'style_preference'
    | 'workflow'
    | 'debug_solution'
    | 'tool_usage'
    | 'project_context';

export interface KnowledgeScope {
    global: boolean;
    projectIds?: string[];
    filePatterns?: string[];
    modules?: string[];
}

export interface KnowledgeSource {
    method: 'extracted' | 'inferred' | 'user_provided' | 'tool_result';
    sessionId?: string;
    filePath?: string;
    tool?: string;
}

export interface KnowledgeSearchResult {
    item: KnowledgeItem;
    relevance: number;
    matchReason: string;
}

export interface KnowledgeQuery {
    query?: string;
    types?: KnowledgeType[];
    tags?: string[];
    filePath?: string;
    moduleName?: string;
    maxResults?: number;
    minConfidence?: number;
}

export interface KnowledgeStoreConfig {
    knowledgeDir: string;
    maxItems: number;
    minExtractionConfidence: number;
    maxUnusedAge: number;
}

export interface KnowledgeIndex {
    version: number;
    projectId: string;
    items: KnowledgeItem[];
    stats: {
        totalItems: number;
        byType: Record<KnowledgeType, number>;
        lastUpdated: number;
    };
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_KNOWLEDGE_STORE_CONFIG: KnowledgeStoreConfig = {
    knowledgeDir: path.join(os.homedir(), '.gateflow'),
    maxItems: 500,
    minExtractionConfidence: 0.6,
    maxUnusedAge: 30 * 24 * 60 * 60 * 1000
};

// BM25 parameters
const BM25_K1 = 1.2;
const BM25_B = 0.75;

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
    private ioMutex = new AsyncMutex();
    private lockAcquired = false;
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;

    // In-memory indices (rebuilt on load)
    private itemById = new Map<string, KnowledgeItem>();
    private itemByFingerprint = new Map<string, KnowledgeItem>();
    private invertedIndex = new Map<string, Set<string>>(); // term -> item IDs
    private docLengths = new Map<string, number>(); // item ID -> word count
    private termDocFreq = new Map<string, number>(); // term -> doc count
    private avgDocLength = 0;

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
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    async load(): Promise<KnowledgeIndex> {
        return this.ioMutex.withLock(async () => {
            await fs.mkdir(this.config.knowledgeDir, { recursive: true });

            try {
                const content = await fs.readFile(this.knowledgePath, 'utf-8');
                this.index = this.migrate(JSON.parse(content) as KnowledgeIndex);
                this.pruneStaleItems();
                this.rebuildAllIndices();
                return this.index;
            } catch {
                this.index = this.createDefaultIndex();
                this.clearAllIndices();
                return this.index;
            }
        });
    }

    async save(): Promise<void> {
        return this.ioMutex.withLock(async () => {
            if (!this.index || !this.dirty) return;

            const acquired = await this.acquireLock();
            if (!acquired) {
                throw new Error(`Failed to acquire lock: ${this.lockPath}`);
            }

            try {
                this.updateStats();
                const tempPath = `${this.knowledgePath}.${Date.now()}.tmp`;
                await fs.writeFile(tempPath, JSON.stringify(this.index, null, 2), 'utf-8');
                await fs.rename(tempPath, this.knowledgePath);
                this.dirty = false;
            } finally {
                await this.releaseLock();
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
    // Index Management
    // ========================================================================

    private clearAllIndices(): void {
        this.itemById.clear();
        this.itemByFingerprint.clear();
        this.invertedIndex.clear();
        this.docLengths.clear();
        this.termDocFreq.clear();
        this.avgDocLength = 0;
    }

    private rebuildAllIndices(): void {
        this.clearAllIndices();
        if (!this.index) return;

        let totalLength = 0;

        for (const item of this.index.items) {
            // ID and fingerprint indices
            this.itemById.set(item.id, item);
            if (item.fingerprint) {
                this.itemByFingerprint.set(item.fingerprint, item);
            }

            // Tokenize and build inverted index
            const tokens = this.tokenize(item);
            this.docLengths.set(item.id, tokens.length);
            totalLength += tokens.length;

            const seenTerms = new Set<string>();
            for (const term of tokens) {
                // Add to inverted index
                let postings = this.invertedIndex.get(term);
                if (!postings) {
                    postings = new Set();
                    this.invertedIndex.set(term, postings);
                }
                postings.add(item.id);

                // Track document frequency (count each term once per doc)
                if (!seenTerms.has(term)) {
                    seenTerms.add(term);
                    this.termDocFreq.set(term, (this.termDocFreq.get(term) || 0) + 1);
                }
            }
        }

        this.avgDocLength = this.index.items.length > 0
            ? totalLength / this.index.items.length
            : 0;
    }

    private addToIndices(item: KnowledgeItem): void {
        this.itemById.set(item.id, item);
        this.itemByFingerprint.set(item.fingerprint, item);

        const tokens = this.tokenize(item);
        this.docLengths.set(item.id, tokens.length);

        // Update avg doc length
        const n = this.index!.items.length;
        this.avgDocLength = ((this.avgDocLength * (n - 1)) + tokens.length) / n;

        const seenTerms = new Set<string>();
        for (const term of tokens) {
            let postings = this.invertedIndex.get(term);
            if (!postings) {
                postings = new Set();
                this.invertedIndex.set(term, postings);
            }
            postings.add(item.id);

            if (!seenTerms.has(term)) {
                seenTerms.add(term);
                this.termDocFreq.set(term, (this.termDocFreq.get(term) || 0) + 1);
            }
        }
    }

    private removeFromIndices(item: KnowledgeItem): void {
        this.itemById.delete(item.id);
        this.itemByFingerprint.delete(item.fingerprint);

        const tokens = this.tokenize(item);
        this.docLengths.delete(item.id);

        const seenTerms = new Set<string>();
        for (const term of tokens) {
            const postings = this.invertedIndex.get(term);
            if (postings) {
                postings.delete(item.id);
                if (postings.size === 0) {
                    this.invertedIndex.delete(term);
                }
            }

            if (!seenTerms.has(term)) {
                seenTerms.add(term);
                const count = this.termDocFreq.get(term) || 0;
                if (count <= 1) {
                    this.termDocFreq.delete(term);
                } else {
                    this.termDocFreq.set(term, count - 1);
                }
            }
        }
    }

    private tokenize(item: KnowledgeItem): string[] {
        const text = `${item.title} ${item.content} ${item.tags.join(' ')} ${item.keywords.join(' ')}`;
        return text
            .toLowerCase()
            .split(/\W+/)
            .filter(t => t.length > 2);
    }

    // ========================================================================
    // Knowledge CRUD
    // ========================================================================

    addKnowledge(item: Omit<KnowledgeItem, 'id' | 'fingerprint' | 'created' | 'updated' | 'useCount' | 'lastAccessed'>): KnowledgeItem {
        if (!this.index) throw new Error('KnowledgeStore not loaded');

        const now = Date.now();
        const fingerprint = this.computeFingerprint(item.type, item.title, item.scope);

        // Check for duplicate
        const existing = this.itemByFingerprint.get(fingerprint);
        if (existing) {
            existing.content = item.content;
            existing.confidence = Math.max(existing.confidence, item.confidence);
            existing.tags = [...new Set([...existing.tags, ...item.tags])];
            existing.keywords = [...new Set([...existing.keywords, ...item.keywords])];
            existing.updated = now;
            this.dirty = true;
            // Note: Should rebuild indices if content changed significantly
            // For now, skip as tags/keywords mostly additive
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
        this.addToIndices(knowledge);
        this.dirty = true;

        return knowledge;
    }

    removeKnowledge(id: string): boolean {
        if (!this.index) return false;

        const item = this.itemById.get(id);
        if (!item) return false;

        const idx = this.index.items.indexOf(item);
        if (idx === -1) return false;

        this.removeFromIndices(item);
        this.index.items.splice(idx, 1);
        this.dirty = true;
        return true;
    }

    markUsed(id: string): void {
        const item = this.itemById.get(id);
        if (item) {
            item.useCount++;
            item.lastAccessed = Date.now();
            this.dirty = true;
            this.scheduleSave();
        }
    }

    private scheduleSave(): void {
        if (this.saveTimeout) return;
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

        // Get candidates via inverted index
        let candidates: KnowledgeItem[];
        const queryTerms = query.query ? this.tokenizeQuery(query.query) : [];

        if (queryTerms.length > 0) {
            const candidateIds = new Set<string>();
            for (const term of queryTerms) {
                const postings = this.invertedIndex.get(term);
                if (postings) {
                    for (const id of postings) candidateIds.add(id);
                }
            }
            candidates = [];
            for (const id of candidateIds) {
                const item = this.itemById.get(id);
                if (item) candidates.push(item);
            }
        } else {
            candidates = [...this.index.items];
        }

        // Apply filters
        if (query.types?.length) {
            candidates = candidates.filter(i => query.types!.includes(i.type));
        }
        if (query.tags?.length) {
            candidates = candidates.filter(i => query.tags!.some(t => i.tags.includes(t)));
        }
        if (query.minConfidence !== undefined) {
            candidates = candidates.filter(i => i.confidence >= query.minConfidence!);
        }
        candidates = candidates.filter(i => this.matchesScope(i.scope, query));

        // Score
        const results: KnowledgeSearchResult[] = candidates.map(item => ({
            item,
            relevance: queryTerms.length > 0
                ? this.scoreBM25(item, queryTerms)
                : this.scoreBasic(item),
            matchReason: this.getMatchReason(item, query)
        }));

        results.sort((a, b) => b.relevance - a.relevance);
        return results.slice(0, query.maxResults ?? 10);
    }

    private tokenizeQuery(text: string): string[] {
        return text.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    }

    private scoreBM25(item: KnowledgeItem, queryTerms: string[]): number {
        const docLen = this.docLengths.get(item.id) || 1;
        const N = this.index!.items.length;
        const itemTokens = this.tokenize(item);

        // Build term frequency map for this item
        const tf = new Map<string, number>();
        for (const t of itemTokens) {
            tf.set(t, (tf.get(t) || 0) + 1);
        }

        let score = 0;
        for (const term of queryTerms) {
            const termFreq = tf.get(term) || 0;
            if (termFreq === 0) continue;

            const docFreq = this.termDocFreq.get(term) || 0;
            const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));

            const num = idf * termFreq * (BM25_K1 + 1);
            const denom = termFreq + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / (this.avgDocLength || 1)));
            score += num / denom;
        }

        // Normalize to 0-1 range and blend with confidence
        const normalized = Math.min(score / 10, 1);
        return normalized * 0.7 + item.confidence * 0.3;
    }

    private scoreBasic(item: KnowledgeItem): number {
        const daysSinceAccess = (Date.now() - item.lastAccessed) / (24 * 60 * 60 * 1000);
        const recency = Math.max(0, 0.2 - daysSinceAccess * 0.01);
        return item.confidence * 0.6 + recency + Math.min(item.useCount * 0.02, 0.2);
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
            minConfidence: 0.5
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
    // Scope Matching
    // ========================================================================

    private matchesScope(scope: KnowledgeScope, query: KnowledgeQuery): boolean {
        if (scope.global) return true;

        if (scope.projectIds && !scope.projectIds.includes(this.projectId)) {
            return false;
        }

        // Fail-closed: scoped items require matching context
        if (scope.modules?.length) {
            if (!query.moduleName || !scope.modules.includes(query.moduleName)) {
                return false;
            }
        }

        if (scope.filePatterns?.length) {
            if (!query.filePath) return false;
            const normalizedPath = query.filePath.replace(/\\/g, '/');
            const matches = scope.filePatterns.some(p =>
                picomatch.isMatch(normalizedPath, p.replace(/\\/g, '/'), {
                    dot: true,
                    nocase: process.platform === 'win32'
                })
            );
            if (!matches) return false;
        }

        return true;
    }

    private getMatchReason(item: KnowledgeItem, query: KnowledgeQuery): string {
        const reasons: string[] = [];

        if (query.query) {
            const terms = this.tokenizeQuery(query.query);
            const matched = terms.filter(t =>
                item.keywords.some(k => k.toLowerCase().includes(t)) ||
                item.tags.some(tag => tag.toLowerCase().includes(t))
            );
            if (matched.length) reasons.push(`Keywords: ${matched.join(', ')}`);
        }

        if (query.tags?.some(t => item.tags.includes(t))) {
            reasons.push(`Tags: ${query.tags.filter(t => item.tags.includes(t)).join(', ')}`);
        }

        if (query.moduleName && item.scope.modules?.includes(query.moduleName)) {
            reasons.push(`Module: ${query.moduleName}`);
        }

        return reasons.join('; ') || 'General relevance';
    }

    // ========================================================================
    // Pruning
    // ========================================================================

    private pruneStaleItems(): void {
        if (!this.index) return;

        const now = Date.now();
        const maxAge = this.config.maxUnusedAge;
        const before = this.index.items.length;

        this.index.items = this.index.items.filter(item => {
            const age = now - item.lastAccessed;
            return age < maxAge || item.source.method === 'user_provided';
        });

        if (this.index.items.length < before) {
            this.dirty = true;
        }
    }

    private pruneLowestScoring(): void {
        if (!this.index) return;

        const now = Date.now();
        const scored = this.index.items.map(item => ({
            item,
            score: this.pruneScore(item, now)
        }));
        scored.sort((a, b) => a.score - b.score);

        const removeCount = Math.ceil(this.index.items.length * 0.1);
        const toRemove = new Set(scored.slice(0, removeCount).map(s => s.item.id));

        for (const id of toRemove) {
            const item = this.itemById.get(id);
            if (item) this.removeFromIndices(item);
        }

        this.index.items = this.index.items.filter(i => !toRemove.has(i.id));
        this.dirty = true;
    }

    private pruneScore(item: KnowledgeItem, now: number): number {
        let score = item.confidence * 10 + item.useCount * 2;
        const daysSinceAccess = (now - item.lastAccessed) / (24 * 60 * 60 * 1000);
        score -= daysSinceAccess;
        if (item.source.method === 'user_provided') score += 20;
        return score;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private computeFingerprint(type: KnowledgeType, title: string, scope: KnowledgeScope): string {
        const normalizedTitle = title.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim();
        const scopeParts: string[] = [];
        if (scope.global) scopeParts.push('global');
        if (scope.modules?.length) scopeParts.push(`m:${[...scope.modules].sort().join(',')}`);
        if (scope.filePatterns?.length) scopeParts.push(`f:${[...scope.filePatterns].sort().join(',')}`);

        return crypto
            .createHash('sha256')
            .update(`${type}|${normalizedTitle}|${scopeParts.join('|')}`)
            .digest('hex')
            .slice(0, 16);
    }

    private createDefaultIndex(): KnowledgeIndex {
        return {
            version: 1,
            projectId: this.projectId,
            items: [],
            stats: { totalItems: 0, byType: {} as Record<KnowledgeType, number>, lastUpdated: Date.now() }
        };
    }

    private migrate(index: KnowledgeIndex): KnowledgeIndex {
        const migrated = { ...this.createDefaultIndex(), ...index };
        for (const item of migrated.items) {
            if (!item.fingerprint) {
                item.fingerprint = this.computeFingerprint(item.type, item.title, item.scope);
            }
        }
        return migrated;
    }

    private updateStats(): void {
        if (!this.index) return;
        const byType: Record<string, number> = {};
        for (const item of this.index.items) {
            byType[item.type] = (byType[item.type] || 0) + 1;
        }
        this.index.stats = {
            totalItems: this.index.items.length,
            byType: byType as Record<KnowledgeType, number>,
            lastUpdated: Date.now()
        };
    }

    // ========================================================================
    // File Locking
    // ========================================================================

    private async acquireLock(): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < this.LOCK_TIMEOUT_MS) {
            try {
                await fs.writeFile(
                    this.lockPath,
                    JSON.stringify({ pid: process.pid, time: Date.now() }),
                    { flag: 'wx' }
                );
                this.lockAcquired = true;
                return true;
            } catch (e: unknown) {
                if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
                    if (await this.isLockStale()) {
                        try { await fs.unlink(this.lockPath); } catch { /* ignore */ }
                        continue;
                    }
                    await new Promise(r => setTimeout(r, 100));
                } else {
                    throw e;
                }
            }
        }
        return false;
    }

    private async releaseLock(): Promise<void> {
        if (this.lockAcquired) {
            try { await fs.unlink(this.lockPath); } catch { /* ignore */ }
            this.lockAcquired = false;
        }
    }

    private async isLockStale(): Promise<boolean> {
        try {
            const content = await fs.readFile(this.lockPath, 'utf-8');
            const lock = JSON.parse(content);
            if (Date.now() - lock.time > 5 * 60 * 1000) return true;

            if (process.platform === 'win32') {
                const { spawnSync } = await import('child_process');
                const result = spawnSync('tasklist', ['/FI', `PID eq ${lock.pid}`, '/NH'], {
                    encoding: 'utf-8',
                    timeout: 2000
                });
                return !result.stdout.includes(lock.pid.toString());
            } else {
                try { process.kill(lock.pid, 0); return false; }
                catch { return true; }
            }
        } catch {
            return true;
        }
    }

    // ========================================================================
    // Public Accessors
    // ========================================================================

    getByType(type: KnowledgeType): KnowledgeItem[] {
        return this.index?.items.filter(i => i.type === type) ?? [];
    }

    getStats(): KnowledgeIndex['stats'] | null {
        if (!this.index) return null;
        this.updateStats();
        return this.index.stats;
    }

    getProjectId(): string {
        return this.projectId;
    }
}

// ============================================================================
// Factory
// ============================================================================

let globalStore: KnowledgeStore | null = null;

export function getKnowledgeStore(): KnowledgeStore | null {
    return globalStore;
}

export function createKnowledgeStore(
    projectRoot: string,
    bus: EventBus,
    config?: Partial<KnowledgeStoreConfig>
): KnowledgeStore {
    return new KnowledgeStore(projectRoot, bus, config);
}

export function setGlobalKnowledgeStore(store: KnowledgeStore): void {
    globalStore = store;
}
