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

export interface OpenRouterModel {
    id: string;
    name: string;
    context_length: number;
    max_completion_tokens: number;
    pricing: {
        prompt: string;
        completion: string;
    };
    architecture: {
        modality: string[];
        tokenizer: string[];
    };
    top_provider: string;
    supports_tools: boolean;
    supports_functions: boolean;
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
        console.log(`📋 Using cached OpenRouter models (${cachedModels.size})`);
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

    try {
        if (apiKey) {
            console.log('🔄 Fetching OpenRouter model catalog (with API key)...');
        } else {
            console.log('🔄 Fetching OpenRouter model catalog (public models only)...');
        }
        
        const response = await fetch(OPENROUTER_MODELS_API, {
            headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const jsonResponse = await response.json();
        
        // Debug: Log the response structure
        if (process.env.VERBOSE) {
            console.log('📊 OpenRouter API response keys:', Object.keys(jsonResponse));
            if (jsonResponse.data) {
                console.log(`📊 Found ${jsonResponse.data.length} models in response`);
            }
        }
        
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
        console.log(`✅ Loaded ${cachedModels.size} models from OpenRouter`);
        
        return cachedModels;
    } catch (error) {
        console.error('❌ Failed to fetch OpenRouter models:', error);
        console.error('   Falling back to default models...');
        return getFallbackModels();
    }
}

/**
 * Fallback models if API fetch fails or no key.
 */
function getFallbackModels(): Map<string, OpenRouterModel> {
    return new Map([
        // Claude models
        ['anthropic/claude-opus-4-5-20250514', {
            id: 'anthropic/claude-opus-4-5-20250514',
            name: 'Claude Opus 4 (Reasoning)',
            context_length: 200000,
            max_completion_tokens: 8192,
            pricing: { prompt: '15.0', completion: '75.0' },
            architecture: { modality: ['text', 'tool-use'], tokenizer: ['cl100k'] },
            top_provider: 'Anthropic',
            supports_tools: true,
            supports_functions: true
        }],
        ['anthropic/claude-sonnet-4-20250514', {
            id: 'anthropic/claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
            context_length: 200000,
            max_completion_tokens: 8192,
            pricing: { prompt: '3.0', completion: '15.0' },
            architecture: { modality: ['text', 'tool-use'], tokenizer: ['cl100k'] },
            top_provider: 'Anthropic',
            supports_tools: true,
            supports_functions: true
        }],
        ['anthropic/claude-haiku-3-5-20241022', {
            id: 'anthropic/claude-haiku-3-5-20241022',
            name: 'Claude Haiku 3 (Fast/Cheap)',
            context_length: 200000,
            max_completion_tokens: 8192,
            pricing: { prompt: '0.25', completion: '1.25' },
            architecture: { modality: ['text', 'tool-use'], tokenizer: ['cl100k'] },
            top_provider: 'Anthropic',
            supports_tools: true,
            supports_functions: true
        }],
        
        // OpenAI models
        ['openai/gpt-4o', {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            context_length: 128000,
            max_completion_tokens: 4096,
            pricing: { prompt: '2.5', completion: '10.0' },
            architecture: { modality: ['text', 'tool-use'], tokenizer: ['cl100k'] },
            top_provider: 'OpenAI',
            supports_tools: true,
            supports_functions: true
        }],
        ['openai/gpt-4o-mini', {
            id: 'openai/gpt-4o-mini',
            name: 'GPT-4o Mini',
            context_length: 128000,
            max_completion_tokens: 16384,
            pricing: { prompt: '0.15', completion: '0.6' },
            architecture: { modality: ['text', 'tool-use'], tokenizer: ['cl100k'] },
            top_provider: 'OpenAI',
            supports_tools: true,
            supports_functions: true
        }],
        ['openai/o1-preview', {
            id: 'openai/o1-preview',
            name: 'GPT-4.1 Preview',
            context_length: 128000,
            max_completion_tokens: 4096,
            pricing: { prompt: '15.0', completion: '60.0' },
            architecture: { modality: ['text', 'tool-use'], tokenizer: ['cl100k'] },
            top_provider: 'OpenAI',
            supports_tools: true,
            supports_functions: true
        }],
        ['openai/o3-mini', {
            id: 'openai/o3-mini',
            name: 'GPT-3.5 Mini',
            context_length: 16384,
            max_completion_tokens: 4096,
            pricing: { prompt: '0.1', completion: '0.4' },
            architecture: { modality: ['text'], tokenizer: ['cl100k'] },
            top_provider: 'OpenAI',
            supports_tools: true,
            supports_functions: true
        }],
        ['openai/gpt-3.5-turbo-0125', {
            id: 'openai/gpt-3.5-turbo-0125',
            name: 'GPT-3.5 Turbo',
            context_length: 16384,
            max_completion_tokens: 4096,
            pricing: { prompt: '0.5', completion: '2.0' },
            architecture: { modality: ['text'], tokenizer: ['cl100k'] },
            top_provider: 'OpenAI',
            supports_tools: true,
            supports_functions: false
        }],
        
        // Google models
        ['google/gemini-2.5-pro', {
            id: 'google/gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            context_length: 1000000,
            max_completion_tokens: 8192,
            pricing: { prompt: '0.35', completion: '1.40' },
            architecture: { modality: ['text', 'tool-use', 'code-execution'], tokenizer: ['cl100k'] },
            top_provider: 'Google',
            supports_tools: true,
            supports_functions: true
        }],
        ['google/gemini-2.5-flash', {
            id: 'google/gemini-2.5-flash',
            name: 'Gemini 2.5 Flash',
            context_length: 1000000,
            max_completion_tokens: 8192,
            pricing: { prompt: '0.075', completion: '0.30' },
            architecture: { modality: ['text', 'tool-use', 'code-execution'], tokenizer: ['cl100k'] },
            top_provider: 'Google',
            supports_tools: true,
            supports_functions: true
        }],
        
        // xAI (Grok) models
        ['xai/grok-2', {
            id: 'xai/grok-2',
            name: 'Grok 2',
            context_length: 200000,
            max_completion_tokens: 8192,
            pricing: { prompt: '0.50', completion: '5.0' },
            architecture: { modality: ['text', 'tool-use'], tokenizer: ['cl100k'] },
            top_provider: 'xAI',
            supports_tools: true,
            supports_functions: true
        }],
        
        // DeepSeek models
        ['deepseek/deepseek-chat', {
            id: 'deepseek/deepseek-chat',
            name: 'DeepSeek Chat',
            context_length: 64000,
            max_completion_tokens: 32768,
            pricing: { prompt: '0.14', completion: '0.28' },
            architecture: { modality: ['text', 'code-execution'], tokenizer: ['cl100k'] },
            top_provider: 'DeepSeek',
            supports_tools: true,
            supports_functions: true
        }],
        ['deepseek/deepseek-coder', {
            id: 'deepseek/deepseek-coder',
            name: 'DeepSeek Coder V2',
            context_length: 128000,
            max_completion_tokens: 8192,
            pricing: { prompt: '0.14', completion: '0.28' },
            architecture: { modality: ['text', 'code-execution'], tokenizer: ['cl100k'] },
            top_provider: 'DeepSeek',
            supports_tools: true,
            supports_functions: true
        }],
        
        // And 100+ more models available through OpenRouter...
        // Meta Llama, Qwen, Mistral, Cohere, etc.
    ]);
}

/**
 * Get model metadata by ID.
 */
export function getOpenRouterModel(modelId: string): OpenRouterModel | undefined {
    return cachedModels?.get(modelId);
}

/**
 * Get models grouped by provider.
 */
export function getModelsByProvider(): Map<string, OpenRouterModel[]> {
    const grouped = new Map<string, OpenRouterModel[]>();
    
    if (!cachedModels) {
        console.warn('⚠️  OpenRouter models not cached yet');
        return grouped;
    }

    for (const [id, model] of cachedModels) {
        const provider = model.top_provider;
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
 * Get models with tool support.
 */
export function getModelsSupportingTools(): OpenRouterModel[] {
    if (!cachedModels) return [];
    
    return Array.from(cachedModels.values()).filter(model => model.supports_tools);
}

/**
 * Get models with function calling support.
 */
export function getModelsSupportingFunctions(): OpenRouterModel[] {
    if (!cachedModels) return [];
    
    return Array.from(cachedModels.values()).filter(model => model.supports_functions);
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
    console.log('🗑️  OpenRouter model cache cleared');
}

/**
 * Prefetch models in background (call this after agent initialization).
 */
export async function prefetchOpenRouterModels(): Promise<void> {
    try {
        console.log('🔄 Prefetching OpenRouter models in background...');
        await fetchOpenRouterModels();
    } catch (error) {
        console.warn('⚠️  Failed to prefetch OpenRouter models:', error);
    }
}

