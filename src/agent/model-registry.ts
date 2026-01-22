/**
 * Model Registry
 *
 * Comprehensive registry of AI model metadata including context windows,
 * capabilities, pricing, and deprecation status.
 *
 * Features:
 * - Static metadata for all supported providers
 * - Context window information for token budgeting
 * - Capability flags (tools, vision, streaming, reasoning)
 * - Pricing information for cost estimation
 * - Deprecation tracking with warnings
 *
 * @module agent/model-registry
 */

import type { ProviderName } from './model-provider.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Model capability flags.
 *
 * Note: This interface extends the core capabilities (tools, structuredOutputs, reasoning)
 * with additional metadata fields (vision, streaming, codeExecution) useful for the
 * static model registry. The core fields match model-capabilities/types.ts for consistency.
 */
export interface ModelCapabilities {
    /** Supports tool/function calling */
    tools: boolean;
    /** Supports image/vision input */
    vision: boolean;
    /** Supports streaming responses */
    streaming: boolean;
    /** Has reasoning/thinking capabilities (o1, o3, extended thinking) */
    reasoning: boolean;
    /** Supports structured JSON output (matches types.ts naming) */
    structuredOutputs: boolean;
    /** Supports code execution/interpretation */
    codeExecution?: boolean;
}

/**
 * Model pricing per million tokens (USD).
 */
export interface ModelPricing {
    /** Cost per 1M input tokens */
    inputPer1M: number;
    /** Cost per 1M output tokens */
    outputPer1M: number;
    /** Cost per 1M cached/prompt tokens (if different) */
    cachedPer1M?: number;
}

/**
 * Model status.
 */
export type ModelStatus = 'stable' | 'beta' | 'preview' | 'deprecated';

/**
 * Complete model metadata.
 */
export interface ModelMetadata {
    /** Unique model identifier (e.g., "claude-sonnet-4-20250514") */
    id: string;
    /** Display name (e.g., "Claude Sonnet 4") */
    name: string;
    /** Provider this model belongs to */
    provider: ProviderName;
    /** Context window size in tokens */
    contextWindow: number;
    /** Maximum output tokens */
    maxOutputTokens: number;
    /** Model capabilities */
    capabilities: ModelCapabilities;
    /** Pricing information (optional) */
    pricing?: ModelPricing;
    /** Current status */
    status: ModelStatus;
    /** Deprecation date if deprecated (ISO 8601) */
    deprecationDate?: string;
    /** Knowledge cutoff date (e.g., "2024-04") */
    knowledgeCutoff?: string;
    /** Release date (ISO 8601) */
    releaseDate?: string;
    /** Brief description */
    description?: string;
}

/**
 * Provider metadata.
 */
export interface ProviderMetadata {
    /** Provider ID */
    id: ProviderName;
    /** Display name */
    name: string;
    /** NPM package name for the SDK */
    npm: string;
    /** Environment variables for API keys */
    envVars: string[];
    /** Documentation URL */
    docUrl: string;
    /** Default model ID */
    defaultModel: string;
}

// ============================================================================
// Static Model Data
// ============================================================================

/**
 * Comprehensive model metadata registry.
 * Updated: January 2026
 */
export const MODEL_METADATA: ModelMetadata[] = [
    // ========== Anthropic ==========
    {
        id: 'claude-opus-4-5-20251101',
        name: 'Claude Opus 4.5',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 32768,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 15, outputPer1M: 75 },
        status: 'stable',
        knowledgeCutoff: '2025-03',
        releaseDate: '2025-11-01',
        description: 'Most capable Claude model with extended thinking',
    },
    {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 16384,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 3, outputPer1M: 15 },
        status: 'stable',
        knowledgeCutoff: '2025-03',
        releaseDate: '2025-05-14',
        description: 'Best balance of capability and cost',
    },
    {
        id: 'claude-haiku-4-5-20251201',
        name: 'Claude Haiku 4.5',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: false,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 0.8, outputPer1M: 4 },
        status: 'stable',
        knowledgeCutoff: '2025-03',
        releaseDate: '2025-12-01',
        description: 'Fastest and most cost-efficient',
    },

    // ========== OpenAI ==========
    {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        provider: 'openai',
        contextWindow: 256000,
        maxOutputTokens: 32768,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
            codeExecution: true,
        },
        pricing: { inputPer1M: 10, outputPer1M: 30 },
        status: 'stable',
        knowledgeCutoff: '2025-06',
        releaseDate: '2025-12-01',
        description: 'Latest GPT model, SOTA on ARC-AGI',
    },
    {
        id: 'gpt-5',
        name: 'GPT-5',
        provider: 'openai',
        contextWindow: 256000,
        maxOutputTokens: 16384,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 5, outputPer1M: 15 },
        status: 'stable',
        knowledgeCutoff: '2025-03',
        releaseDate: '2025-06-01',
        description: 'Default in ChatGPT, replaces GPT-4o',
    },
    {
        id: 'o3',
        name: 'O3',
        provider: 'openai',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 15, outputPer1M: 60 },
        status: 'stable',
        knowledgeCutoff: '2025-03',
        releaseDate: '2025-04-01',
        description: 'Most powerful reasoning model',
    },
    {
        id: 'o4-mini',
        name: 'O4 Mini',
        provider: 'openai',
        contextWindow: 200000,
        maxOutputTokens: 65536,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 3, outputPer1M: 12 },
        status: 'stable',
        releaseDate: '2025-09-01',
        description: 'Fast reasoning, best on AIME',
    },
    {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: false,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 2.5, outputPer1M: 10 },
        status: 'stable',
        knowledgeCutoff: '2024-10',
        description: 'Previous flagship model',
    },

    // ========== Google ==========
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: 'google',
        contextWindow: 2000000,
        maxOutputTokens: 65536,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
            codeExecution: true,
        },
        pricing: { inputPer1M: 2.5, outputPer1M: 10 },
        status: 'stable',
        knowledgeCutoff: '2025-03',
        description: 'Most powerful Gemini with 2M context',
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: 'google',
        contextWindow: 1000000,
        maxOutputTokens: 32768,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
        status: 'stable',
        knowledgeCutoff: '2025-03',
        description: 'Fast and capable with 1M context',
    },

    // ========== DeepSeek ==========
    {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat (V3)',
        provider: 'deepseek',
        contextWindow: 64000,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: false,
            streaming: true,
            reasoning: false,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 0.14, outputPer1M: 0.28, cachedPer1M: 0.014 },
        status: 'stable',
        description: 'Cost-effective general chat model',
    },
    {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner (R1)',
        provider: 'deepseek',
        contextWindow: 64000,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: false,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 0.55, outputPer1M: 2.19, cachedPer1M: 0.14 },
        status: 'stable',
        description: 'Reasoning model with chain-of-thought',
    },

    // ========== Mistral ==========
    {
        id: 'mistral-large-latest',
        name: 'Mistral Large',
        provider: 'mistral',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: false,
            streaming: true,
            reasoning: false,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 2, outputPer1M: 6 },
        status: 'stable',
        description: 'Most capable Mistral model',
    },
    {
        id: 'codestral-latest',
        name: 'Codestral',
        provider: 'mistral',
        contextWindow: 32000,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: false,
            streaming: true,
            reasoning: false,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 0.3, outputPer1M: 0.9 },
        status: 'stable',
        description: 'Code-specialized model',
    },

    // ========== Ollama (Local) ==========
    {
        id: 'llama3.1',
        name: 'Llama 3.1 (8B)',
        provider: 'ollama',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: false,
            streaming: true,
            reasoning: false,
            structuredOutputs: true,
        },
        status: 'stable',
        description: 'Local inference with Ollama',
    },
    {
        id: 'llama3.1:70b',
        name: 'Llama 3.1 (70B)',
        provider: 'ollama',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: false,
            streaming: true,
            reasoning: false,
            structuredOutputs: true,
        },
        status: 'stable',
        description: 'Large local model',
    },
    {
        id: 'codellama',
        name: 'Code Llama',
        provider: 'ollama',
        contextWindow: 16384,
        maxOutputTokens: 4096,
        capabilities: {
            tools: false,
            vision: false,
            streaming: true,
            reasoning: false,
            structuredOutputs: false,
        },
        status: 'stable',
        description: 'Code-specialized local model',
    },

    // ========== OpenRouter (meta) ==========
    {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4 (via OpenRouter)',
        provider: 'openrouter',
        contextWindow: 200000,
        maxOutputTokens: 16384,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 3.3, outputPer1M: 16.5 },
        status: 'stable',
        description: 'Claude via OpenRouter (slight markup)',
    },

    // ========== Zhipu ==========
    {
        id: 'glm-4.7',
        name: 'GLM 4.7',
        provider: 'zhipu',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: {
            tools: true,
            vision: true,
            streaming: true,
            reasoning: true,
            structuredOutputs: true,
        },
        pricing: { inputPer1M: 2, outputPer1M: 8 },
        status: 'stable',
        releaseDate: '2025-12-01',
        description: '400B parameter model with deep reasoning',
    },
];

/**
 * Provider metadata registry.
 */
export const PROVIDER_METADATA: ProviderMetadata[] = [
    {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        npm: '@ai-sdk/anthropic',
        envVars: ['ANTHROPIC_API_KEY'],
        docUrl: 'https://console.anthropic.com/settings/keys',
        defaultModel: 'claude-sonnet-4-20250514',
    },
    {
        id: 'openai',
        name: 'OpenAI (GPT)',
        npm: '@ai-sdk/openai',
        envVars: ['OPENAI_API_KEY'],
        docUrl: 'https://platform.openai.com/api-keys',
        defaultModel: 'gpt-5',
    },
    {
        id: 'google',
        name: 'Google (Gemini)',
        npm: '@ai-sdk/google',
        envVars: ['GOOGLE_GENERATIVE_AI_API_KEY'],
        docUrl: 'https://aistudio.google.com/apikey',
        defaultModel: 'gemini-2.5-flash',
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        npm: '@ai-sdk/openai',
        envVars: ['DEEPSEEK_API_KEY'],
        docUrl: 'https://platform.deepseek.com/api_keys',
        defaultModel: 'deepseek-chat',
    },
    {
        id: 'mistral',
        name: 'Mistral AI',
        npm: '@ai-sdk/mistral',
        envVars: ['MISTRAL_API_KEY'],
        docUrl: 'https://console.mistral.ai/api-keys/',
        defaultModel: 'mistral-large-latest',
    },
    {
        id: 'ollama',
        name: 'Ollama (Local)',
        npm: 'ollama-ai-provider',
        envVars: ['OLLAMA_BASE_URL'],
        docUrl: 'https://ollama.ai/download',
        defaultModel: 'llama3.1',
    },
    {
        id: 'openrouter',
        name: 'OpenRouter (300+ models)',
        npm: '@ai-sdk/openai',
        envVars: ['OPENROUTER_API_KEY'],
        docUrl: 'https://openrouter.ai/keys',
        defaultModel: 'anthropic/claude-sonnet-4',
    },
    {
        id: 'zhipu',
        name: 'Zhipu (GLM)',
        npm: '@ai-sdk/openai',
        envVars: ['ZHIPU_API_KEY'],
        docUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
        defaultModel: 'glm-4.7',
    },
];

// ============================================================================
// Model Registry Class
// ============================================================================

/**
 * Model registry for looking up model metadata.
 *
 * Provides efficient access to model information with caching.
 */
export class ModelRegistry {
    private modelCache: Map<string, ModelMetadata> = new Map();
    private providerCache: Map<ProviderName, ProviderMetadata> = new Map();
    private initialized = false;

    constructor() {
        this.initialize();
    }

    /**
     * Initialize the registry from static data.
     */
    private initialize(): void {
        if (this.initialized) return;

        // Index models by ID
        for (const model of MODEL_METADATA) {
            this.modelCache.set(model.id, model);
        }

        // Index providers by ID
        for (const provider of PROVIDER_METADATA) {
            this.providerCache.set(provider.id, provider);
        }

        this.initialized = true;
    }

    /**
     * Normalize a model ID by stripping date suffix (e.g., -20250514).
     * Returns the base name for fuzzy matching.
     */
    private normalizeModelId(id: string): string {
        // Strip date suffix pattern: -YYYYMMDD at end
        return id.replace(/-\d{8}$/, '');
    }

    /**
     * Get model metadata by ID with fuzzy matching.
     * Tries in order:
     * 1. Exact match
     * 2. Match by normalized name (date suffix stripped)
     * 3. Match where query is a prefix of registered ID
     */
    getModel(id: string): ModelMetadata | undefined {
        // 1. Exact match
        const exact = this.modelCache.get(id);
        if (exact) return exact;

        // 2. Normalized match (strip date suffix from both)
        const normalizedQuery = this.normalizeModelId(id);
        for (const [registeredId, model] of this.modelCache) {
            if (this.normalizeModelId(registeredId) === normalizedQuery) {
                return model;
            }
        }

        // 3. Prefix match (query is prefix of registered ID)
        // e.g., 'claude-sonnet-4' matches 'claude-sonnet-4-20250514'
        for (const [registeredId, model] of this.modelCache) {
            if (registeredId.startsWith(id + '-')) {
                return model;
            }
        }

        return undefined;
    }

    /**
     * Get model metadata by exact ID only (no fuzzy matching).
     * Use this when you need strict ID matching.
     */
    getModelExact(id: string): ModelMetadata | undefined {
        return this.modelCache.get(id);
    }

    /**
     * Get provider metadata by ID.
     */
    getProvider(id: ProviderName): ProviderMetadata | undefined {
        return this.providerCache.get(id);
    }

    /**
     * List all models for a provider.
     */
    listModels(provider?: ProviderName): ModelMetadata[] {
        const models = Array.from(this.modelCache.values());
        if (provider) {
            return models.filter(m => m.provider === provider);
        }
        return models;
    }

    /**
     * List all providers.
     */
    listProviders(): ProviderMetadata[] {
        return Array.from(this.providerCache.values());
    }

    /**
     * Check if a model is deprecated.
     * Uses fuzzy matching to resolve model ID.
     */
    isDeprecated(id: string): boolean {
        const model = this.getModel(id);
        return model?.status === 'deprecated';
    }

    /**
     * Get deprecation warning if model is deprecated.
     * Uses fuzzy matching to resolve model ID.
     */
    getDeprecationWarning(id: string): string | undefined {
        const model = this.getModel(id);
        if (model?.status !== 'deprecated') return undefined;

        const date = model.deprecationDate ? ` (deprecated ${model.deprecationDate})` : '';
        return `Model '${model.name}' is deprecated${date}. Consider switching to a newer model.`;
    }

    /**
     * Get context window size for a model.
     * Uses fuzzy matching to resolve model ID.
     * Returns default if model not found.
     */
    getContextWindow(id: string, defaultSize = 128000): number {
        return this.getModel(id)?.contextWindow ?? defaultSize;
    }

    /**
     * Get max output tokens for a model.
     * Uses fuzzy matching to resolve model ID.
     * Returns default if model not found.
     */
    getMaxOutputTokens(id: string, defaultTokens = 8192): number {
        return this.getModel(id)?.maxOutputTokens ?? defaultTokens;
    }

    /**
     * Check if a model supports a capability.
     * Uses fuzzy matching to resolve model ID.
     */
    hasCapability(
        id: string,
        capability: keyof ModelCapabilities
    ): boolean {
        const model = this.getModel(id);
        return model?.capabilities[capability] ?? false;
    }

    /**
     * Get models with a specific capability.
     */
    getModelsWithCapability(
        capability: keyof ModelCapabilities,
        provider?: ProviderName
    ): ModelMetadata[] {
        return this.listModels(provider).filter(
            m => m.capabilities[capability]
        );
    }

    /**
     * Estimate cost for a request.
     * Uses fuzzy matching to resolve model ID.
     *
     * @param id - Model ID
     * @param inputTokens - Number of input tokens
     * @param outputTokens - Number of output tokens
     * @returns Estimated cost in USD, or undefined if pricing not available
     */
    estimateCost(
        id: string,
        inputTokens: number,
        outputTokens: number
    ): number | undefined {
        const model = this.getModel(id);
        if (!model?.pricing) return undefined;

        const inputCost = (inputTokens / 1_000_000) * model.pricing.inputPer1M;
        const outputCost = (outputTokens / 1_000_000) * model.pricing.outputPer1M;

        return inputCost + outputCost;
    }

    /**
     * Find similar models (same provider, different tier).
     * Uses fuzzy matching to find the model, so both 'claude-sonnet-4' and
     * 'claude-sonnet-4-20250514' will correctly resolve to alternatives.
     */
    findAlternatives(id: string): ModelMetadata[] {
        // Use getModel() for fuzzy matching instead of direct cache lookup
        const model = this.getModel(id);
        if (!model) return [];

        // Compare using normalized IDs to avoid excluding the same model
        // when queried with a different ID format
        const normalizedQueryId = this.normalizeModelId(model.id);
        return this.listModels(model.provider).filter(
            m => this.normalizeModelId(m.id) !== normalizedQueryId && m.status !== 'deprecated'
        );
    }

    /**
     * Get the best model for a use case.
     *
     * @param requirements - Required capabilities
     * @param preferences - Preferred characteristics
     * @returns Best matching model, or undefined
     */
    findBestModel(
        requirements: Partial<ModelCapabilities>,
        preferences?: {
            preferCheap?: boolean;
            preferFast?: boolean;
            preferProvider?: ProviderName;
        }
    ): ModelMetadata | undefined {
        let candidates = this.listModels().filter(
            m => m.status !== 'deprecated'
        );

        // Filter by required capabilities
        for (const [cap, required] of Object.entries(requirements)) {
            if (required) {
                candidates = candidates.filter(
                    m => m.capabilities[cap as keyof ModelCapabilities]
                );
            }
        }

        if (candidates.length === 0) return undefined;

        // Apply preferences
        if (preferences?.preferProvider) {
            const providerModels = candidates.filter(
                m => m.provider === preferences.preferProvider
            );
            if (providerModels.length > 0) {
                candidates = providerModels;
            }
        }

        if (preferences?.preferCheap) {
            candidates.sort((a, b) => {
                const aCost = a.pricing?.inputPer1M ?? Infinity;
                const bCost = b.pricing?.inputPer1M ?? Infinity;
                return aCost - bCost;
            });
        }

        return candidates[0];
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global model registry instance.
 */
export const modelRegistry = new ModelRegistry();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get context window for a model (convenience function).
 */
export function getContextWindow(modelId: string): number {
    return modelRegistry.getContextWindow(modelId);
}

/**
 * Get max output tokens for a model (convenience function).
 */
export function getMaxOutputTokens(modelId: string): number {
    return modelRegistry.getMaxOutputTokens(modelId);
}

/**
 * Check if model is deprecated (convenience function).
 */
export function isModelDeprecated(modelId: string): boolean {
    return modelRegistry.isDeprecated(modelId);
}

/**
 * Get deprecation warning if applicable (convenience function).
 */
export function getDeprecationWarning(modelId: string): string | undefined {
    return modelRegistry.getDeprecationWarning(modelId);
}

/**
 * Estimate request cost (convenience function).
 */
export function estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
): number | undefined {
    return modelRegistry.estimateCost(modelId, inputTokens, outputTokens);
}

/**
 * Check if model has capability (convenience function).
 */
export function hasCapability(
    modelId: string,
    capability: keyof ModelCapabilities
): boolean {
    return modelRegistry.hasCapability(modelId, capability);
}
