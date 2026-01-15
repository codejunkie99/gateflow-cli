/**
 * Optional LLM enrichment and query expansion for KnowledgeStore.
 * All LLM work is async/offline; search uses static or cached expansions only.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { createAnthropicClient } from '../../agent/anthropic-client.js';
import type { KnowledgeItem, KnowledgeLlmConfig } from '../knowledge-types.js';

type EnrichmentResult = {
    aiTags?: string[];
    aiSummary?: string;
};

const STATIC_EXPANSIONS: Record<string, string[]> = {
    clock: ['clk', 'ck', 'clock', 'sys_clk'],
    reset: ['rst', 'rstn', 'reset', 'arst', 'srst'],
    valid: ['vld', 'valid', 'dv', 'data_valid'],
    ready: ['rdy', 'ready'],
    enable: ['en', 'ena', 'enable'],
    write: ['wr', 'we', 'write', 'wen'],
    read: ['rd', 're', 'read', 'ren'],
    address: ['addr', 'adr', 'address'],
    data: ['dat', 'data', 'd'],
    acknowledge: ['ack', 'acknowledge'],
    request: ['req', 'request'],
    interrupt: ['irq', 'interrupt'],
};

class LruCache<K, V> {
    private map = new Map<K, V>();
    constructor(private maxSize: number) {}

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        this.map.set(key, value);
        if (this.map.size > this.maxSize) {
            const oldest = this.map.keys().next().value as K | undefined;
            if (oldest !== undefined) {
                this.map.delete(oldest);
            }
        }
    }

    has(key: K): boolean {
        return this.map.has(key);
    }
}

export class KnowledgeLlmService {
    private readonly config: KnowledgeLlmConfig;
    private readonly modelName: string;
    private readonly enabled: boolean;
    private readonly queryCache: LruCache<string, string[]>;
    private readonly inflightQueries = new Set<string>();
    private readonly inflightItems = new Set<string>();
    private queue: KnowledgeItem[] = [];
    private active = 0;

    constructor(
        config: KnowledgeLlmConfig | undefined,
        private applyEnrichment: (itemId: string, result: EnrichmentResult) => void
    ) {
        const defaults: KnowledgeLlmConfig = {
            enabled: false,
            model: 'claude-sonnet-4-20250514',
            maxTokens: 512,
            temperature: 0.2,
            queryExpansion: false,
            semanticTags: false,
            maxConcurrent: 2,
            queryCacheSize: 500
        };
        this.config = { ...defaults, ...(config ?? {}) };
        this.modelName = this.config.model ?? defaults.model!;
        this.enabled = Boolean(this.config.enabled && process.env.ANTHROPIC_API_KEY);
        this.queryCache = new LruCache<string, string[]>(
            this.config.queryCacheSize ?? defaults.queryCacheSize!
        );
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    shouldExpand(): boolean {
        return Boolean(this.config.queryExpansion);
    }

    shouldEnrich(): boolean {
        return this.enabled && Boolean(this.config.semanticTags);
    }

    expandQuery(query: string): string[] {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return [];

        const cached = this.queryCache.get(normalized);
        if (cached) return cached;

        const terms = new Set<string>();
        terms.add(normalized);
        for (const token of normalized.split(/\s+/)) {
            terms.add(token);
            const expansions = STATIC_EXPANSIONS[token];
            if (expansions) {
                for (const term of expansions) terms.add(term);
            }
        }

        const expanded = Array.from(terms);
        this.queryCache.set(normalized, expanded);

        if (this.shouldExpand()) {
            void this.warmQueryExpansion(normalized);
        }

        return expanded;
    }

    enqueueEnrichment(item: KnowledgeItem): void {
        if (!this.shouldEnrich()) return;
        if (this.inflightItems.has(item.id)) return;
        this.queue.push(item);
        this.processQueue();
    }

    async interpretQuery(naturalQuery: string): Promise<{
        query: string;
        tags?: string[];
        moduleName?: string;
    }> {
        const base = naturalQuery.trim();
        if (!base || !this.enabled) {
            return { query: base };
        }

        try {
            const { object } = await generateObject({
                model: createAnthropicClient(this.modelName) as any,
                schema: z.object({
                    keywords: z.array(z.string()).max(10),
                    concepts: z.array(z.string()).max(10).optional(),
                    moduleFilter: z.string().optional()
                }),
                prompt: `Convert this natural language HDL query to a structured search.
Query: "${base}"
Return JSON with:
- keywords: array of exact terms to search
- concepts: array of semantic concepts (optional)
- moduleFilter: specific module name if mentioned (optional)`,
                temperature: this.config.temperature,
                maxOutputTokens: this.config.maxTokens
            });

            return {
                query: object.keywords.map(k => k.trim()).filter(Boolean).join(' ') || base,
                tags: object.concepts?.map(c => c.trim()).filter(Boolean),
                moduleName: object.moduleFilter?.trim() || undefined
            };
        } catch {
            return { query: base };
        }
    }

    private processQueue(): void {
        const maxConcurrent = this.config.maxConcurrent ?? 2;
        while (this.active < maxConcurrent && this.queue.length > 0) {
            const item = this.queue.shift()!;
            if (this.inflightItems.has(item.id)) {
                continue;
            }
            this.inflightItems.add(item.id);
            this.active += 1;
            void this.enrichItem(item)
                .then(result => {
                    if (result) {
                        this.applyEnrichment(item.id, result);
                    }
                })
                .catch(() => {
                    // Ignore LLM errors; enrichment is optional
                })
                .finally(() => {
                    this.inflightItems.delete(item.id);
                    this.active -= 1;
                    this.processQueue();
                });
        }
    }

    private async warmQueryExpansion(query: string): Promise<void> {
        if (this.inflightQueries.has(query)) return;
        this.inflightQueries.add(query);
        try {
            const { object } = await generateObject({
                model: createAnthropicClient(this.modelName) as any,
                schema: z.object({
                    terms: z.array(z.string()).max(10)
                }),
                prompt: `Given this HDL search query, generate equivalent search terms.
Query: "${query}"
Return JSON with "terms" including:
- Common abbreviations (clock -> clk, reset -> rst)
- Common suffixes (_i, _o, _n, _p, _in, _out)
- Related concepts
- Naming variants (snake_case, camelCase)
Return max 10 terms.`,
                temperature: this.config.temperature,
                maxOutputTokens: this.config.maxTokens
            });

            const cleaned = object.terms
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0);
            const expanded = Array.from(new Set([query, ...cleaned]));
            this.queryCache.set(query, expanded);
        } catch {
            // Ignore LLM errors; static expansions already applied
        } finally {
            this.inflightQueries.delete(query);
        }
    }

    private async enrichItem(item: KnowledgeItem): Promise<EnrichmentResult | null> {
        if (!this.enabled) return null;
        if (item.aiTags && item.aiTags.length > 0) return null;

        const prompt = `Analyze this SystemVerilog knowledge item and generate semantic tags.
Title: ${item.title}
Type: ${item.type}
Content:
${item.content.slice(0, 2000)}

Return JSON with:
- tags: 5-10 concise, lowercase tags (protocols, patterns, concepts)
- summary: one-sentence summary (<= 200 chars)`;

        const { object } = await generateObject({
            model: createAnthropicClient(this.modelName) as any,
            schema: z.object({
                tags: z.array(z.string()).max(12),
                summary: z.string().max(200)
            }),
            prompt,
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxTokens
        });

        const tags = object.tags
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0);

        if (tags.length === 0 && !object.summary.trim()) {
            return null;
        }

        return {
            aiTags: Array.from(new Set(tags)).slice(0, 12),
            aiSummary: object.summary.trim()
        };
    }
}

