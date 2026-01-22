/**
 * OpenRouter Dynamic Model Discovery
 *
 * Fetches ALL models from OpenRouter API dynamically.
 * Provides:
 * - Full model catalog (300+ models)
 * - Automatic caching
 * - Metadata (pricing, context limits, capabilities)
 * - Model validation
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ModelConfig, ProviderInfo } from './model-provider.js';

// ============================================================================
// Types
// ============================================================================

/**
 * OpenRouter model from API response.
 * Based on actual API response structure from https://openrouter.ai/api/v1/models
 */
export interface OpenRouterModel {
    id: string;
    name: string;
    context_length: number;
    /** May be undefined for some models */
    max_completion_tokens?: number;
    pricing: {
        /** Price per token (NOT per 1k) as string, e.g., "0.00000175" */
        prompt: string;
        /** Price per token (NOT per 1k) as string, e.g., "0.000007" */
        completion: string;
        /** Optional image pricing */
        image?: string;
        /** Optional request pricing */
        request?: string;
    };
    architecture?: {
        modality?: string;
        tokenizer?: string;
        instruct_type?: string;
    };
    /** Provider display name */
    top_provider?: {
        context_length?: number;
        max_completion_tokens?: number;
        is_moderated?: boolean;
    };
    /**
     * Supported parameters - this is how OpenRouter indicates capabilities.
     * Examples: ["tools", "tool_choice", "temperature", "top_p", "stream", "max_tokens", etc.]
     */
    supported_parameters?: string[];
    /** Description of the model */
    description?: string;
    /** Created timestamp */
    created?: number;
}

export interface OpenRouterModelsResponse {
    data: OpenRouterModel[];
}

// ============================================================================
// Configuration
// ============================================================================

const OPENROUTER_MODELS_API = 'https://openrouter.ai/api/v1/models';

let cachedModels: Map<string, OpenRouterModel> | null = null;
export { cachedModels };
let lastFetchTime: number | null = null;
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Fetch ALL models from OpenRouter.
 * Returns cached results or fresh fetch.
 */
export async function fetchOpenRouterModels(): Promise<Map<string, OpenRouterModel>> {
    if (cachedModels && Date.now() - (lastFetchTime || 0) < CACHE_TTL) {
        return cachedModels;
    }

    const apiKey = process.env.OPENROUTER_API_KEY;

    // Build headers - API key is optional for public models
    const headers: Record<string, string> = {
        'HTTP-Referer': 'https://github.com/gateflow-cli',
        'X-Title': 'GateFlow CLI'
    };

    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    console.log('Fetching OpenRouter model catalog...');

    try {
        const response = await fetch(OPENROUTER_MODELS_API, {
            headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const jsonResponse = await response.json();

        // Handle different possible response structures
        let modelsArray: OpenRouterModel[];
        if (Array.isArray(jsonResponse)) {
            // Response is directly an array
            modelsArray = jsonResponse;
        } else if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
            // Response has data property with array
            modelsArray = jsonResponse.data;
        } else {
            throw new Error(`Unexpected response structure: ${JSON.stringify(Object.keys(jsonResponse))}`);
        }
        
        // Convert to map for fast lookup
        cachedModels = new Map(
            modelsArray.map(model => [model.id, model])
        );
        
        lastFetchTime = Date.now();

        // Count compatible models (tools + structured outputs)
        const compatibleCount = modelsArray.filter(m => {
            const params = m.supported_parameters ?? [];
            const hasTools = params.includes('tools') || params.includes('functions');
            const hasStructured = params.includes('structured_outputs') || params.includes('response_format');
            return hasTools && hasStructured;
        }).length;

        console.log(`Loaded ${compatibleCount} compatible models from OpenRouter`);

        return cachedModels;
    } catch (error) {
        console.error('Failed to fetch OpenRouter models:', error);
        console.log('Falling back to default models...');
        return getFallbackModels();
    }
}

/**
 * Standard supported parameters for tool-capable models.
 */
const STANDARD_TOOL_PARAMS = ['tools', 'tool_choice', 'temperature', 'top_p', 'stream', 'max_tokens', 'stop'];

/**
 * Fallback models if API fetch fails or no key.
 * Pricing is per-token (matching real API format).
 */
function getFallbackModels(): Map<string, OpenRouterModel> {
    return new Map([
        // Claude models
        ['anthropic/claude-opus-4-5-20250514', {
            id: 'anthropic/claude-opus-4-5-20250514',
            name: 'Claude Opus 4.5 (Reasoning)',
            context_length: 200000,
            max_completion_tokens: 8192,
            // Pricing per token: $15/1M input, $75/1M output
            pricing: { prompt: '0.000015', completion: '0.000075' },
            supported_parameters: [...STANDARD_TOOL_PARAMS, 'structured_outputs']
        }],
        ['anthropic/claude-sonnet-4-20250514', {
            id: 'anthropic/claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            context_length: 200000,
            max_completion_tokens: 8192,
            // Pricing per token: $3/1M input, $15/1M output
            pricing: { prompt: '0.000003', completion: '0.000015' },
            supported_parameters: [...STANDARD_TOOL_PARAMS, 'structured_outputs']
        }],
        ['anthropic/claude-haiku-3-5-20241022', {
            id: 'anthropic/claude-haiku-3-5-20241022',
            name: 'Claude Haiku 3.5 (Fast/Cheap)',
            context_length: 200000,
            max_completion_tokens: 8192,
            // Pricing per token: $0.25/1M input, $1.25/1M output
            pricing: { prompt: '0.00000025', completion: '0.00000125' },
            supported_parameters: [...STANDARD_TOOL_PARAMS, 'structured_outputs']
        }],

        // OpenAI models
        ['openai/gpt-4o', {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            context_length: 128000,
            max_completion_tokens: 4096,
            // Pricing per token: $2.5/1M input, $10/1M output
            pricing: { prompt: '0.0000025', completion: '0.00001' },
            supported_parameters: [...STANDARD_TOOL_PARAMS, 'structured_outputs', 'response_format']
        }],
        ['openai/gpt-4o-mini', {
            id: 'openai/gpt-4o-mini',
            name: 'GPT-4o Mini',
            context_length: 128000,
            max_completion_tokens: 16384,
            // Pricing per token: $0.15/1M input, $0.6/1M output
            pricing: { prompt: '0.00000015', completion: '0.0000006' },
            supported_parameters: [...STANDARD_TOOL_PARAMS, 'structured_outputs', 'response_format']
        }],
        ['openai/o1-preview', {
            id: 'openai/o1-preview',
            name: 'o1 Preview (Reasoning)',
            context_length: 128000,
            max_completion_tokens: 32768,
            // Pricing per token: $15/1M input, $60/1M output
            pricing: { prompt: '0.000015', completion: '0.00006' },
            // o1 models have limited parameter support
            supported_parameters: ['temperature', 'max_tokens', 'stream']
        }],
        ['openai/o3-mini', {
            id: 'openai/o3-mini',
            name: 'o3-mini (Reasoning)',
            context_length: 200000,
            max_completion_tokens: 100000,
            // Pricing per token: $1.1/1M input, $4.4/1M output
            pricing: { prompt: '0.0000011', completion: '0.0000044' },
            supported_parameters: ['temperature', 'max_tokens', 'stream', 'reasoning_effort']
        }],

        // Google models
        ['google/gemini-2.5-pro', {
            id: 'google/gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            context_length: 1000000,
            max_completion_tokens: 8192,
            // Pricing per token: $1.25/1M input, $5/1M output (>128k context)
            pricing: { prompt: '0.00000125', completion: '0.000005' },
            supported_parameters: [...STANDARD_TOOL_PARAMS, 'structured_outputs']
        }],
        ['google/gemini-2.5-flash', {
            id: 'google/gemini-2.5-flash',
            name: 'Gemini 2.5 Flash',
            context_length: 1000000,
            max_completion_tokens: 8192,
            // Pricing per token: $0.075/1M input, $0.3/1M output
            pricing: { prompt: '0.000000075', completion: '0.0000003' },
            supported_parameters: [...STANDARD_TOOL_PARAMS, 'structured_outputs']
        }],

        // xAI (Grok) models
        ['xai/grok-2', {
            id: 'xai/grok-2',
            name: 'Grok 2',
            context_length: 131072,
            max_completion_tokens: 8192,
            // Pricing per token: $2/1M input, $10/1M output
            pricing: { prompt: '0.000002', completion: '0.00001' },
            supported_parameters: [...STANDARD_TOOL_PARAMS]
        }],

        // DeepSeek models
        ['deepseek/deepseek-chat', {
            id: 'deepseek/deepseek-chat',
            name: 'DeepSeek Chat V3',
            context_length: 64000,
            max_completion_tokens: 8192,
            // Pricing per token: $0.14/1M input, $0.28/1M output
            pricing: { prompt: '0.00000014', completion: '0.00000028' },
            supported_parameters: [...STANDARD_TOOL_PARAMS]
        }],
        ['deepseek/deepseek-reasoner', {
            id: 'deepseek/deepseek-reasoner',
            name: 'DeepSeek R1 (Reasoning)',
            context_length: 64000,
            max_completion_tokens: 8192,
            // Pricing per token: $0.55/1M input, $2.19/1M output
            pricing: { prompt: '0.00000055', completion: '0.00000219' },
            supported_parameters: ['temperature', 'max_tokens', 'stream']
        }],
    ]);
}

/**
 * Get model metadata by ID.
 */
export function getOpenRouterModel(modelId: string): OpenRouterModel | undefined {
    return cachedModels?.get(modelId);
}

/**
 * Extract provider name from model ID.
 * e.g., "anthropic/claude-sonnet-4" → "anthropic"
 */
export function getProviderFromId(modelId: string): string {
    return modelId.split('/')[0] || 'unknown';
}

/**
 * Get models grouped by provider.
 */
export function getModelsByProvider(): Map<string, OpenRouterModel[]> {
    const grouped = new Map<string, OpenRouterModel[]>();

    if (!cachedModels) {
        console.warn('OpenRouter models not cached yet');
        return grouped;
    }

    for (const [id, model] of cachedModels) {
        const provider = getProviderFromId(id);
        const models = grouped.get(provider) || [];
        models.push(model);
        grouped.set(provider, models);
    }

    return grouped;
}

/**
 * Get all model IDs.
 */
export function getAllModelIds(): string[] {
    return cachedModels ? Array.from(cachedModels.keys()) : [];
}

/**
 * Check if a model supports a specific parameter/capability.
 * @param model - The model to check
 * @param param - Parameter name (e.g., "tools", "tool_choice", "stream")
 */
export function modelSupportsParameter(model: OpenRouterModel, param: string): boolean {
    return model.supported_parameters?.includes(param) ?? false;
}

/**
 * Get models with tool support.
 * Checks for "tools" in supported_parameters array.
 */
export function getModelsSupportingTools(): OpenRouterModel[] {
    if (!cachedModels) return [];

    return Array.from(cachedModels.values()).filter(model =>
        modelSupportsParameter(model, 'tools') || modelSupportsParameter(model, 'functions')
    );
}

/**
 * Get models with structured output support.
 * Checks for "structured_outputs" or "response_format" in supported_parameters.
 */
export function getModelsSupportingStructuredOutput(): OpenRouterModel[] {
    if (!cachedModels) return [];

    return Array.from(cachedModels.values()).filter(model =>
        modelSupportsParameter(model, 'structured_outputs') ||
        modelSupportsParameter(model, 'response_format')
    );
}

/**
 * Format model name for display.
 */
export function formatModelName(modelId: string): string {
    const model = cachedModels?.get(modelId);
    return model?.name || modelId;
}

/**
 * Get pricing info for cost estimation.
 */
export function getModelPricing(modelId: string): { prompt: string; completion: string } | null {
    const model = cachedModels?.get(modelId);
    return model?.pricing || null;
}

/**
 * Clear model cache (useful for testing).
 */
export function clearCache(): void {
    cachedModels = null;
    lastFetchTime = null;
    console.log('OpenRouter model cache cleared');
}

/**
 * Prefetch models in background (call this after agent initialization).
 */
export async function prefetchOpenRouterModels(): Promise<void> {
    try {
        console.log('Prefetching OpenRouter models in background...');
        await fetchOpenRouterModels();
    } catch (error) {
        console.warn('Failed to prefetch OpenRouter models:', error);
    }
}

// ============================================================================
// Pricing Utilities
// ============================================================================

/**
 * Fallback pricing for direct provider models (not via OpenRouter).
 * Used when OpenRouter cache doesn't have the model.
 * Prices are per 1M tokens (input, output).
 *
 * Last updated: January 2026
 * Sources:
 * - Anthropic: https://www.anthropic.com/pricing
 * - OpenAI: https://openai.com/api/pricing/
 * - Google: https://ai.google.dev/pricing
 * - Mistral: https://mistral.ai/technology/#pricing
 * - DeepSeek: https://platform.deepseek.com/pricing
 */
const DIRECT_PROVIDER_PRICING: Record<string, { input: number; output: number }> = {
    // Anthropic Claude (direct API pricing)
    'claude-opus-4-5-20251101': { input: 15, output: 75 },
    'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
    'claude-opus-4-1-20250805': { input: 15, output: 75 },
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
    'claude-opus-4-20250514': { input: 15, output: 75 },
    'claude-3-5-haiku-20241022': { input: 0.80, output: 4 },
    'claude-3-5-sonnet-20241022': { input: 3, output: 15 },

    // OpenAI (direct API pricing)
    'gpt-5.2': { input: 21, output: 168 },
    'gpt-5.1': { input: 15, output: 60 },
    'gpt-5': { input: 10, output: 30 },
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'o3': { input: 10, output: 40 },
    'o3-pro': { input: 20, output: 80 },
    'o4-mini': { input: 1.1, output: 4.4 },
    'o1': { input: 15, output: 60 },
    'o1-preview': { input: 15, output: 60 },
    'o1-mini': { input: 3, output: 12 },

    // Google Gemini (direct API pricing)
    'gemini-2.5-pro': { input: 1.25, output: 5 },
    'gemini-2.5-flash': { input: 0.075, output: 0.3 },
    'gemini-2.5-flash-lite': { input: 0.02, output: 0.08 },
    'gemini-3-pro-preview': { input: 2, output: 8 },
    'gemini-3-flash-preview': { input: 0.15, output: 0.6 },

    // Mistral (direct API pricing)
    'mistral-large-latest': { input: 2, output: 6 },
    'mistral-small-latest': { input: 0.2, output: 0.6 },
    'codestral-latest': { input: 0.3, output: 0.9 },
    'magistral-small': { input: 0.5, output: 1.5 },
    'magistral-medium': { input: 2, output: 6 },

    // DeepSeek (direct API pricing - very cheap)
    'deepseek-chat': { input: 0.14, output: 0.28 },
    'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

/**
 * Calculate cost for a given number of tokens.
 * OpenRouter pricing is per-token (e.g., "0.000003" = $0.000003 per token = $3/1M tokens).
 *
 * @param modelId - The model ID
 * @param inputTokens - Number of input/prompt tokens
 * @param outputTokens - Number of output/completion tokens
 * @returns Cost in USD, or null if model not found
 */
export function calculateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
): number | null {
    const model = cachedModels?.get(modelId);
    if (!model?.pricing) return null;

    const inputCost = parseFloat(model.pricing.prompt) * inputTokens;
    const outputCost = parseFloat(model.pricing.completion) * outputTokens;

    return inputCost + outputCost;
}

// Filesystem cache reference (set by ModelCapabilityService)
let filesystemCache: Record<string, { pricing?: { input: number; output: number } }> | null = null;

/**
 * Set filesystem cache reference for offline pricing lookup.
 * Called by ModelCapabilityService after loading from disk.
 */
export function setFilesystemPricingCache(cache: Record<string, { pricing?: { input: number; output: number } }>): void {
    filesystemCache = cache;
}

/**
 * Get cost per million tokens for easier comparison.
 * Lookup order:
 * 1. OpenRouter memory cache (freshest, from API)
 * 2. Filesystem cache (persisted, works offline)
 * 3. Hardcoded fallback (always works, may be stale)
 *
 * @param modelId - The model ID (with or without provider prefix)
 * @returns Object with input/output cost per 1M tokens, or null if not found
 */
export function getCostPerMillion(modelId: string): { input: number; output: number } | null {
    // 1. Try OpenRouter memory cache first (most accurate, dynamically fetched)
    const model = cachedModels?.get(modelId);
    if (model?.pricing) {
        return {
            input: parseFloat(model.pricing.prompt) * 1_000_000,
            output: parseFloat(model.pricing.completion) * 1_000_000
        };
    }

    // Try with provider prefix for OpenRouter format
    // e.g., "claude-sonnet-4" -> "anthropic/claude-sonnet-4"
    if (!modelId.includes('/')) {
        for (const [id, m] of cachedModels?.entries() ?? []) {
            if (id.endsWith('/' + modelId) && m.pricing) {
                return {
                    input: parseFloat(m.pricing.prompt) * 1_000_000,
                    output: parseFloat(m.pricing.completion) * 1_000_000
                };
            }
        }
    }

    // 2. Try filesystem cache (works offline after first fetch)
    const fsModel = filesystemCache?.[modelId];
    if (fsModel?.pricing) {
        return fsModel.pricing;
    }
    // Try with provider prefix in filesystem cache
    if (!modelId.includes('/') && filesystemCache) {
        for (const [id, m] of Object.entries(filesystemCache)) {
            if (id.endsWith('/' + modelId) && m.pricing) {
                return m.pricing;
            }
        }
    }

    // 3. Fall back to hardcoded pricing (for non-OpenRouter users or offline)
    // Strip provider prefix if present for lookup
    const modelName = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
    const directPricing = DIRECT_PROVIDER_PRICING[modelName];
    if (directPricing) {
        return directPricing;
    }

    // Try partial match for date-suffixed models
    // e.g., "claude-sonnet-4-5-20250929" matches "claude-sonnet-4-5"
    for (const [key, pricing] of Object.entries(DIRECT_PROVIDER_PRICING)) {
        if (modelName.startsWith(key) || (modelName.replace(/-\d{8}$/, '') && key.startsWith(modelName.replace(/-\d{8}$/, '')))) {
            return pricing;
        }
    }

    return null;
}

/**
 * Async version of getCostPerMillion that ensures pricing data is loaded.
 * Fetches from OpenRouter if cache is empty (no API key required for public pricing).
 *
 * @param modelId - The model ID
 * @returns Object with input/output cost per 1M tokens, or null if not found
 */
export async function getCostPerMillionAsync(modelId: string): Promise<{ input: number; output: number } | null> {
    // Ensure cache is populated
    if (!cachedModels) {
        try {
            await fetchOpenRouterModels();
        } catch {
            // Fetch failed, will fall back to hardcoded pricing
        }
    }
    return getCostPerMillion(modelId);
}

/**
 * Ensure pricing data is loaded from OpenRouter.
 * Call this at startup to have pricing available synchronously later.
 * No API key required - OpenRouter pricing is public.
 */
export async function ensurePricingLoaded(): Promise<void> {
    if (cachedModels) return;
    try {
        await fetchOpenRouterModels();
    } catch (error) {
        console.warn('Could not fetch pricing data:', error);
        console.log('Using hardcoded fallback pricing');
    }
}

/**
 * Compare models by cost (input + output weighted).
 * Returns models sorted from cheapest to most expensive.
 *
 * @param modelIds - Array of model IDs to compare
 * @param outputWeight - Weight for output tokens (default: 3, assuming 1:3 input:output ratio)
 */
export function sortModelsByCost(
    modelIds: string[],
    outputWeight: number = 3
): string[] {
    return modelIds
        .map(id => {
            const model = cachedModels?.get(id);
            if (!model?.pricing) return { id, cost: Infinity };
            const inputCost = parseFloat(model.pricing.prompt);
            const outputCost = parseFloat(model.pricing.completion);
            // Weighted average cost
            const cost = inputCost + (outputCost * outputWeight);
            return { id, cost };
        })
        .sort((a, b) => a.cost - b.cost)
        .map(m => m.id);
}

/**
 * Get the cheapest model that supports tools from a list.
 *
 * @param modelIds - Array of model IDs to check
 * @returns The cheapest tool-supporting model ID, or null if none found
 */
export function getCheapestToolModel(modelIds?: string[]): string | null {
    const ids = modelIds || (cachedModels ? Array.from(cachedModels.keys()) : []);
    const toolModels = ids.filter(id => {
        const model = cachedModels?.get(id);
        return model && modelSupportsParameter(model, 'tools');
    });

    if (toolModels.length === 0) return null;

    const sorted = sortModelsByCost(toolModels);
    return sorted[0] || null;
}

// ============================================================================
// Capability Detection (compatible with ModelCapabilityService)
// ============================================================================

/**
 * Model capabilities structure (compatible with ModelCapabilityService).
 * Includes optional pricing for offline cost tracking.
 */
export interface ModelCapabilities {
    tools: boolean;
    structuredOutputs: boolean;
    reasoning: boolean;
    /** Pricing per 1M tokens (included for offline caching) */
    pricing?: {
        input: number;
        output: number;
    };
}

/**
 * Get capabilities for a model from cached data.
 * This is the single source of truth for OpenRouter model capabilities.
 * Includes pricing for offline use.
 *
 * @param modelId - The model ID to check
 * @returns ModelCapabilities object with pricing if available, or null if model not found
 */
export function getModelCapabilities(modelId: string): ModelCapabilities | null {
    const model = cachedModels?.get(modelId);

    if (!model) {
        // Model not found - return null to distinguish from models with all false capabilities
        return null;
    }

    const params = model.supported_parameters ?? [];
    const caps: ModelCapabilities = {
        tools: params.includes('tools') || params.includes('functions'),
        structuredOutputs: params.includes('structured_outputs') || params.includes('response_format'),
        reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
    };

    // Include pricing if available (for offline caching)
    if (model.pricing) {
        caps.pricing = {
            input: parseFloat(model.pricing.prompt) * 1_000_000,
            output: parseFloat(model.pricing.completion) * 1_000_000
        };
    }

    return caps;
}

/**
 * Check if a model supports both tools and structured outputs.
 * This is required for thinking/reasoning modes with structured output.
 *
 * @param modelId - The model ID to check
 * @returns True if model supports both capabilities
 */
export function isModelCompatible(modelId: string): boolean {
    const caps = getModelCapabilities(modelId);
    return caps !== null && caps.tools && caps.structuredOutputs;
}

/**
 * Get all compatible models (have both tools AND structuredOutputs).
 *
 * @returns Array of model IDs that support both capabilities
 */
export function getCompatibleModelIds(): string[] {
    if (!cachedModels) return [];

    return Array.from(cachedModels.keys()).filter(isModelCompatible);
}

/**
 * Get all capabilities for all cached models.
 * Useful for bulk operations or caching.
 *
 * @returns Map of model ID to capabilities
 */
export function getAllModelCapabilities(): Map<string, ModelCapabilities> {
    const result = new Map<string, ModelCapabilities>();

    if (!cachedModels) return result;

    for (const modelId of cachedModels.keys()) {
        const caps = getModelCapabilities(modelId);
        if (caps !== null) {
            result.set(modelId, caps);
        }
    }

    return result;
}

