/**
 * Model Capability Service
 *
 * Manages OpenRouter model capability data with filesystem and memory caching.
 */

import path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { fetchModelCapabilities } from './openrouter-fetcher.js';
import {
    type CapabilityCache,
    type ModelCapabilities,
    CACHE_TTL_MS,
    CACHE_VERSION,
    DEFAULT_CAPABILITIES,
} from './types.js';

export class ModelCapabilityService {
    private cachePath: string;
    private cacheDir: string;
    private cache: CapabilityCache | null = null;
    private memoryCache: Map<string, ModelCapabilities> = new Map();
    private initialized = false;
    private initializing: Promise<void> | null = null;

    constructor(cacheDir: string = '.gateflow/cache') {
        this.cacheDir = cacheDir;
        this.cachePath = path.join(cacheDir, 'model-capabilities.json');
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initializing) return this.initializing;

        this.initializing = this.initializeInternal();
        await this.initializing;
        this.initializing = null;
    }

    async getCapabilities(modelId: string): Promise<ModelCapabilities> {
        const trimmed = modelId?.trim();
        if (!trimmed) return DEFAULT_CAPABILITIES;

        if (!this.initialized) {
            await this.initialize();
        }

        // Generate all possible lookup keys
        const keys = this.getLookupKeys(trimmed);

        // Try memory cache first
        for (const key of keys) {
            const cached = this.memoryCache.get(key);
            if (cached) {
                // Cache under original key for faster future lookups
                if (key !== trimmed) {
                    this.memoryCache.set(trimmed, cached);
                }
                return cached;
            }
        }

        // Try file cache
        for (const key of keys) {
            const fromFile = this.cache?.models?.[key];
            if (fromFile) {
                // Cache under all keys for faster future lookups
                this.memoryCache.set(trimmed, fromFile);
                this.memoryCache.set(key, fromFile);
                return fromFile;
            }
        }

        // Model not found in OpenRouter cache - return defaults
        // Note: Direct providers are handled separately in generateStructured()
        return DEFAULT_CAPABILITIES;
    }

    async refresh(): Promise<void> {
        const models = await fetchModelCapabilities();
        const cache = this.buildCache(models, 'openrouter');
        await this.writeToFilesystem(cache);
        this.applyCache(cache);
        this.initialized = true;
    }

    /**
     * Check if a model is compatible (has BOTH tools AND structuredOutputs).
     * This is the key requirement for thinking + structured output to work together.
     */
    async isCompatible(modelId: string): Promise<boolean> {
        const caps = await this.getCapabilities(modelId);
        return caps.tools && caps.structuredOutputs;
    }

    /**
     * Get all models that have BOTH tools AND structuredOutputs capabilities.
     * These models support thinking/reasoning modes with structured output calls.
     *
     * @returns Array of [modelId, capabilities] tuples for compatible models
     */
    async getCompatibleModels(): Promise<Array<[string, ModelCapabilities]>> {
        if (!this.initialized) {
            await this.initialize();
        }

        const compatible: Array<[string, ModelCapabilities]> = [];

        if (this.cache?.models) {
            for (const [modelId, caps] of Object.entries(this.cache.models)) {
                if (caps.tools && caps.structuredOutputs) {
                    compatible.push([modelId, caps]);
                }
            }
        }

        return compatible;
    }

    /**
     * Get compatible models grouped by provider.
     * Useful for UI display and model selection.
     *
     * @returns Map of provider name to array of model IDs
     */
    async getCompatibleModelsByProvider(): Promise<Map<string, string[]>> {
        const compatible = await this.getCompatibleModels();
        const byProvider = new Map<string, string[]>();

        for (const [modelId] of compatible) {
            // Extract provider from model ID (e.g., "anthropic/claude-sonnet-4" -> "anthropic")
            const slashIndex = modelId.indexOf('/');
            const provider = slashIndex > 0 ? modelId.slice(0, slashIndex) : 'unknown';

            if (!byProvider.has(provider)) {
                byProvider.set(provider, []);
            }
            byProvider.get(provider)!.push(modelId);
        }

        return byProvider;
    }

    /**
     * Get count of compatible models.
     */
    async getCompatibleCount(): Promise<number> {
        const compatible = await this.getCompatibleModels();
        return compatible.length;
    }

    private async initializeInternal(): Promise<void> {
        const fileCache = await this.loadFromFilesystem();

        if (fileCache && !this.isStale(fileCache)) {
            this.applyCache(fileCache);
            this.initialized = true;
            return;
        }

        if (fileCache && this.isStale(fileCache)) {
            try {
                const models = await fetchModelCapabilities();
                const cache = this.buildCache(models, 'openrouter');
                await this.writeToFilesystem(cache);
                this.applyCache(cache);
                this.initialized = true;
                return;
            } catch {
                this.applyCache(fileCache);
                this.initialized = true;
                return;
            }
        }

        try {
            const models = await fetchModelCapabilities();
            const cache = this.buildCache(models, 'openrouter');
            await this.writeToFilesystem(cache);
            this.applyCache(cache);
            this.initialized = true;
        } catch {
            const cache = this.buildCache({}, 'fallback');
            this.applyCache(cache);
            this.initialized = true;
        }
    }

    private applyCache(cache: CapabilityCache): void {
        this.cache = cache;
        this.memoryCache.clear();
        for (const [modelId, caps] of Object.entries(cache.models)) {
            this.memoryCache.set(modelId, caps);
        }
    }

    /**
     * Generate all possible lookup keys for a model ID.
     * Handles various naming conventions:
     * - openrouter/anthropic/claude-sonnet-4 → anthropic/claude-sonnet-4
     * - claude-sonnet-4-20250514 → anthropic/claude-sonnet-4
     * - anthropic/claude-sonnet-4-20250514 → anthropic/claude-sonnet-4
     */
    private getLookupKeys(modelId: string): string[] {
        const keys: string[] = [modelId];
        let current = modelId;

        // Strip openrouter/ prefix
        if (current.startsWith('openrouter/')) {
            current = current.slice('openrouter/'.length);
            keys.push(current);
        }

        // Strip date suffix (e.g., -20250514, -20241022)
        const dateMatch = current.match(/^(.+)-(\d{8})$/);
        if (dateMatch) {
            keys.push(dateMatch[1]);
        }

        // Add provider prefix if missing
        if (!current.includes('/')) {
            const provider = this.inferProvider(current);
            if (provider) {
                keys.push(`${provider}/${current}`);
                // Also try without date suffix
                if (dateMatch) {
                    keys.push(`${provider}/${dateMatch[1]}`);
                }
            }
        }

        return [...new Set(keys)]; // Dedupe
    }

    private inferProvider(model: string): string | null {
        // Anthropic
        if (model.startsWith('claude-') || model.startsWith('claude3')) return 'anthropic';
        // OpenAI (including o-series reasoning models)
        if (
            model.startsWith('gpt-') ||
            model.startsWith('o1') ||
            model.startsWith('o3') ||
            model.startsWith('o4')
        ) return 'openai';
        // Google
        if (model.startsWith('gemini-')) return 'google';
        // Mistral (including Magistral reasoning and Codestral)
        if (
            model.startsWith('mistral-') ||
            model.startsWith('codestral') ||
            model.startsWith('magistral')
        ) return 'mistralai';
        // Meta Llama
        if (model.startsWith('llama-') || model.startsWith('llama3')) return 'meta-llama';
        // Qwen
        if (model.startsWith('qwen')) return 'qwen';
        // DeepSeek
        if (model.startsWith('deepseek')) return 'deepseek';
        // Zhipu GLM
        if (model.startsWith('glm-') || model.startsWith('glm')) return 'zhipu';
        return null;
    }

    private buildCache(
        models: Record<string, ModelCapabilities>,
        source: CapabilityCache['source'],
    ): CapabilityCache {
        return {
            lastUpdated: new Date().toISOString(),
            source,
            version: CACHE_VERSION,
            models,
        };
    }

    private async loadFromFilesystem(): Promise<CapabilityCache | null> {
        try {
            const raw = await readFile(this.cachePath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<CapabilityCache>;
            if (!parsed || typeof parsed !== 'object') return null;
            if (!parsed.models || typeof parsed.models !== 'object' || Array.isArray(parsed.models)) {
                return null;
            }

            return {
                lastUpdated: typeof parsed.lastUpdated === 'string'
                    ? parsed.lastUpdated
                    : new Date(0).toISOString(),
                source: parsed.source === 'openrouter' ? 'openrouter' : 'fallback',
                version: typeof parsed.version === 'number' ? parsed.version : 0,
                models: parsed.models as Record<string, ModelCapabilities>,
            };
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error) {
                const nodeError = error as NodeJS.ErrnoException;
                if (nodeError.code === 'ENOENT') return null;
            }
            return null;
        }
    }

    private async writeToFilesystem(cache: CapabilityCache): Promise<void> {
        await mkdir(this.cacheDir, { recursive: true });
        await writeFile(this.cachePath, JSON.stringify(cache, null, 2), 'utf8');
    }

    private isStale(cache: CapabilityCache): boolean {
        if (cache.version !== CACHE_VERSION) return true;
        const timestamp = Date.parse(cache.lastUpdated);
        if (!Number.isFinite(timestamp)) return true;
        return Date.now() - timestamp > CACHE_TTL_MS;
    }
}
