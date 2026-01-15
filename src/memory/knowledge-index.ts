/**
 * KnowledgeStore Indexing + Search
 *
 * Encapsulates in-memory indices and BM25 scoring for fast retrieval.
 */

import picomatch from 'picomatch';
import type {
    KnowledgeItem,
    KnowledgeQuery,
    KnowledgeSearchResult,
    KnowledgeType
} from './knowledge-types.js';
import { BM25_B, BM25_K1 } from './knowledge-types.js';

export class KnowledgeIndexManager {
    private itemById = new Map<string, KnowledgeItem>();
    private itemByFingerprint = new Map<string, KnowledgeItem>();
    private invertedIndex = new Map<string, Set<string>>(); // term -> item IDs
    private docLengths = new Map<string, number>(); // item ID -> word count
    private termDocFreq = new Map<string, number>(); // term -> doc count
    private avgDocLength = 0;
    private tokenCache = new Map<string, string[]>();
    private totalDocLength = 0;

    private readonly TYPE_PORTABILITY: Record<KnowledgeType, number> = {
        lint_fix: 0.2,
        code_pattern: 0.5,
        style_preference: 0.95,
        tool_usage: 0.7,
        workflow: 0.7,
        test_pattern: 0.6,
        debug_solution: 0.4
    };

    private readonly SV_STOP_WORDS = new Set([
        'the', 'this', 'that', 'from', 'with', 'for', 'and', 'are',
        'has', 'have', 'is', 'be', 'to', 'of', 'in', 'it', 'on',
        'begin', 'end', 'endmodule', 'module'
    ]);

    private readonly SV_MEANINGFUL_SHORT = new Set([
        'io', 'in', 'oe', 'd', 'q', 'n', 'p', 'b',
        'en', 'we', 're', 'cs', 'ce', 'rd', 'wr', 'tx', 'rx',
        'ck', 'clk', 'rst', 'req', 'ack', 'rdy', 'vld',
        'err', 'sel', 'din', 'dout', 'ip', 'id', 'bi', 'le', 'ld'
    ]);

    constructor(private projectId: string) {}

    clear(): void {
        this.itemById.clear();
        this.itemByFingerprint.clear();
        this.invertedIndex.clear();
        this.docLengths.clear();
        this.termDocFreq.clear();
        this.avgDocLength = 0;
        this.tokenCache.clear();
        this.totalDocLength = 0;
    }

    rebuild(items: KnowledgeItem[]): void {
        this.clear();
        if (items.length === 0) return;

        for (const item of items) {
            this.itemById.set(item.id, item);
            if (item.fingerprint) {
                this.itemByFingerprint.set(item.fingerprint, item);
            }

            const tokens = this.getTokens(item);
            this.docLengths.set(item.id, tokens.length);
            this.totalDocLength += tokens.length;
            this.addTokensToIndex(item.id, tokens);
        }

        this.avgDocLength = this.totalDocLength / items.length;
    }

    add(item: KnowledgeItem): void {
        this.itemById.set(item.id, item);
        this.itemByFingerprint.set(item.fingerprint, item);

        const tokens = this.getTokens(item);
        this.docLengths.set(item.id, tokens.length);
        this.totalDocLength += tokens.length;
        this.avgDocLength = this.totalDocLength / this.docLengths.size;
        this.addTokensToIndex(item.id, tokens);
    }

    remove(item: KnowledgeItem): void {
        this.itemById.delete(item.id);
        this.itemByFingerprint.delete(item.fingerprint);

        const tokens = this.tokenCache.get(item.id) ?? this.tokenizeItem(item);
        const docLen = this.docLengths.get(item.id);
        if (docLen) {
            this.totalDocLength -= docLen;
        }
        this.docLengths.delete(item.id);
        this.tokenCache.delete(item.id);

        this.removeTokensFromIndex(item.id, tokens);
        this.avgDocLength = this.docLengths.size > 0
            ? this.totalDocLength / this.docLengths.size
            : 0;
    }

    update(item: KnowledgeItem): void {
        const oldTokens = this.tokenCache.get(item.id);
        if (oldTokens) {
            this.removeTokensFromIndex(item.id, oldTokens);
            this.totalDocLength -= oldTokens.length;
        } else {
            const oldLen = this.docLengths.get(item.id);
            if (oldLen) {
                this.totalDocLength -= oldLen;
            }
        }
        this.tokenCache.delete(item.id);
        this.docLengths.delete(item.id);
        this.add(item);
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

        const scored: Array<{ item: KnowledgeItem; baseScore: number; scopeScore: number }> = [];

        for (const item of candidates) {
            const scopeScore = this.matchesScopeWithScore(item, query);
            if (scopeScore === 0) {
                continue;
            }

            const baseScore = queryTerms.length > 0
                ? this.scoreBM25(item, queryTerms)
                : this.scoreBasic(item);

            scored.push({ item, baseScore, scopeScore });
        }

        const results: KnowledgeSearchResult[] = [];
        if (queryTerms.length > 0) {
            const baseMap = new Map<string, number>();
            for (const entry of scored) {
                baseMap.set(entry.item.id, entry.baseScore);
            }
            const normalized = this.normalizeScores(baseMap);
            for (const entry of scored) {
                const normalizedScore = normalized.get(entry.item.id) ?? 0;
                const blended = normalizedScore * 0.7 + entry.item.confidence * 0.3;
                const finalScore = blended * entry.scopeScore;
                results.push({
                    item: entry.item,
                    relevance: finalScore,
                    matchReason: this.getMatchReason(entry.item, query, entry.scopeScore)
                });
            }
        } else {
            for (const entry of scored) {
                results.push({
                    item: entry.item,
                    relevance: entry.baseScore * entry.scopeScore,
                    matchReason: this.getMatchReason(entry.item, query, entry.scopeScore)
                });
            }
        }

        results.sort((a, b) => b.relevance - a.relevance);
        return results.slice(0, query.maxResults ?? 10);
    }

    private getTokens(item: KnowledgeItem): string[] {
        let tokens = this.tokenCache.get(item.id);
        if (!tokens) {
            tokens = this.tokenizeItem(item);
            this.tokenCache.set(item.id, tokens);
        }
        return tokens;
    }

    private tokenizeItem(item: KnowledgeItem): string[] {
        const aiTags = item.aiTags?.join(' ') ?? '';
        const text = `${item.title} ${item.content} ${item.tags.join(' ')} ${item.keywords.join(' ')} ${aiTags}`;
        return this.tokenize(text);
    }

    private tokenizeQuery(text: string): string[] {
        return this.tokenize(text);
    }

    private tokenize(text: string): string[] {
        const tokens: string[] = [];
        for (const word of text.split(/\s+/)) {
            const cleaned = word.replace(/[^\w]/g, '');
            if (!cleaned) continue;

            const lower = cleaned.toLowerCase();
            if (!this.SV_STOP_WORDS.has(lower)) {
                tokens.push(lower);
            }

            if (cleaned.includes('_')) {
                for (const part of cleaned.split('_')) {
                    if (!part) continue;
                    const partLower = part.toLowerCase();
                    if (this.isValidToken(partLower)) {
                        tokens.push(partLower);
                    }
                    this.addCamelCaseParts(part, tokens);
                }
            } else {
                this.addCamelCaseParts(cleaned, tokens);
            }
        }
        return tokens;
    }

    private addCamelCaseParts(word: string, tokens: string[]): void {
        const parts = word.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
        for (const part of parts) {
            const lower = part.toLowerCase();
            if (lower !== word.toLowerCase() && this.isValidToken(lower)) {
                tokens.push(lower);
            }
        }
    }

    private isValidToken(token: string): boolean {
        if (this.SV_STOP_WORDS.has(token)) return false;
        if (token.length > 2) return true;
        if (/^[pq]\d+$/.test(token)) return true;
        return this.SV_MEANINGFUL_SHORT.has(token);
    }

    private addTokensToIndex(itemId: string, tokens: string[]): void {
        const seenTerms = new Set<string>();
        for (const term of tokens) {
            let postings = this.invertedIndex.get(term);
            if (!postings) {
                postings = new Set();
                this.invertedIndex.set(term, postings);
            }
            postings.add(itemId);

            if (!seenTerms.has(term)) {
                seenTerms.add(term);
                this.termDocFreq.set(term, (this.termDocFreq.get(term) || 0) + 1);
            }
        }
    }

    private removeTokensFromIndex(itemId: string, tokens: string[]): void {
        const seenTerms = new Set<string>();
        for (const term of tokens) {
            const postings = this.invertedIndex.get(term);
            if (postings) {
                postings.delete(itemId);
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

    private scoreBM25(item: KnowledgeItem, queryTerms: string[]): number {
        const docLen = this.docLengths.get(item.id) || 1;
        const N = this.docLengths.size || 1;
        const itemTokens = this.getTokens(item);

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

        return score;
    }

    private normalizeScores(scores: Map<string, number>): Map<string, number> {
        const values = Array.from(scores.values());
        if (values.length === 0) return scores;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const normalized = new Map<string, number>();
        for (const [id, score] of scores) {
            normalized.set(id, (score - min) / range);
        }
        return normalized;
    }

    private scoreBasic(item: KnowledgeItem): number {
        const daysSinceAccess = (Date.now() - item.lastAccessed) / (24 * 60 * 60 * 1000);
        const recency = Math.max(0, 0.2 - daysSinceAccess * 0.01);
        return item.confidence * 0.6 + recency + Math.min(item.useCount * 0.02, 0.2);
    }

    private matchesScopeWithScore(item: KnowledgeItem, query: KnowledgeQuery): number {
        const scope = item.scope;
        if (scope.global) {
            return 1.0;
        }

        if (scope.projectIds?.length && !scope.projectIds.includes(this.projectId)) {
            return 0;
        }

        let scoreMultiplier = 1.0;

        if (scope.defineContextId) {
            if (!query.defineContextId) {
                if (query.relaxedScope) {
                    scoreMultiplier *= this.TYPE_PORTABILITY[item.type] ?? 0.4;
                } else {
                    return 0;
                }
            } else if (scope.defineContextId !== query.defineContextId) {
                if (query.relaxedScope) {
                    scoreMultiplier *= this.TYPE_PORTABILITY[item.type] ?? 0.4;
                } else {
                    return 0;
                }
            }
        }

        if (scope.compileOrderId && query.compileOrderId) {
            if (scope.compileOrderId !== query.compileOrderId) {
                scoreMultiplier *= 0.9;
            }
        }

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

        if (query.defineContextId && item.scope.defineContextId && item.scope.defineContextId !== query.defineContextId) {
            reasons.push('Define context mismatch');
        }
        if (query.compileOrderId && item.scope.compileOrderId && item.scope.compileOrderId !== query.compileOrderId) {
            reasons.push('Compile order mismatch');
        }

        if (scopeScore < 1.0 && scopeScore > 0) {
            const penaltyPercent = Math.round((1 - scopeScore) * 100);
            reasons.push(`Scope penalty: -${penaltyPercent}%`);
        }

        return reasons.join('; ') || 'General relevance';
    }
}

