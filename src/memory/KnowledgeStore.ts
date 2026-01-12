/**
 * KnowledgeStore - Persistent learned patterns for context-aware retrieval
 *
 * Stores knowledge learned from working with the project:
 * - Code patterns (naming conventions, module structures)
 * - Common lint fixes
 * - Testing patterns
 * - User preferences in code style
 * - Module relationships and dependencies
 *
 * Implements keyword-based retrieval with:
 * - Term frequency scoring on title, content, tags, and keywords
 * - Scope-based filtering (fail-closed: scoped items require matching context)
 * - Recency and usage boosting
 * - Glob pattern matching for file scopes via picomatch
 *
 * Knowledge is injected into agent prompts based on current context.
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

/**
 * A learned pattern/knowledge item
 */
export interface KnowledgeItem {
    /** Unique identifier */
    id: string;

    /**
     * Content-addressable fingerprint for duplicate detection.
     * Computed from: type + normalized title + scope (modules/filePatterns).
     * Two items with the same fingerprint are considered duplicates.
     */
    fingerprint: string;

    /** Type of knowledge */
    type: KnowledgeType;

    /** Brief title/summary */
    title: string;

    /** Full content/description */
    content: string;

    /** Tags for categorization and search */
    tags: string[];

    /** Relevance keywords for context matching */
    keywords: string[];

    /** Scope - where this knowledge applies */
    scope: KnowledgeScope;

    /** Source of this knowledge */
    source: KnowledgeSource;

    /** Confidence score (0-1) */
    confidence: number;

    /** Number of times this knowledge was useful */
    useCount: number;

    /** Last time this knowledge was accessed */
    lastAccessed: number;

    /** When this knowledge was created */
    created: number;

    /** When this knowledge was last updated */
    updated: number;
}

/**
 * Types of knowledge that can be stored
 */
export type KnowledgeType =
    | 'code_pattern'      // Coding conventions, patterns
    | 'lint_fix'          // Common lint error fixes
    | 'test_pattern'      // Testing approaches
    | 'module_info'       // Module-specific knowledge
    | 'dependency'        // Module dependencies and relationships
    | 'style_preference'  // User coding style preferences
    | 'workflow'          // Development workflow patterns
    | 'debug_solution'    // Solutions to debug scenarios
    | 'tool_usage'        // How to use specific tools effectively
    | 'project_context';  // General project context

/**
 * Scope where knowledge applies
 */
export interface KnowledgeScope {
    /** Apply to all projects */
    global: boolean;

    /** Specific project IDs */
    projectIds?: string[];

    /** File patterns (glob) */
    filePatterns?: string[];

    /** Module names */
    modules?: string[];
}

/**
 * Source of knowledge
 */
export interface KnowledgeSource {
    /** How was this knowledge acquired */
    method: 'extracted' | 'inferred' | 'user_provided' | 'tool_result';

    /** Session ID where it was learned */
    sessionId?: string;

    /** File path if extracted from code */
    filePath?: string;

    /** Tool that generated this knowledge */
    tool?: string;
}

/**
 * Result of knowledge search
 */
export interface KnowledgeSearchResult {
    /** The knowledge item */
    item: KnowledgeItem;

    /** Relevance score (0-1) */
    relevance: number;

    /** Why this item was matched */
    matchReason: string;
}

/**
 * Query for knowledge retrieval
 */
export interface KnowledgeQuery {
    /** Search text */
    query?: string;

    /** Filter by type */
    types?: KnowledgeType[];

    /** Filter by tags */
    tags?: string[];

    /** Current file context */
    filePath?: string;

    /** Current module context */
    moduleName?: string;

    /** Maximum results */
    maxResults?: number;

    /** Minimum confidence */
    minConfidence?: number;
}

/**
 * Configuration for KnowledgeStore
 */
export interface KnowledgeStoreConfig {
    /** Directory for knowledge files */
    knowledgeDir: string;

    /** Maximum items to store per project */
    maxItems: number;

    /** Minimum confidence for auto-extraction */
    minExtractionConfidence: number;

    /** Maximum age for unused items (ms) */
    maxUnusedAge: number;

    /** Enable auto-extraction from sessions */
    autoExtract: boolean;
}

/**
 * Knowledge index (persisted)
 */
export interface KnowledgeIndex {
    /** Version for migrations */
    version: number;

    /** Project ID */
    projectId: string;

    /** All knowledge items */
    items: KnowledgeItem[];

    /** Stats */
    stats: {
        totalItems: number;
        byType: Record<KnowledgeType, number>;
        lastUpdated: number;
    };
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_KNOWLEDGE_STORE_CONFIG: KnowledgeStoreConfig = {
    knowledgeDir: path.join(os.homedir(), '.gateflow'),
    maxItems: 500,
    minExtractionConfidence: 0.6,
    maxUnusedAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    autoExtract: true
};

// ============================================================================
// KnowledgeStore Implementation
// ============================================================================

export class KnowledgeStore {
    private config: KnowledgeStoreConfig;
    private projectId: string;
    private index: KnowledgeIndex | null = null;
    private knowledgePath: string;
    private lockPath: string;
    private dirty: boolean = false;
    private ioMutex = new AsyncMutex();
    private lockAcquired: boolean = false;
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DEBOUNCE_MS = 5000;
    private readonly LOCK_TIMEOUT_MS = 5000;

    constructor(
        private projectRoot: string,
        private bus: EventBus,
        config?: Partial<KnowledgeStoreConfig>
    ) {
        // Generate project ID from path
        this.projectId = crypto
            .createHash('md5')
            .update(path.resolve(projectRoot))
            .digest('hex')
            .slice(0, 12);

        this.config = { ...DEFAULT_KNOWLEDGE_STORE_CONFIG, ...config };
        this.knowledgePath = path.join(
            this.config.knowledgeDir,
            `${this.projectId}-knowledge.json`
        );
        // Use same lock file as MemoryManager for coordinated access
        this.lockPath = path.join(
            this.config.knowledgeDir,
            `${this.projectId}.lock`
        );
    }

    // ========================================================================
    // Load / Save
    // ========================================================================

    /**
     * Load knowledge index from disk
     * Uses AsyncMutex for intra-process safety
     */
    async load(): Promise<KnowledgeIndex> {
        return this.ioMutex.withLock(async () => {
            await fs.mkdir(this.config.knowledgeDir, { recursive: true });

            try {
                const content = await fs.readFile(this.knowledgePath, 'utf-8');
                this.index = JSON.parse(content) as KnowledgeIndex;
                this.index = this.migrate(this.index);

                // Enforce maxUnusedAge to prune stale items
                this.enforceMaxUnusedAge();

                return this.index;
            } catch {
                // Create new index
                this.index = this.createDefaultIndex();
                return this.index;
            }
        });
    }

    /**
     * Enforce maxUnusedAge by pruning items that haven't been accessed
     * User-provided items are exempt from age-based pruning
     */
    private enforceMaxUnusedAge(): void {
        if (!this.index) return;

        const now = Date.now();
        const maxAge = this.config.maxUnusedAge;
        const before = this.index.items.length;

        this.index.items = this.index.items.filter(item => {
            const age = now - item.lastAccessed;
            // Keep if: used recently OR user-provided (never auto-delete user input)
            return age < maxAge || item.source.method === 'user_provided';
        });

        if (this.index.items.length < before) {
            this.dirty = true;
            const pruned = before - this.index.items.length;
            this.bus.emit({
                type: 'status',
                phase: 'tool',
                label: `Pruned ${pruned} stale knowledge items (unused > ${Math.floor(maxAge / (24 * 60 * 60 * 1000))} days)`
            });
        }
    }

    /**
     * Save knowledge index to disk
     * Uses AsyncMutex for intra-process safety and file lock for inter-process safety
     */
    async save(): Promise<void> {
        return this.ioMutex.withLock(async () => {
            if (!this.index || !this.dirty) return;

            // Acquire file lock for inter-process safety - MUST succeed
            const acquired = await this.acquireLock();
            if (!acquired) {
                throw new Error(`Failed to acquire knowledge lock: ${this.lockPath}`);
            }

            try {
                // Update stats
                this.updateStats();

                // Atomic write
                const tempPath = `${this.knowledgePath}.${Date.now()}.tmp`;

                try {
                    await fs.writeFile(
                        tempPath,
                        JSON.stringify(this.index, null, 2),
                        'utf-8'
                    );
                    await fs.rename(tempPath, this.knowledgePath);
                    this.dirty = false;

                    this.bus.emit({
                        type: 'status',
                        phase: 'tool',
                        label: `Knowledge saved: ${this.index.items.length} items`
                    });
                } catch (error) {
                    try {
                        await fs.unlink(tempPath);
                    } catch {
                        // Temp file cleanup
                    }
                    throw error;
                }
            } finally {
                await this.releaseLock();
            }
        });
    }

    // ========================================================================
    // File Locking (Inter-Process Safety)
    // ========================================================================

    /**
     * Acquire lock for exclusive access
     * Uses same lock file as MemoryManager for coordinated access
     */
    private async acquireLock(): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < this.LOCK_TIMEOUT_MS) {
            try {
                // Try to create lock file (fails if exists)
                await fs.writeFile(
                    this.lockPath,
                    JSON.stringify({ pid: process.pid, time: Date.now(), owner: 'knowledge' }),
                    { flag: 'wx' }
                );
                this.lockAcquired = true;
                return true;
            } catch (error: unknown) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                    // Lock exists - check if stale
                    if (await this.isLockStale()) {
                        try {
                            await fs.unlink(this.lockPath);
                        } catch {
                            // Another process may have removed it
                        }
                        continue;
                    }
                    // Wait and retry
                    await new Promise(r => setTimeout(r, 100));
                } else {
                    throw error;
                }
            }
        }

        return false;
    }

    /**
     * Release lock
     */
    private async releaseLock(): Promise<void> {
        if (this.lockAcquired) {
            try {
                await fs.unlink(this.lockPath);
            } catch {
                // Lock file may have been removed externally - safe to ignore
            }
            this.lockAcquired = false;
        }
    }

    /**
     * Check if lock is stale (process died)
     */
    private async isLockStale(): Promise<boolean> {
        try {
            const content = await fs.readFile(this.lockPath, 'utf-8');
            const lock = JSON.parse(content);

            // Consider stale if > 5 minutes old
            if (Date.now() - lock.time > 5 * 60 * 1000) {
                return true;
            }

            if (process.platform === 'win32') {
                // Windows: Use tasklist to check if process exists
                try {
                    const { spawnSync } = await import('child_process');
                    const result = spawnSync('tasklist', ['/FI', `PID eq ${lock.pid}`, '/NH'], {
                        encoding: 'utf-8',
                        timeout: 2000
                    });
                    // If PID not found, tasklist returns "INFO: No tasks..."
                    return !result.stdout.includes(lock.pid.toString());
                } catch {
                    // If tasklist fails, fall back to time-based only
                    return false;
                }
            } else {
                // Unix: Use signal 0 test
                try {
                    process.kill(lock.pid, 0);
                    return false; // Process exists
                } catch {
                    return true; // Process doesn't exist
                }
            }
        } catch {
            return true;
        }
    }

    // ========================================================================
    // Knowledge Management
    // ========================================================================

    /**
     * Add a new knowledge item
     */
    addKnowledge(item: Omit<KnowledgeItem, 'id' | 'fingerprint' | 'created' | 'updated' | 'useCount' | 'lastAccessed'>): KnowledgeItem {
        if (!this.index) {
            throw new Error('KnowledgeStore not loaded');
        }

        const now = Date.now();

        // Compute fingerprint from semantic identity: type + normalized title + scope
        const fingerprint = this.computeFingerprint(item.type, item.title, item.scope);

        // Check for duplicate by fingerprint (exact match)
        const existing = this.findByFingerprint(fingerprint);
        if (existing) {
            // Merge with existing: update content but keep identity
            existing.content = item.content;
            existing.confidence = Math.max(existing.confidence, item.confidence);
            existing.tags = [...new Set([...existing.tags, ...item.tags])];
            existing.keywords = [...new Set([...existing.keywords, ...item.keywords])];
            existing.updated = now;
            this.dirty = true;
            return existing;
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

        // Enforce max items
        if (this.index.items.length >= this.config.maxItems) {
            this.pruneOldItems();
        }

        this.index.items.push(knowledge);
        this.dirty = true;

        this.bus.emit({
            type: 'status',
            phase: 'tool',
            label: `Learned: ${knowledge.title}`
        });

        return knowledge;
    }

    /**
     * Update an existing knowledge item
     */
    updateKnowledge(id: string, updates: Partial<KnowledgeItem>): KnowledgeItem | null {
        if (!this.index) return null;

        const item = this.index.items.find(i => i.id === id);
        if (!item) return null;

        Object.assign(item, updates, { updated: Date.now() });
        this.dirty = true;

        return item;
    }

    /**
     * Remove a knowledge item
     */
    removeKnowledge(id: string): boolean {
        if (!this.index) return false;

        const idx = this.index.items.findIndex(i => i.id === id);
        if (idx === -1) return false;

        this.index.items.splice(idx, 1);
        this.dirty = true;

        return true;
    }

    /**
     * Mark knowledge as used (increments use count)
     * Triggers debounced auto-save to persist usage tracking
     */
    markUsed(id: string): void {
        if (!this.index) return;

        const item = this.index.items.find(i => i.id === id);
        if (item) {
            item.useCount++;
            item.lastAccessed = Date.now();
            this.dirty = true;
            this.scheduleSave();
        }
    }

    /**
     * Schedule a debounced save operation
     * Prevents excessive writes when multiple markUsed calls happen in quick succession
     */
    private scheduleSave(): void {
        if (this.saveTimeout) return;  // Already scheduled

        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;
            if (this.dirty) {
                try {
                    await this.save();
                } catch (error) {
                    // Log but don't throw - this is a background save
                    console.error('Auto-save failed:', error);
                }
            }
        }, this.SAVE_DEBOUNCE_MS);
    }

    /**
     * Cancel any pending auto-save and save immediately if dirty
     * Call this before process exit to ensure data is persisted
     */
    async flush(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        if (this.dirty) {
            await this.save();
        }
    }

    // ========================================================================
    // Knowledge Retrieval
    // ========================================================================

    /**
     * Search for relevant knowledge
     */
    search(query: KnowledgeQuery): KnowledgeSearchResult[] {
        if (!this.index) return [];

        let candidates = [...this.index.items];

        // Filter by type
        if (query.types && query.types.length > 0) {
            candidates = candidates.filter(i => query.types!.includes(i.type));
        }

        // Filter by tags
        if (query.tags && query.tags.length > 0) {
            candidates = candidates.filter(i =>
                query.tags!.some(t => i.tags.includes(t))
            );
        }

        // Filter by confidence
        if (query.minConfidence !== undefined) {
            candidates = candidates.filter(i => i.confidence >= query.minConfidence!);
        }

        // Filter by scope
        candidates = candidates.filter(i => this.matchesScope(i.scope, query));

        // Score by relevance
        const scored: KnowledgeSearchResult[] = candidates.map(item => ({
            item,
            relevance: this.scoreRelevance(item, query),
            matchReason: this.getMatchReason(item, query)
        }));

        // Sort by relevance
        scored.sort((a, b) => b.relevance - a.relevance);

        // Limit results
        const maxResults = query.maxResults ?? 10;
        return scored.slice(0, maxResults);
    }

    /**
     * Get knowledge for injection into agent context
     */
    getContextKnowledge(
        filePath?: string,
        moduleName?: string,
        taskDescription?: string,
        maxTokens: number = 1000
    ): string {
        const results = this.search({
            query: taskDescription,
            filePath,
            moduleName,
            maxResults: 20,
            minConfidence: 0.5
        });

        if (results.length === 0) return '';

        // Build context string within token budget
        const parts: string[] = ['## Relevant Knowledge\n'];
        let estimatedTokens = 10;

        for (const result of results) {
            const itemText = this.formatKnowledgeItem(result.item);
            const itemTokens = estimateTokens(itemText);

            if (estimatedTokens + itemTokens > maxTokens) break;

            parts.push(itemText);
            estimatedTokens += itemTokens;

            // Mark as used
            this.markUsed(result.item.id);
        }

        return parts.join('\n');
    }

    /**
     * Get all knowledge of a specific type
     */
    getByType(type: KnowledgeType): KnowledgeItem[] {
        if (!this.index) return [];
        return this.index.items.filter(i => i.type === type);
    }

    /**
     * Get knowledge stats
     */
    getStats(): KnowledgeIndex['stats'] | null {
        if (!this.index) return null;
        this.updateStats();
        return this.index.stats;
    }

    // ========================================================================
    // Knowledge Extraction
    // ========================================================================

    /**
     * Extract patterns from a lint session
     */
    extractFromLintSession(
        sessionId: string,
        errors: Array<{ file: string; message: string; fix?: string }>,
        fixes: Array<{ file: string; original: string; fixed: string }>
    ): KnowledgeItem[] {
        const extracted: KnowledgeItem[] = [];

        // Group fixes by error type
        const fixPatterns = new Map<string, { count: number; examples: string[] }>();

        for (const error of errors) {
            // Extract error category from message
            const category = this.categorizeError(error.message);

            if (error.fix) {
                const pattern = fixPatterns.get(category) || { count: 0, examples: [] };
                pattern.count++;
                if (pattern.examples.length < 3) {
                    pattern.examples.push(`${error.message} -> ${error.fix}`);
                }
                fixPatterns.set(category, pattern);
            }
        }

        // Create knowledge items for common fix patterns
        for (const [category, pattern] of fixPatterns) {
            if (pattern.count >= 2) { // Only if pattern appears multiple times
                const item = this.addKnowledge({
                    type: 'lint_fix',
                    title: `Lint fix: ${category}`,
                    content: `Common fix pattern for "${category}" errors:\n${pattern.examples.join('\n')}`,
                    tags: ['lint', category.toLowerCase()],
                    keywords: category.split(/\s+/).filter(w => w.length > 3),
                    scope: { global: false, projectIds: [this.projectId] },
                    source: { method: 'extracted', sessionId },
                    confidence: Math.min(0.5 + pattern.count * 0.1, 0.95)
                });
                extracted.push(item);
            }
        }

        return extracted;
    }

    /**
     * Extract patterns from code generation
     */
    extractFromCodeGen(
        sessionId: string,
        generatedCode: string,
        context: { moduleName?: string; type: 'testbench' | 'module' | 'function' | 'fsm' }
    ): KnowledgeItem | null {
        // Extract patterns from generated code
        const patterns = this.analyzeCodePatterns(generatedCode);

        if (patterns.length === 0) return null;

        const item = this.addKnowledge({
            type: 'code_pattern',
            title: `${context.type} pattern${context.moduleName ? ` for ${context.moduleName}` : ''}`,
            content: `Code patterns used:\n${patterns.join('\n')}`,
            tags: [context.type, 'generated'],
            keywords: patterns.flatMap(p => p.split(/\s+/).filter(w => w.length > 3)),
            scope: {
                global: false,
                projectIds: [this.projectId],
                modules: context.moduleName ? [context.moduleName] : undefined
            },
            source: { method: 'extracted', sessionId },
            confidence: 0.7
        });

        return item;
    }

    /**
     * Learn from user correction
     */
    learnFromCorrection(
        original: string,
        corrected: string,
        context: { type: KnowledgeType; tags: string[] }
    ): KnowledgeItem {
        return this.addKnowledge({
            type: context.type,
            title: `User preference: ${context.tags.join(', ')}`,
            content: `Original: ${original}\nPreferred: ${corrected}`,
            tags: [...context.tags, 'user_correction'],
            keywords: corrected.split(/\s+/).filter(w => w.length > 3),
            scope: { global: false, projectIds: [this.projectId] },
            source: { method: 'user_provided' },
            confidence: 0.95 // High confidence for user corrections
        });
    }

    /**
     * Add module relationship knowledge
     */
    addModuleRelationship(
        moduleName: string,
        relationship: {
            dependencies: string[];
            dependents: string[];
            interfaces: string[];
        }
    ): KnowledgeItem {
        return this.addKnowledge({
            type: 'dependency',
            title: `Module relationships: ${moduleName}`,
            content: JSON.stringify(relationship, null, 2),
            tags: ['module', 'dependency', moduleName],
            keywords: [moduleName, ...relationship.dependencies, ...relationship.dependents],
            scope: { global: false, projectIds: [this.projectId], modules: [moduleName] },
            source: { method: 'inferred' },
            confidence: 0.8
        });
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private createDefaultIndex(): KnowledgeIndex {
        return {
            version: 1,
            projectId: this.projectId,
            items: [],
            stats: {
                totalItems: 0,
                byType: {} as Record<KnowledgeType, number>,
                lastUpdated: Date.now()
            }
        };
    }

    private migrate(index: KnowledgeIndex): KnowledgeIndex {
        const migrated = {
            ...this.createDefaultIndex(),
            ...index
        };

        // Migration: Add fingerprints to items that don't have them
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

    /**
     * Compute a content-addressable fingerprint for duplicate detection.
     * The fingerprint captures semantic identity: type + normalized title + scope constraints.
     * Items with the same fingerprint are considered duplicates regardless of content differences.
     */
    private computeFingerprint(type: KnowledgeType, title: string, scope: KnowledgeScope): string {
        // Normalize title: lowercase, collapse whitespace, remove punctuation
        const normalizedTitle = title
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .trim();

        // Build scope identity (sorted for determinism)
        const scopeParts: string[] = [];
        if (scope.global) {
            scopeParts.push('global');
        }
        if (scope.modules && scope.modules.length > 0) {
            scopeParts.push(`modules:${[...scope.modules].sort().join(',')}`);
        }
        if (scope.filePatterns && scope.filePatterns.length > 0) {
            scopeParts.push(`files:${[...scope.filePatterns].sort().join(',')}`);
        }

        const identity = `${type}|${normalizedTitle}|${scopeParts.join('|')}`;

        // Hash to fixed-length fingerprint
        return crypto
            .createHash('sha256')
            .update(identity)
            .digest('hex')
            .slice(0, 16);
    }

    /**
     * Find an existing item by fingerprint (exact match).
     * This replaces fuzzy title matching for more reliable duplicate detection.
     */
    private findByFingerprint(fingerprint: string): KnowledgeItem | undefined {
        if (!this.index) return undefined;
        return this.index.items.find(item => item.fingerprint === fingerprint);
    }

    /**
     * String similarity using Jaccard index (kept for potential future use)
     */
    private stringSimilarity(a: string, b: string): number {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();

        if (aLower === bLower) return 1;

        // Simple Jaccard similarity on words
        const aWords = new Set(aLower.split(/\s+/));
        const bWords = new Set(bLower.split(/\s+/));

        let intersection = 0;
        for (const word of aWords) {
            if (bWords.has(word)) intersection++;
        }

        const union = aWords.size + bWords.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    private matchesScope(scope: KnowledgeScope, query: KnowledgeQuery): boolean {
        // Global knowledge always matches
        if (scope.global) return true;

        // Check project match (always matches since we filter by project)
        if (scope.projectIds && !scope.projectIds.includes(this.projectId)) {
            return false;
        }

        // FAIL-CLOSED: If item is module-scoped but query has no module context, don't match
        // This prevents module-scoped knowledge from leaking into global queries
        if (scope.modules && scope.modules.length > 0) {
            if (!query.moduleName || !scope.modules.includes(query.moduleName)) {
                return false;
            }
        }

        // FAIL-CLOSED: If item is file-scoped but query has no file context, don't match
        // This prevents file-scoped knowledge from leaking into global queries
        if (scope.filePatterns && scope.filePatterns.length > 0) {
            if (!query.filePath) {
                return false;
            }
            const matches = scope.filePatterns.some(pattern =>
                this.matchGlob(query.filePath!, pattern)
            );
            if (!matches) return false;
        }

        return true;
    }

    /**
     * Match a file path against a glob pattern using picomatch
     * Normalizes path separators for cross-platform compatibility
     */
    private matchGlob(filePath: string, pattern: string): boolean {
        // Normalize path separators for cross-platform (Windows uses \, Unix uses /)
        const normalizedPath = filePath.replace(/\\/g, '/');
        const normalizedPattern = pattern.replace(/\\/g, '/');

        return picomatch.isMatch(normalizedPath, normalizedPattern, {
            dot: true,  // Match dotfiles
            nocase: process.platform === 'win32'  // Case-insensitive on Windows
        });
    }

    private scoreRelevance(item: KnowledgeItem, query: KnowledgeQuery): number {
        let score = 0;

        // Base confidence
        score += item.confidence * 0.3;

        // Text query matching
        if (query.query) {
            const queryTerms = query.query.toLowerCase().split(/\s+/);
            const itemText = `${item.title} ${item.content} ${item.tags.join(' ')} ${item.keywords.join(' ')}`.toLowerCase();

            let matchCount = 0;
            for (const term of queryTerms) {
                if (itemText.includes(term)) matchCount++;
            }
            score += (matchCount / queryTerms.length) * 0.4;
        }

        // Tag matching
        if (query.tags && query.tags.length > 0) {
            const tagOverlap = query.tags.filter(t => item.tags.includes(t)).length;
            score += (tagOverlap / query.tags.length) * 0.2;
        }

        // Recency boost (more recent = higher score)
        const daysSinceAccess = (Date.now() - item.lastAccessed) / (24 * 60 * 60 * 1000);
        score += Math.max(0, 0.1 - daysSinceAccess * 0.001);

        // Usage boost
        score += Math.min(item.useCount * 0.02, 0.1);

        return Math.min(score, 1);
    }

    private getMatchReason(item: KnowledgeItem, query: KnowledgeQuery): string {
        const reasons: string[] = [];

        if (query.query) {
            const queryTerms = query.query.toLowerCase().split(/\s+/);
            const matchedTerms = queryTerms.filter(term =>
                item.keywords.some(k => k.toLowerCase().includes(term)) ||
                item.tags.some(t => t.toLowerCase().includes(term))
            );
            if (matchedTerms.length > 0) {
                reasons.push(`Keywords: ${matchedTerms.join(', ')}`);
            }
        }

        if (query.tags && query.tags.some(t => item.tags.includes(t))) {
            reasons.push(`Tags: ${query.tags.filter(t => item.tags.includes(t)).join(', ')}`);
        }

        if (query.moduleName && item.scope.modules?.includes(query.moduleName)) {
            reasons.push(`Module: ${query.moduleName}`);
        }

        return reasons.join('; ') || 'General relevance';
    }

    private formatKnowledgeItem(item: KnowledgeItem): string {
        return `### ${item.title}\n${item.content}\n`;
    }

    private categorizeError(message: string): string {
        // Categorize lint errors by common patterns
        const categories = [
            { pattern: /unused/i, category: 'Unused signal' },
            { pattern: /width mismatch/i, category: 'Width mismatch' },
            { pattern: /undeclared|undefined/i, category: 'Undeclared identifier' },
            { pattern: /type mismatch/i, category: 'Type mismatch' },
            { pattern: /sensitivity/i, category: 'Sensitivity list' },
            { pattern: /blocking.*non-blocking/i, category: 'Assignment style' },
            { pattern: /latch/i, category: 'Inferred latch' },
            { pattern: /clock/i, category: 'Clock issue' },
            { pattern: /reset/i, category: 'Reset issue' }
        ];

        for (const { pattern, category } of categories) {
            if (pattern.test(message)) return category;
        }

        return 'Other';
    }

    private analyzeCodePatterns(code: string): string[] {
        const patterns: string[] = [];

        // Detect common patterns
        if (/always_ff\s*@\s*\(posedge\s+clk/.test(code)) {
            patterns.push('Uses always_ff with positive edge clock');
        }
        if (/always_comb/.test(code)) {
            patterns.push('Uses always_comb for combinational logic');
        }
        if (/if\s*\(!?rst_n\)/.test(code) || /if\s*\(rst\)/.test(code)) {
            patterns.push('Uses synchronous reset');
        }
        if (/typedef\s+enum/.test(code)) {
            patterns.push('Uses typedef enum for state machines');
        }
        if (/case\s*\(state\)/.test(code)) {
            patterns.push('Uses case statement for FSM');
        }
        if (/`include/.test(code)) {
            patterns.push('Uses include files');
        }
        if (/import\s+\w+::\*/.test(code)) {
            patterns.push('Uses package imports');
        }

        return patterns;
    }

    private pruneOldItems(): void {
        if (!this.index) return;

        const now = Date.now();

        // Sort by score (lower = more likely to prune)
        const scored = this.index.items.map(item => ({
            item,
            score: this.pruneScore(item, now)
        }));

        scored.sort((a, b) => a.score - b.score);

        // Remove bottom 10%
        const removeCount = Math.ceil(this.index.items.length * 0.1);
        const toRemove = new Set(scored.slice(0, removeCount).map(s => s.item.id));

        this.index.items = this.index.items.filter(i => !toRemove.has(i.id));
        this.dirty = true;
    }

    private pruneScore(item: KnowledgeItem, now: number): number {
        // Higher score = keep, lower score = prune
        let score = 0;

        // Confidence
        score += item.confidence * 10;

        // Use count
        score += item.useCount * 2;

        // Recency
        const daysSinceAccess = (now - item.lastAccessed) / (24 * 60 * 60 * 1000);
        score -= daysSinceAccess;

        // User-provided knowledge gets bonus
        if (item.source.method === 'user_provided') {
            score += 20;
        }

        return score;
    }
}

// ============================================================================
// Singleton Management
// ============================================================================

let globalKnowledgeStore: KnowledgeStore | null = null;

/**
 * Get the global KnowledgeStore instance
 */
export function getKnowledgeStore(): KnowledgeStore | null {
    return globalKnowledgeStore;
}

/**
 * Create a new KnowledgeStore
 */
export function createKnowledgeStore(
    projectRoot: string,
    bus: EventBus,
    config?: Partial<KnowledgeStoreConfig>
): KnowledgeStore {
    return new KnowledgeStore(projectRoot, bus, config);
}

/**
 * Set the global KnowledgeStore instance
 */
export function setGlobalKnowledgeStore(store: KnowledgeStore): void {
    globalKnowledgeStore = store;
}
