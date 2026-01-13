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

    /**
     * If true, include items with scope mismatches but apply score penalty.
     * This allows broader searches while still preferring exact matches.
     *
     * Default: false (strict scope matching)
     */
    relaxedScope?: boolean;
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

    // Windows lock check cache (Bug 1.4 fix)
    private lockCheckCache?: {
        pid: number;
        isAlive: boolean;
        time: number;
    };

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
            } catch (error) {
                // Bug 1.3 fix: Distinguish between error types
                const errCode = (error as NodeJS.ErrnoException).code;

                // Case 1: File doesn't exist - this is fine on first run
                if (errCode === 'ENOENT') {
                    this.index = this.createDefaultIndex();
                    this.clearAllIndices();
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

        // Bug 1.2 fix: Recalculate avgDocLength after removal
        const n = this.docLengths.size;
        if (n > 0) {
            let totalLength = 0;
            for (const len of this.docLengths.values()) {
                totalLength += len;
            }
            this.avgDocLength = totalLength / n;
        } else {
            this.avgDocLength = 0;
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
            // Bug 1.1 fix: Check if content changed and rebuild indices
            const contentChanged = existing.content !== item.content ||
                                   !this.arraysEqual(existing.tags, item.tags) ||
                                   !this.arraysEqual(existing.keywords, item.keywords);

            if (contentChanged) {
                this.removeFromIndices(existing);
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
                this.addToIndices(existing);
            }

            this.dirty = true;
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

        // Score with scope multiplier
        const results: KnowledgeSearchResult[] = [];

        for (const item of candidates) {
            // Use score-based scope matching
            const scopeScore = this.matchesScopeWithScore(item.scope, query);
            if (scopeScore === 0) {
                continue;  // Completely excluded (strict mode or project mismatch)
            }

            // Calculate base score
            const baseScore = queryTerms.length > 0
                ? this.scoreBM25(item, queryTerms)
                : this.scoreBasic(item);

            // Apply scope multiplier
            const finalScore = baseScore * scopeScore;

            results.push({
                item,
                relevance: finalScore,
                matchReason: this.getMatchReason(item, query, scopeScore)
            });
        }

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
    // Scope Matching
    // ========================================================================

    /**
     * Check if item scope matches query, returning a score multiplier.
     *
     * @param scope - Item's scope constraints
     * @param query - Query parameters
     * @returns Score multiplier: 1.0 for full match, 0.0-0.9 for partial, 0 for no match
     */
    private matchesScopeWithScore(scope: KnowledgeScope, query: KnowledgeQuery): number {
        // Global scope always matches fully
        if (scope.global) {
            return 1.0;
        }

        // Project scope check - always strict (no relaxation for wrong project)
        if (scope.projectIds?.length && !scope.projectIds.includes(this.projectId)) {
            return 0;  // Different project, exclude completely
        }

        let scoreMultiplier = 1.0;

        // File pattern check
        if (scope.filePatterns?.length) {
            if (!query.filePath) {
                // No file context provided
                if (query.relaxedScope) {
                    scoreMultiplier *= 0.5;  // 50% penalty
                } else {
                    return 0;  // Strict mode: exclude
                }
            } else {
                // Check if file matches any pattern
                const normalizedPath = query.filePath.replace(/\\/g, '/');
                const matches = scope.filePatterns.some(p =>
                    picomatch.isMatch(normalizedPath, p.replace(/\\/g, '/'), {
                        dot: true,
                        nocase: process.platform === 'win32'
                    })
                );

                if (!matches) {
                    if (query.relaxedScope) {
                        scoreMultiplier *= 0.3;  // 70% penalty for wrong file
                    } else {
                        return 0;
                    }
                }
            }
        }

        // Module scope check
        if (scope.modules?.length) {
            if (!query.moduleName) {
                // No module context provided
                if (query.relaxedScope) {
                    scoreMultiplier *= 0.5;  // 50% penalty
                } else {
                    return 0;  // Strict mode: exclude
                }
            } else if (!scope.modules.includes(query.moduleName)) {
                // Wrong module
                if (query.relaxedScope) {
                    scoreMultiplier *= 0.3;  // 70% penalty
                } else {
                    return 0;
                }
            }
            // Exact module match: no penalty (multiplier stays at current value)
        }

        return scoreMultiplier;
    }

    private getMatchReason(item: KnowledgeItem, query: KnowledgeQuery, scopeScore = 1.0): string {
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

        // Add scope penalty indication
        if (scopeScore < 1.0 && scopeScore > 0) {
            const penaltyPercent = Math.round((1 - scopeScore) * 100);
            reasons.push(`Scope penalty: -${penaltyPercent}%`);
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
    // Knowledge Extraction
    // ========================================================================

    /**
     * Extract knowledge from lint session - learns from repeated error patterns
     *
     * @param sessionId Unique session identifier
     * @param errors Lint errors encountered
     * @param fixes Applied fixes (original/fixed pairs)
     * @returns Array of extracted knowledge items
     */
    extractFromLintSession(
        sessionId: string,
        errors: Array<{ file: string; message: string; fix?: string }>,
        fixes: Array<{ file: string; original: string; fixed: string }>
    ): KnowledgeItem[] {
        const extracted: KnowledgeItem[] = [];

        // Group errors by message pattern (ignore file-specific details)
        const errorPatterns = new Map<string, { count: number; files: Set<string>; fix?: string }>();

        for (const error of errors) {
            // Normalize message: remove line numbers, file paths, and identifiers
            const normalized = this.normalizeErrorMessage(error.message);
            const existing = errorPatterns.get(normalized);

            if (existing) {
                existing.count++;
                existing.files.add(error.file);
                if (error.fix && !existing.fix) {
                    existing.fix = error.fix;
                }
            } else {
                errorPatterns.set(normalized, {
                    count: 1,
                    files: new Set([error.file]),
                    fix: error.fix
                });
            }
        }

        // Extract patterns that appear multiple times
        for (const [pattern, data] of errorPatterns) {
            if (data.count < 2) continue;

            // Calculate confidence based on frequency
            const confidence = Math.min(0.5 + (data.count * 0.1), 0.9);

            const item = this.addKnowledge({
                type: 'lint_fix',
                title: `Lint pattern: ${pattern.slice(0, 50)}`,
                content: data.fix
                    ? `Error: ${pattern}\n\nSuggested fix: ${data.fix}`
                    : `Common error: ${pattern}\n\nOccurrences: ${data.count}`,
                tags: ['lint', 'error-pattern'],
                keywords: this.extractKeywordsFromError(pattern),
                scope: {
                    global: false,
                    projectIds: [this.projectId],
                    filePatterns: this.inferFilePatterns(data.files)
                },
                source: {
                    method: 'extracted',
                    sessionId,
                    tool: 'lint'
                },
                confidence
            });

            extracted.push(item);
        }

        // Learn from fix pairs
        for (const fix of fixes) {
            const diffPattern = this.analyzeDiff(fix.original, fix.fixed);
            if (!diffPattern) continue;

            const item = this.addKnowledge({
                type: 'lint_fix',
                title: `Fix pattern: ${diffPattern.description}`,
                content: `Before:\n\`\`\`\n${fix.original.slice(0, 200)}\n\`\`\`\n\nAfter:\n\`\`\`\n${fix.fixed.slice(0, 200)}\n\`\`\``,
                tags: ['lint', 'fix', ...diffPattern.tags],
                keywords: diffPattern.keywords,
                scope: {
                    global: false,
                    projectIds: [this.projectId]
                },
                source: {
                    method: 'extracted',
                    sessionId,
                    filePath: fix.file,
                    tool: 'lint'
                },
                confidence: 0.75
            });

            extracted.push(item);
        }

        if (extracted.length > 0) {
            this.scheduleSave();
        }

        return extracted;
    }

    /**
     * Extract knowledge from code generation - learns patterns from generated code
     *
     * @param sessionId Unique session identifier
     * @param code Generated code content
     * @param metadata Code metadata (type, module name, etc.)
     * @returns Extracted knowledge item or null
     */
    extractFromCodeGen(
        sessionId: string,
        code: string,
        metadata: {
            moduleName?: string;
            type: 'testbench' | 'module' | 'function' | 'fsm' | 'package';
            description?: string;
        }
    ): KnowledgeItem | null {
        // Detect pattern type based on content
        const patternInfo = this.analyzeGeneratedCode(code, metadata.type);
        if (!patternInfo) return null;

        const item = this.addKnowledge({
            type: 'code_pattern',
            title: `${metadata.type} pattern: ${patternInfo.name}`,
            content: patternInfo.summary + (metadata.description ? `\n\n${metadata.description}` : ''),
            tags: ['generated', metadata.type, ...patternInfo.tags],
            keywords: patternInfo.keywords,
            scope: {
                global: false,
                projectIds: [this.projectId],
                modules: metadata.moduleName ? [metadata.moduleName] : undefined
            },
            source: {
                method: 'extracted',
                sessionId,
                tool: 'codegen'
            },
            confidence: 0.7
        });

        this.scheduleSave();
        return item;
    }

    /**
     * Learn from user corrections - highest confidence knowledge source
     *
     * @param original Original content before correction
     * @param corrected Corrected content
     * @param metadata Correction metadata
     * @returns Extracted knowledge item
     */
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
        // Analyze the correction to determine type
        const correctionType = metadata.type ?? this.detectCorrectionType(original, corrected);
        const diffAnalysis = this.analyzeDiff(original, corrected);

        const item = this.addKnowledge({
            type: correctionType,
            title: `User preference: ${diffAnalysis?.description ?? 'style correction'}`,
            content: `Before:\n\`\`\`\n${original.slice(0, 300)}\n\`\`\`\n\nAfter:\n\`\`\`\n${corrected.slice(0, 300)}\n\`\`\``,
            tags: ['user-correction', ...(metadata.tags ?? []), ...(diffAnalysis?.tags ?? [])],
            keywords: diffAnalysis?.keywords ?? [],
            scope: {
                global: false,
                projectIds: [this.projectId],
                modules: metadata.moduleName ? [metadata.moduleName] : undefined,
                filePatterns: metadata.filePath ? [this.toGlobPattern(metadata.filePath)] : undefined
            },
            source: {
                method: 'user_provided',
                filePath: metadata.filePath
            },
            confidence: 0.95 // High confidence for user corrections
        });

        this.scheduleSave();
        return item;
    }

    // ========================================================================
    // Knowledge Extraction Helpers
    // ========================================================================

    private normalizeErrorMessage(message: string): string {
        return message
            .replace(/\b\d+\b/g, 'N')                    // Replace numbers
            .replace(/'[^']+'/g, "'ID'")                 // Replace quoted identifiers
            .replace(/"[^"]+"/g, '"ID"')                 // Replace double-quoted identifiers
            .replace(/\b[a-zA-Z_]\w*\b(?=\s+is\b)/g, 'ID') // Replace "X is" patterns
            .replace(/:\s*\d+/g, ':N')                   // Replace line numbers
            .replace(/\s+/g, ' ')                        // Normalize whitespace
            .trim();
    }

    private extractKeywordsFromError(message: string): string[] {
        const keywords: string[] = [];

        // Extract HDL-specific keywords
        const hdlKeywords = message.match(/\b(module|interface|signal|wire|reg|logic|port|assign|always|process|clk|reset|rst)\b/gi);
        if (hdlKeywords) {
            keywords.push(...hdlKeywords.map(k => k.toLowerCase()));
        }

        // Extract error type keywords
        const errorTypes = message.match(/\b(unused|undeclared|undriven|missing|syntax|type|width|mismatch)\b/gi);
        if (errorTypes) {
            keywords.push(...errorTypes.map(k => k.toLowerCase()));
        }

        return [...new Set(keywords)];
    }

    private inferFilePatterns(files: Set<string>): string[] | undefined {
        if (files.size === 0) return undefined;
        if (files.size > 5) return undefined; // Too many files, don't scope

        // Try to find common directory pattern
        const dirs = [...files].map(f => path.dirname(f));
        const commonDir = this.findCommonPrefix(dirs);

        if (commonDir && commonDir !== '.') {
            return [`${commonDir}/**/*.sv`];
        }

        return undefined;
    }

    private findCommonPrefix(paths: string[]): string {
        if (paths.length === 0) return '';
        if (paths.length === 1) return paths[0];

        const sorted = [...paths].sort();
        const first = sorted[0];
        const last = sorted[sorted.length - 1];

        let i = 0;
        while (i < first.length && first[i] === last[i]) {
            i++;
        }

        const common = first.slice(0, i);
        // Return up to last path separator
        const lastSep = Math.max(common.lastIndexOf('/'), common.lastIndexOf('\\'));
        return lastSep > 0 ? common.slice(0, lastSep) : common;
    }

    private analyzeDiff(
        original: string,
        corrected: string
    ): { description: string; tags: string[]; keywords: string[] } | null {
        const origLines = original.split('\n');
        const corrLines = corrected.split('\n');

        // Simple diff analysis
        const tags: string[] = [];
        const keywords: string[] = [];
        let description = 'code change';

        // Check for always block type changes
        if (/always\s+@/.test(original) && /always_ff|always_comb/.test(corrected)) {
            tags.push('always-block', 'sv2k');
            keywords.push('always', 'always_ff', 'always_comb');
            description = 'always to always_ff/always_comb';
        }

        // Check for reset pattern changes
        if (/if\s*\(\s*!?\s*(rst|reset)/i.test(corrected) && !/if\s*\(\s*!?\s*(rst|reset)/i.test(original)) {
            tags.push('reset', 'synchronous');
            keywords.push('reset', 'rst');
            description = 'added reset handling';
        }

        // Check for naming convention changes
        const origIds = original.match(/\b[a-z][a-zA-Z0-9_]*\b/g) ?? [];
        const corrIds = corrected.match(/\b[a-z][a-zA-Z0-9_]*\b/g) ?? [];
        if (origIds.length > 0 && corrIds.length > 0) {
            const origStyle = this.detectNamingStyle(origIds);
            const corrStyle = this.detectNamingStyle(corrIds);
            if (origStyle !== corrStyle) {
                tags.push('naming', corrStyle);
                keywords.push('naming', 'convention', corrStyle);
                description = `naming: ${origStyle} to ${corrStyle}`;
            }
        }

        // Check for whitespace/formatting changes
        if (original.replace(/\s/g, '') === corrected.replace(/\s/g, '')) {
            tags.push('formatting', 'whitespace');
            keywords.push('format', 'indent');
            description = 'formatting/whitespace';
        }

        // Check for comment additions
        if (corrected.includes('//') && !original.includes('//')) {
            tags.push('documentation', 'comments');
            keywords.push('comment', 'documentation');
            description = 'added comments';
        }

        if (tags.length === 0) {
            // Generic change
            tags.push('code-change');
            const lineDiff = Math.abs(origLines.length - corrLines.length);
            if (lineDiff > 5) {
                description = lineDiff > origLines.length ? 'code expansion' : 'code reduction';
            }
        }

        return { description, tags, keywords };
    }

    private detectNamingStyle(identifiers: string[]): string {
        const sample = identifiers.slice(0, 20);
        let snakeCount = 0;
        let camelCount = 0;

        for (const id of sample) {
            if (id.includes('_')) snakeCount++;
            if (/[a-z][A-Z]/.test(id)) camelCount++;
        }

        if (snakeCount > camelCount * 2) return 'snake_case';
        if (camelCount > snakeCount * 2) return 'camelCase';
        return 'mixed';
    }

    private analyzeGeneratedCode(
        code: string,
        type: string
    ): { name: string; summary: string; tags: string[]; keywords: string[] } | null {
        const tags: string[] = [];
        const keywords: string[] = [];
        let name = type;
        let summary = '';

        if (type === 'fsm') {
            // Detect FSM states
            const stateMatch = code.match(/typedef\s+enum[^{]*\{([^}]+)\}/);
            if (stateMatch) {
                const states = stateMatch[1].split(',').map(s => s.trim().split(/\s/)[0]);
                name = `FSM with ${states.length} states`;
                summary = `State machine with states: ${states.slice(0, 5).join(', ')}${states.length > 5 ? '...' : ''}`;
                tags.push('fsm', 'state-machine');
                keywords.push('fsm', 'state', 'enum', ...states.slice(0, 5).map(s => s.toLowerCase()));
            }
        }

        if (type === 'testbench') {
            // Detect testbench patterns
            tags.push('testbench', 'verification');
            keywords.push('testbench', 'tb', 'dut');

            if (/\$dumpfile/.test(code)) {
                tags.push('vcd');
                keywords.push('vcd', 'waveform');
            }

            if (/class\s+\w+\s+extends/.test(code)) {
                tags.push('uvm-style');
                keywords.push('class', 'uvm');
            }

            const dutMatch = code.match(/(\w+)\s+(?:dut|DUT|uut|UUT)\s*\(/);
            if (dutMatch) {
                name = `Testbench for ${dutMatch[1]}`;
                summary = `Testbench instantiating ${dutMatch[1]}`;
            } else {
                summary = 'SystemVerilog testbench';
            }
        }

        if (type === 'module') {
            const moduleMatch = code.match(/module\s+(\w+)/);
            if (moduleMatch) {
                name = moduleMatch[1];
                summary = `Module ${moduleMatch[1]}`;
            }

            // Detect module features
            if (/always_ff/.test(code)) {
                tags.push('sequential');
                keywords.push('always_ff', 'sequential', 'clk');
            }
            if (/always_comb/.test(code)) {
                tags.push('combinational');
                keywords.push('always_comb', 'combinational');
            }
            if (/interface\s+\w+/.test(code)) {
                tags.push('interface');
                keywords.push('interface');
            }
        }

        if (type === 'package') {
            const pkgMatch = code.match(/package\s+(\w+)/);
            if (pkgMatch) {
                name = pkgMatch[1];
                summary = `Package ${pkgMatch[1]}`;
            }
            tags.push('package');
            keywords.push('package', 'typedef', 'parameter');
        }

        if (tags.length === 0) {
            return null; // Nothing interesting to extract
        }

        return { name, summary, tags, keywords };
    }

    private detectCorrectionType(original: string, corrected: string): KnowledgeType {
        // Check for style/formatting changes
        if (original.replace(/\s/g, '') === corrected.replace(/\s/g, '')) {
            return 'style_preference';
        }

        // Check for code pattern changes (always blocks, etc.)
        if (/always_ff|always_comb|always_latch/i.test(corrected) !==
            /always_ff|always_comb|always_latch/i.test(original)) {
            return 'code_pattern';
        }

        // Check for reset handling changes
        if (/\b(rst|reset)\b/i.test(corrected) !== /\b(rst|reset)\b/i.test(original)) {
            return 'code_pattern';
        }

        // Default to style preference
        return 'style_preference';
    }

    private toGlobPattern(filePath: string): string {
        // Convert a specific file path to a glob pattern
        const ext = path.extname(filePath);
        const dir = path.dirname(filePath);
        return `${dir}/**/*${ext}`;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        const sorted1 = [...a].sort();
        const sorted2 = [...b].sort();
        return sorted1.every((v, i) => v === sorted2[i]);
    }

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
                    // Lock exists - check if stale and get lock info for verification
                    const staleInfo = await this.getStaleInfo();
                    if (staleInfo.isStale) {
                        // TOCTOU-safe: verify lock content hasn't changed before deleting
                        try {
                            // Re-read lock to verify it's the same one we checked
                            const currentContent = await fs.readFile(this.lockPath, 'utf-8');
                            if (currentContent === staleInfo.content) {
                                // Same lock - safe to delete and acquire
                                await fs.unlink(this.lockPath);
                                await fs.writeFile(
                                    this.lockPath,
                                    JSON.stringify({ pid: process.pid, time: Date.now() }),
                                    { flag: 'wx' }
                                );
                                this.lockAcquired = true;
                                return true;
                            }
                            // Lock changed - another process replaced it, retry
                        } catch (innerError: any) {
                            // Another process got it first - continue retrying
                            if (innerError.code !== 'EEXIST' && innerError.code !== 'ENOENT') {
                                throw innerError;
                            }
                        }
                    }
                    // Wait and retry
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
            this.lockCheckCache = undefined;  // Bug 1.4 fix: Clear cache on lock release
        }
    }

    /**
     * Get stale lock info for TOCTOU-safe deletion.
     * Returns both staleness status AND original content for verification.
     * This allows the caller to verify the lock hasn't changed before deleting.
     */
    private async getStaleInfo(): Promise<{ isStale: boolean; content: string }> {
        try {
            const content = await fs.readFile(this.lockPath, 'utf-8');
            
            // Try to parse - if it fails, we still preserve content for TOCTOU check
            let lock: { pid: number; time: number };
            try {
                lock = JSON.parse(content);
            } catch (parseError) {
                // Corrupted/partial JSON - can't determine staleness, but preserve content
                // for TOCTOU verification (caller can check if file changed)
                return { isStale: false, content };
            }

            // Time-based check (5 minutes)
            if (Date.now() - lock.time > 5 * 60 * 1000) {
                return { isStale: true, content };
            }

            // Bug 1.4 fix: Cache Windows lock check result
            if (process.platform === 'win32') {
                // Check if we have a recent cache for this PID
                const cacheAge = this.lockCheckCache ? Date.now() - this.lockCheckCache.time : Infinity;
                const cacheHit = this.lockCheckCache &&
                    this.lockCheckCache.pid === lock.pid &&
                    cacheAge < 1000;  // 1 second cache

                if (cacheHit && this.lockCheckCache) {
                    const isStale = !this.lockCheckCache.isAlive;
                    return { isStale, content };
                }

                // Cache miss or expired - do the slow check
                const { spawnSync } = await import('child_process');
                const result = spawnSync('tasklist', ['/FI', `PID eq ${lock.pid}`, '/NH'], {
                    encoding: 'utf-8',
                    timeout: 2000
                });
                const isAlive = result.stdout.includes(lock.pid.toString());

                // Cache the result
                this.lockCheckCache = {
                    pid: lock.pid,
                    isAlive,
                    time: Date.now()
                };

                return { isStale: !isAlive, content };
            } else {
                // Unix: Fast signal check, no caching needed
                try {
                    process.kill(lock.pid, 0);
                    return { isStale: false, content }; // Process exists
                } catch {
                    return { isStale: true, content }; // Process doesn't exist
                }
            }
        } catch (error: any) {
            // Only consider stale if file doesn't exist (already deleted)
            if (error.code === 'ENOENT') {
                return { isStale: true, content: '' };
            }
            // For permission issues, etc., be conservative
            // Return empty content since we couldn't read it for TOCTOU check
            return { isStale: false, content: '' };
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
        return this.itemById.get(id);
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

