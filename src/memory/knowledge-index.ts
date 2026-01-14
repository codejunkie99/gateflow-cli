/**
 * KnowledgeStore Indexing + Search
 *
 * Encapsulates in-memory indices and BM25 scoring for fast retrieval.
 */

import picomatch from 'picomatch';
import type {
    KnowledgeItem,
    KnowledgeQuery,
    KnowledgeScope,
    KnowledgeSearchResult
} from './knowledge-types.js';
import { BM25_B, BM25_K1 } from './knowledge-types.js';

export class KnowledgeIndexManager {
    private itemById = new Map<string, KnowledgeItem>();
    private itemByFingerprint = new Map<string, KnowledgeItem>();
    private invertedIndex = new Map<string, Set<string>>(); // term -> item IDs
    private docLengths = new Map<string, number>(); // item ID -> word count
    private termDocFreq = new Map<string, number>(); // term -> doc count
    private avgDocLength = 0;

    constructor(private projectId: string) {}

    clear(): void {
        this.itemById.clear();
        this.itemByFingerprint.clear();
        this.invertedIndex.clear();
        this.docLengths.clear();
        this.termDocFreq.clear();
        this.avgDocLength = 0;
    }

    rebuild(items: KnowledgeItem[]): void {
        this.clear();
        if (items.length === 0) return;

        let totalLength = 0;

        for (const item of items) {
            this.itemById.set(item.id, item);
            if (item.fingerprint) {
                this.itemByFingerprint.set(item.fingerprint, item);
            }

            const tokens = this.tokenizeItem(item);
            this.docLengths.set(item.id, tokens.length);
            totalLength += tokens.length;

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

        this.avgDocLength = totalLength / items.length;
    }

    add(item: KnowledgeItem, totalItemCount: number): void {
        this.itemById.set(item.id, item);
        this.itemByFingerprint.set(item.fingerprint, item);

        const tokens = this.tokenizeItem(item);
        this.docLengths.set(item.id, tokens.length);

        if (totalItemCount > 0) {
            this.avgDocLength = ((this.avgDocLength * (totalItemCount - 1)) + tokens.length) / totalItemCount;
        } else {
            this.avgDocLength = tokens.length;
        }

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

    remove(item: KnowledgeItem): void {
        this.itemById.delete(item.id);
        this.itemByFingerprint.delete(item.fingerprint);

        const tokens = this.tokenizeItem(item);
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

    getById(id: string): KnowledgeItem | undefined {
        return this.itemById.get(id);
    }

    getByFingerprint(fingerprint: string): KnowledgeItem | undefined {
        return this.itemByFingerprint.get(fingerprint);
    }

    search(items: KnowledgeItem[], query: KnowledgeQuery): KnowledgeSearchResult[] {
        if (items.length === 0) return [];

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
            candidates = [...items];
        }

        if (query.types?.length) {
            candidates = candidates.filter(i => query.types!.includes(i.type));
        }
        if (query.tags?.length) {
            candidates = candidates.filter(i => query.tags!.some(t => i.tags.includes(t)));
        }
        if (query.minConfidence !== undefined) {
            candidates = candidates.filter(i => i.confidence >= query.minConfidence!);
        }

        const results: KnowledgeSearchResult[] = [];

        for (const item of candidates) {
            const scopeScore = this.matchesScopeWithScore(item.scope, query);
            if (scopeScore === 0) {
                continue;
            }

            const baseScore = queryTerms.length > 0
                ? this.scoreBM25(item, queryTerms)
                : this.scoreBasic(item);
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

    private tokenizeItem(item: KnowledgeItem): string[] {
        const text = `${item.title} ${item.content} ${item.tags.join(' ')} ${item.keywords.join(' ')}`;
        return text
            .toLowerCase()
            .split(/\W+/)
            .filter(t => t.length > 2);
    }

    private tokenizeQuery(text: string): string[] {
        return text.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    }

    private scoreBM25(item: KnowledgeItem, queryTerms: string[]): number {
        const docLen = this.docLengths.get(item.id) || 1;
        const N = this.docLengths.size || 1;
        const itemTokens = this.tokenizeItem(item);

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

        const normalized = Math.min(score / 10, 1);
        return normalized * 0.7 + item.confidence * 0.3;
    }

    private scoreBasic(item: KnowledgeItem): number {
        const daysSinceAccess = (Date.now() - item.lastAccessed) / (24 * 60 * 60 * 1000);
        const recency = Math.max(0, 0.2 - daysSinceAccess * 0.01);
        return item.confidence * 0.6 + recency + Math.min(item.useCount * 0.02, 0.2);
    }

    private matchesScopeWithScore(scope: KnowledgeScope, query: KnowledgeQuery): number {
        if (scope.global) {
            return 1.0;
        }

        if (scope.projectIds?.length && !scope.projectIds.includes(this.projectId)) {
            return 0;
        }

        let scoreMultiplier = 1.0;

        if (scope.filePatterns?.length) {
            if (!query.filePath) {
                if (query.relaxedScope) {
                    scoreMultiplier *= 0.5;
                } else {
                    return 0;
                }
            } else {
                const normalizedPath = query.filePath.replace(/\\/g, '/');
                const matches = scope.filePatterns.some(p =>
                    picomatch.isMatch(normalizedPath, p.replace(/\\/g, '/'), {
                        dot: true,
                        nocase: process.platform === 'win32'
                    })
                );

                if (!matches) {
                    if (query.relaxedScope) {
                        scoreMultiplier *= 0.3;
                    } else {
                        return 0;
                    }
                }
            }
        }

        if (scope.modules?.length) {
            if (!query.moduleName) {
                if (query.relaxedScope) {
                    scoreMultiplier *= 0.5;
                } else {
                    return 0;
                }
            } else if (!scope.modules.includes(query.moduleName)) {
                if (query.relaxedScope) {
                    scoreMultiplier *= 0.3;
                } else {
                    return 0;
                }
            }
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

        if (scopeScore < 1.0 && scopeScore > 0) {
            const penaltyPercent = Math.round((1 - scopeScore) * 100);
            reasons.push(`Scope penalty: -${penaltyPercent}%`);
        }

        return reasons.join('; ') || 'General relevance';
    }
}

