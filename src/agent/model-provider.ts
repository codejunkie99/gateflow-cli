/**
 * Multi-Provider Model Abstraction
 *
 * Supports: Anthropic, OpenAI, Google, xAI, DeepSeek, Zhipu, Minimax
 *
 * Design decisions:
 * 1. ESM-compatible top-level imports for installed SDKs
 * 2. Backward compatible - existing code works unchanged
 * 3. Provider detection via environment variables
 * 4. OpenAI-compatible API for providers without dedicated SDK
 * 5. Validation with clear error messages
 *
 * @module agent/model-provider
 */

import '../env/bootstrap-env.js';
import { anthropic } from '@ai-sdk/anthropic';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { xai } from '@ai-sdk/xai';
import { groq } from '@ai-sdk/groq';
import { mistral } from '@ai-sdk/mistral';
import type { LanguageModel } from 'ai';
import {
    type VariantName,
    type ModelConfigWithVariant,
    type ModelVariantOptions,
    extractVariant,
    getVariantOptions,
    getVariantProviderOptions,
} from './model-variants.js';

// Re-export variant types and functions for convenience
export type { VariantName, ModelConfigWithVariant, ModelVariantOptions };
export { getVariantProviderOptions };

// ============================================================================
// Types
// ============================================================================

export type ProviderName =
    | 'anthropic'
    | 'openai'
    | 'google'
    | 'xai'
    | 'deepseek'
    | 'zhipu'
    | 'minimax'
    | 'openrouter'
    | 'groq'
    | 'mistral'
    | 'ollama';

export interface ModelConfig {
    provider: ProviderName;
    model: string;
}

export interface ProviderInfo {
    name: string;
    envVar: string;
    docUrl: string;
    defaultModel: string;
    models: string[];
}

// ============================================================================
// Provider Registry (January 2026 - Latest Models)
// ============================================================================

export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
    anthropic: {
        name: 'Anthropic (Claude)',
        envVar: 'ANTHROPIC_API_KEY',
        docUrl: 'https://console.anthropic.com/settings/keys',
        defaultModel: 'claude-sonnet-4-20250514',
        models: [
            'claude-opus-4-5-20251101',      // Most capable, extended thinking
            'claude-sonnet-4-20250514',      // Best balance (recommended)
            'claude-haiku-4-5-20251201',     // Fastest, most cost-efficient
        ]
    },
    openai: {
        name: 'OpenAI (GPT)',
        envVar: 'OPENAI_API_KEY',
        docUrl: 'https://platform.openai.com/api-keys',
        defaultModel: 'gpt-5',
        models: [
            'gpt-5.2',          // Latest (Dec 2025) - SOTA on ARC-AGI
            'gpt-5',            // Default in ChatGPT, replaces 4o
            'o3',               // Most powerful reasoning model
            'o3-pro',           // Extended thinking version
            'o4-mini',          // Fast reasoning, best on AIME
            'gpt-4.1',          // Coding specialist, 1M context
            'gpt-4o',           // Previous flagship
            'gpt-4o-mini',      // Fast, cost-efficient
        ]
    },
    google: {
        name: 'Google (Gemini)',
        envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
        docUrl: 'https://aistudio.google.com/apikey',
        defaultModel: 'gemini-2.5-flash',
        models: [
            'gemini-2.5-pro',       // Most powerful, adaptive thinking
            'gemini-2.5-flash',     // Fast and capable
            'gemini-2.5-flash-lite', // Lowest latency/cost
            'gemini-2.0-flash',     // Legacy (retiring Mar 2026)
        ]
    },
    xai: {
        name: 'xAI (Grok)',
        envVar: 'XAI_API_KEY',
        docUrl: 'https://console.x.ai/team',
        defaultModel: 'grok-4',
        models: [
            'grok-4.1-fast',    // Latest fast (Nov 2025)
            'grok-4.1',         // Nov 2025, 65% less hallucination
            'grok-4',           // "Most intelligent" with tool use
            'grok-3',           // Previous flagship
            'grok-3-mini',      // Fast reasoning
        ]
    },
    deepseek: {
        name: 'DeepSeek',
        envVar: 'DEEPSEEK_API_KEY',
        docUrl: 'https://platform.deepseek.com/api_keys',
        defaultModel: 'deepseek-chat',
        models: [
            'deepseek-chat',        // V3 base, general tasks
            'deepseek-reasoner',    // R1 reasoning model
            'deepseek-coder',       // Code-specialized
        ]
    },
    zhipu: {
        name: 'Zhipu (GLM)',
        envVar: 'ZHIPU_API_KEY',
        docUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
        defaultModel: 'glm-4.7',
        models: [
            'glm-4.7',          // Latest (Dec 2025) - 400B params, deep reasoning
            'glm-4.6',          // MoE model (Sep 2025) - 355B/32B active
            'glm-4.5',          // July 2025
            'glm-4-flash',      // Fast, cost-efficient
        ]
    },
    minimax: {
        name: 'MiniMax',
        envVar: 'MINIMAX_API_KEY',
        docUrl: 'https://platform.minimax.io',
        defaultModel: 'abab6.5-chat',
        models: [
            'abab6.5-chat',         // Latest chat model
            'abab6.5s-chat',        // Fast version
            'abab5.5-chat',         // Previous gen
        ]
    },
    openrouter: {
        name: 'OpenRouter (300+ models)',
        envVar: 'OPENROUTER_API_KEY',
        docUrl: 'https://openrouter.ai/keys',
        defaultModel: 'anthropic/claude-sonnet-4',
        models: [
            'anthropic/claude-opus-4-5',
            'anthropic/claude-sonnet-4',
            'openai/gpt-5',
            'openai/o3',
            'google/gemini-2.5-pro',
            'meta-llama/llama-3.3-70b-instruct',
        ]
    },
    groq: {
        name: 'Groq (Fast inference)',
        envVar: 'GROQ_API_KEY',
        docUrl: 'https://console.groq.com/keys',
        defaultModel: 'llama-3.3-70b-versatile',
        models: [
            'llama-3.3-70b-versatile',
            'llama-3.1-8b-instant',
            'mixtral-8x7b-32768',
        ]
    },
    mistral: {
        name: 'Mistral AI',
        envVar: 'MISTRAL_API_KEY',
        docUrl: 'https://console.mistral.ai/api-keys/',
        defaultModel: 'mistral-large-latest',
        models: [
            'mistral-large-latest',
            'mistral-medium-latest',
            'codestral-latest',
        ]
    },
    ollama: {
        name: 'Ollama (Local)',
        envVar: 'OLLAMA_BASE_URL',  // Optional, defaults to localhost
        docUrl: 'https://ollama.ai/download',
        defaultModel: 'llama3.1',
        models: [
            'llama3.1',
            'llama3.1:70b',
            'codellama',
            'deepseek-coder-v2',
        ]
    }
};

// ============================================================================
// API Key Format Patterns (for client-side validation)
// ============================================================================

/**
 * Regex patterns for validating API key formats by provider.
 * These patterns validate the prefix and structure before making API calls.
 *
 * Sources:
 * - Anthropic: sk-ant-api03-[48-95 chars]
 * - OpenAI: sk- or sk-proj- or sk-None- or sk-svcacct- [20-160 chars]
 * - Google: AIza[35 chars]
 * - xAI: xai-[40+ chars]
 * - DeepSeek: sk-[40+ chars] (OpenAI-compatible)
 * - Zhipu/MiniMax: Generic alphanumeric [32+ chars]
 */
/**
 * API Key Format Patterns - Based on GitGuardian, Gitleaks, and official documentation.
 *
 * Key findings from security scanning tools:
 * - Anthropic: Always ends with "AA", total 107 chars
 * - OpenAI: Contains base64 marker "T3BlbkFJ" (= "OpenAI")
 * - Google: Always starts with "AIza", exactly 39 chars total
 * - DeepSeek: Uses "sk-" prefix + 32 lowercase alphanumeric chars
 * - Zhipu: Two-part format with dot separator
 */
export const API_KEY_PATTERNS: Record<ProviderName, { regex: RegExp; description: string; example: string }> = {
    anthropic: {
        // Verified: sk-ant-api03-[93 chars]AA (total 107 chars, always ends with AA)
        // Source: GitGuardian, Gitleaks
        regex: /^sk-ant-api03-[A-Za-z0-9_-]{91,95}AA$/,
        description: 'Anthropic keys: "sk-ant-api03-" + ~93 chars + "AA" (107 total)',
        example: 'sk-ant-api03-[93 alphanumeric chars]AA'
    },
    openai: {
        // Verified: All OpenAI keys contain "T3BlbkFJ" (base64 "OpenAI")
        // Legacy: sk-[20]T3BlbkFJ[20] (51 chars)
        // Project: sk-proj-[58-74]T3BlbkFJ[58-74] (~164 chars)
        // Also allow generic sk- pattern for flexibility
        regex: /^sk-(proj-|svcacct-|admin-|None-)?[A-Za-z0-9_-]{20,80}(T3BlbkFJ[A-Za-z0-9_-]{20,80})?$/,
        description: 'OpenAI keys: "sk-" prefix, often contain "T3BlbkFJ" marker',
        example: 'sk-proj-xxxx...T3BlbkFJ...xxxx'
    },
    google: {
        // Verified: AIza + 35 chars = 39 total (exact length)
        // Source: Gitleaks, Google docs
        regex: /^AIza[A-Za-z0-9_-]{35}$/,
        description: 'Google keys: "AIza" + exactly 35 chars (39 total)',
        example: 'AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    },
    xai: {
        // xAI (Grok) - Limited public documentation
        // Known prefix: "xai-"
        regex: /^xai-[A-Za-z0-9_-]{20,}$/,
        description: 'xAI keys: "xai-" + 20+ alphanumeric chars',
        example: 'xai-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    },
    deepseek: {
        // Verified: sk-[32 lowercase alphanumeric] (35 total)
        // Source: Semgrep, DeepSeek docs
        // Note: Lowercase only to distinguish from OpenAI
        regex: /^sk-[a-z0-9]{32}$/,
        description: 'DeepSeek keys: "sk-" + exactly 32 lowercase chars (35 total)',
        example: 'sk-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    },
    zhipu: {
        // Verified: {32 hex}.{secret} - Two-part format
        // Source: Zhipu API docs, user confirmation
        regex: /^[a-f0-9]{32}\.[A-Za-z0-9_-]{10,}$/,
        description: 'Zhipu keys: 32-char hex + "." + secret (e.g., abc123...def.XyzSecret)',
        example: '39c8c7b4d7584d6dbf05516cca9c72f4.Avx1htdBdB1RZpE1'
    },
    minimax: {
        // MiniMax - Limited public documentation
        // Known: Alphanumeric, may require GROUP_ID for some regions
        regex: /^[A-Za-z0-9_.-]{20,}$/,
        description: 'MiniMax keys: 20+ alphanumeric chars (may also require GROUP_ID)',
        example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp...'
    },
    openrouter: {
        // OpenRouter keys start with "sk-or-v1-" followed by 64 hex chars
        regex: /^sk-or-v1-[a-f0-9]{64}$/,
        description: 'OpenRouter keys: "sk-or-v1-" + 64 hex chars',
        example: 'sk-or-v1-abc123def456...'
    },
    groq: {
        // Groq keys start with "gsk_" followed by alphanumeric chars
        regex: /^gsk_[A-Za-z0-9]{50,}$/,
        description: 'Groq keys: "gsk_" + 50+ alphanumeric chars',
        example: 'gsk_xxxxxxxxxxxxx...'
    },
    mistral: {
        // Mistral keys are 32-char alphanumeric
        regex: /^[A-Za-z0-9]{32}$/,
        description: 'Mistral keys: 32 alphanumeric chars',
        example: 'abcdef0123456789abcdef0123456789'
    },
    ollama: {
        // Ollama doesn't use API keys - it uses a base URL
        regex: /^https?:\/\/.+/,
        description: 'Ollama base URL (default: http://localhost:11434)',
        example: 'http://localhost:11434'
    }
};

/**
 * Validate API key format before making API calls.
 *
 * @param provider - Provider name
 * @param apiKey - API key to validate
 * @returns Validation result with details
 */
export function validateKeyFormat(
    provider: ProviderName,
    apiKey: string
): { valid: boolean; error?: string; hint?: string } {
    // Basic checks
    if (!apiKey || typeof apiKey !== 'string') {
        return { valid: false, error: 'API key is required' };
    }

    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'API key cannot be empty' };
    }

    // Check for common issues
    if (trimmed !== apiKey) {
        return {
            valid: false,
            error: 'API key has leading/trailing whitespace',
            hint: 'Remove any spaces or newlines from the key'
        };
    }

    if (apiKey.includes('\n') || apiKey.includes('\r')) {
        return {
            valid: false,
            error: 'API key contains newline characters',
            hint: 'Make sure you copied only the key, not surrounding text'
        };
    }

    if (apiKey.includes('"') || apiKey.includes("'")) {
        return {
            valid: false,
            error: 'API key contains quote characters',
            hint: 'Remove any quotes from around the key'
        };
    }

    // Check for non-ASCII characters (common copy-paste issue)
    if (!/^[\x20-\x7E]+$/.test(apiKey)) {
        return {
            valid: false,
            error: 'API key contains non-ASCII or control characters',
            hint: 'Make sure you copied only the key text without any special characters'
        };
    }

    // Check for common invisible characters
    if (/[\u200B-\u200D\uFEFF\u00A0]/.test(apiKey)) {
        return {
            valid: false,
            error: 'API key contains invisible/zero-width characters',
            hint: 'Try typing the key manually or paste it into a plain text editor first'
        };
    }

    // Provider-specific format validation
    const pattern = API_KEY_PATTERNS[provider];
    if (!pattern) {
        return { valid: true }; // Unknown provider, skip format check
    }

    if (!pattern.regex.test(apiKey)) {
        return {
            valid: false,
            error: `Invalid ${PROVIDERS[provider].name} API key format`,
            hint: `${pattern.description}.\nExample: ${pattern.example}`
        };
    }

    return { valid: true };
}

// ============================================================================
// Model Creation
// ============================================================================

/**
 * Create a language model instance for the specified provider/model.
 *
 * Supports optional variant configurations:
 * - Anthropic: Extended thinking with configurable token budgets
 * - OpenAI: Reasoning effort levels for o1/o3 models
 * - Google: Thinking budget configuration
 *
 * @param config - Provider and model configuration (with optional variant)
 * @returns LanguageModel instance ready for use with AI SDK
 * @throws Error if API key is missing or provider is unknown
 */
export function createModel(config: ModelConfig | ModelConfigWithVariant): LanguageModel {
    const { provider, model } = config;
    const variant = 'variant' in config ? config.variant : undefined;
    const providerInfo = PROVIDERS[provider];

    if (!providerInfo) {
        const validProviders = Object.keys(PROVIDERS).join(', ');
        throw new Error(
            `Unknown provider: ${provider}\n` +
            `Valid providers: ${validProviders}`
        );
    }

    const apiKey = process.env[providerInfo.envVar];
    if (!apiKey && provider !== 'ollama') {
        throw new Error(
            `${providerInfo.envVar} not set.\n` +
            `Get your API key at: ${providerInfo.docUrl}`
        );
    }

    // Note: Variant options should be applied via providerOptions at call time
    // (generateText/streamText), not at model creation. Use getVariantProviderOptions()
    // to get the appropriate options for the variant.

    switch (provider) {
        case 'anthropic': {
            // Ensure env var is set before SDK reads it (Windows workaround)
            process.env.ANTHROPIC_API_KEY = apiKey;
            return anthropic(model);
        }

        case 'openai': {
            process.env.OPENAI_API_KEY = apiKey;
            return openai(model);
        }

        case 'google': {
            process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
            return google(model);
        }

        case 'xai': {
            process.env.XAI_API_KEY = apiKey;
            return xai(model);
        }

        case 'deepseek': {
            // DeepSeek uses OpenAI-compatible API
            const deepseek = createOpenAI({
                baseURL: 'https://api.deepseek.com/v1',
                apiKey: apiKey!
            });
            return deepseek(model);
        }

        case 'zhipu': {
            // Zhipu uses OpenAI-compatible API
            const zhipu = createOpenAI({
                baseURL: 'https://open.bigmodel.cn/api/paas/v4',
                apiKey: apiKey!
            });
            return zhipu(model);
        }

        case 'minimax': {
            // MiniMax uses OpenAI-compatible API
            const minimax = createOpenAI({
                baseURL: 'https://api.minimax.chat/v1',
                apiKey: apiKey!
            });
            return minimax(model);
        }

        case 'openrouter': {
            // OpenRouter uses OpenAI-compatible API with special headers
            const openrouter = createOpenAI({
                baseURL: 'https://openrouter.ai/api/v1',
                apiKey: apiKey!,
                headers: {
                    'HTTP-Referer': 'https://github.com/gateflow-cli',
                    'X-Title': 'GateFlow CLI'
                }
            });
            return openrouter(model);
        }

        case 'groq': {
            process.env.GROQ_API_KEY = apiKey;
            return groq(model);
        }

        case 'mistral': {
            process.env.MISTRAL_API_KEY = apiKey;
            return mistral(model);
        }

        case 'ollama': {
            // Ollama uses OpenAI-compatible API with local server
            const baseURL = apiKey || 'http://localhost:11434/v1';
            const ollama = createOpenAI({
                baseURL,
                apiKey: 'ollama'  // Ollama doesn't require a real API key
            });
            return ollama(model);
        }

        default: {
            // TypeScript exhaustiveness check
            const _exhaustive: never = provider;
            throw new Error(`Provider ${_exhaustive} not implemented`);
        }
    }
}

// ============================================================================
// Model String Parsing
// ============================================================================

/**
 * Error thrown when model string parsing fails.
 */
export class ModelParseError extends Error {
    constructor(message: string, public readonly spec: string) {
        super(message);
        this.name = 'ModelParseError';
    }
}

/**
 * Parse a model specification string into provider/model config.
 *
 * Formats supported:
 * - "provider/model" (e.g., "openai/gpt-4o")
 * - "provider/model:variant" (e.g., "anthropic/claude-sonnet-4:high")
 * - "model" alone (infers provider or defaults to Anthropic)
 * - "model:variant" (e.g., "claude-sonnet-4:high")
 *
 * @param spec - Model specification string
 * @returns Parsed ModelConfigWithVariant (includes optional variant)
 * @throws ModelParseError if the provider prefix is invalid
 */
export function parseModelString(spec: string): ModelConfigWithVariant {
    if (!spec || typeof spec !== 'string') {
        return { provider: 'anthropic', model: PROVIDERS.anthropic.defaultModel };
    }

    const trimmed = spec.trim();
    if (!trimmed) {
        return { provider: 'anthropic', model: PROVIDERS.anthropic.defaultModel };
    }

    // Check for provider/model format
    if (trimmed.includes('/')) {
        const slashIndex = trimmed.indexOf('/');
        const providerPart = trimmed.slice(0, slashIndex).toLowerCase();
        const modelPartWithVariant = trimmed.slice(slashIndex + 1);

        if (!modelPartWithVariant) {
            throw new ModelParseError(
                `Invalid model spec: missing model name after '/'`,
                spec
            );
        }

        // Extract variant if present (e.g., "claude-sonnet-4:high")
        const { model: modelPart, variant } = extractVariant(modelPartWithVariant);

        if (providerPart in PROVIDERS) {
            return { provider: providerPart as ProviderName, model: modelPart, variant };
        }

        // Unknown provider prefix - throw error with suggestions
        const validProviders = Object.keys(PROVIDERS).join(', ');
        throw new ModelParseError(
            `Unknown provider: '${providerPart}'\n` +
            `Valid providers: ${validProviders}`,
            spec
        );
    }

    // Extract variant from model-only format (e.g., "claude-sonnet-4:high")
    const { model: cleanSpec, variant } = extractVariant(trimmed);

    // Infer provider from model name patterns
    const lowerSpec = cleanSpec.toLowerCase();

    if (lowerSpec.startsWith('gpt-') || lowerSpec.startsWith('o1') ||
        lowerSpec.startsWith('o3') || lowerSpec.startsWith('o4')) {
        return { provider: 'openai', model: cleanSpec, variant };
    }
    if (lowerSpec.startsWith('gemini-')) {
        return { provider: 'google', model: cleanSpec, variant };
    }
    if (lowerSpec.startsWith('grok-')) {
        return { provider: 'xai', model: cleanSpec, variant };
    }
    if (lowerSpec.startsWith('deepseek')) {
        return { provider: 'deepseek', model: cleanSpec, variant };
    }
    if (lowerSpec.startsWith('glm-') || lowerSpec.startsWith('glm ')) {
        // Normalize "GLM 4.7" to "glm-4.7"
        const normalized = cleanSpec.replace(/^glm\s+/i, 'glm-');
        return { provider: 'zhipu', model: normalized, variant };
    }
    if (lowerSpec.startsWith('abab') || lowerSpec.startsWith('minimax')) {
        return { provider: 'minimax', model: cleanSpec, variant };
    }
    // Groq models (llama, mixtral patterns without provider prefix)
    if (lowerSpec.startsWith('llama-') || lowerSpec.startsWith('mixtral')) {
        return { provider: 'groq', model: cleanSpec, variant };
    }
    // Mistral models
    if (lowerSpec.startsWith('mistral-') || lowerSpec.startsWith('codestral')) {
        return { provider: 'mistral', model: cleanSpec, variant };
    }

    // Default to Anthropic (backward compatibility)
    return { provider: 'anthropic', model: cleanSpec, variant };
}

/**
 * Validate a model config, checking provider API key availability.
 *
 * @param config - Model configuration to validate
 * @returns Validation result with error message if invalid
 */
export function validateModelConfig(config: ModelConfig): { valid: boolean; error?: string } {
    const providerInfo = PROVIDERS[config.provider];
    if (!providerInfo) {
        return {
            valid: false,
            error: `Unknown provider: ${config.provider}`
        };
    }

    // Ollama doesn't require an API key - it uses a local server
    if (config.provider === 'ollama') {
        return { valid: true };
    }

    const apiKey = process.env[providerInfo.envVar];
    if (!apiKey) {
        return {
            valid: false,
            error: `${providerInfo.envVar} not set. Get your API key at: ${providerInfo.docUrl}`
        };
    }

    return { valid: true };
}

// ============================================================================
// Provider Detection
// ============================================================================

/**
 * Detect which providers have API keys configured.
 *
 * Note: Ollama is included if OLLAMA_BASE_URL is set, OR if the default
 * localhost URL is accessible. For local-only mode, set OLLAMA_BASE_URL
 * to enable Ollama detection.
 *
 * @returns Array of available provider names
 */
export function detectAvailableProviders(): ProviderName[] {
    const available = (Object.entries(PROVIDERS) as [ProviderName, ProviderInfo][])
        .filter(([name, info]) => {
            // Ollama is special - it doesn't require an API key
            // Include it if OLLAMA_BASE_URL is explicitly set
            if (name === 'ollama') {
                return Boolean(process.env.OLLAMA_BASE_URL);
            }
            return Boolean(process.env[info.envVar]);
        })
        .map(([name]) => name);

    return available;
}

/**
 * Get the default provider (first one with an API key).
 * Priority: anthropic > openai > google > xai > deepseek > zhipu > minimax
 * @returns Default provider name, or null if none configured
 */
export function getDefaultProvider(): ProviderName | null {
    const available = detectAvailableProviders();
    return available.length > 0 ? available[0] : null;
}

/**
 * Check if at least one provider is configured.
 * @returns True if any provider API key is set
 */
export function hasAnyProvider(): boolean {
    return detectAvailableProviders().length > 0;
}

/**
 * Get the default model config based on available providers.
 * @returns ModelConfig for the first available provider, or Anthropic default
 */
export function getDefaultModelConfig(): ModelConfig {
    const provider = getDefaultProvider();
    if (provider) {
        return {
            provider,
            model: PROVIDERS[provider].defaultModel
        };
    }
    // Fallback to Anthropic (will fail at runtime if no key)
    return {
        provider: 'anthropic',
        model: PROVIDERS.anthropic.defaultModel
    };
}

// ============================================================================
// Backward Compatibility
// ============================================================================

/**
 * Legacy wrapper for existing code.
 * Maintains backward compatibility with direct Anthropic calls.
 *
 * @param model - Anthropic model name
 * @returns LanguageModel instance
 * @deprecated Use createModel({ provider: 'anthropic', model }) instead
 */
export function createAnthropicClient(model: string): LanguageModel {
    return createModel({ provider: 'anthropic', model });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a ModelConfig as a display string.
 * @param config - Model configuration
 * @returns Formatted string like "openai/gpt-4o"
 */
export function formatModelConfig(config: ModelConfig): string {
    return `${config.provider}/${config.model}`;
}

/**
 * Validate that a model exists in the provider's model list.
 * Note: This is advisory only - providers may support unlisted models.
 * @param config - Model configuration to validate
 * @returns True if model is in the known list
 */
export function isKnownModel(config: ModelConfig): boolean {
    const providerInfo = PROVIDERS[config.provider];
    if (!providerInfo) return false;
    return providerInfo.models.includes(config.model);
}

/**
 * Get all available models for a provider.
 * @param provider - Provider name
 * @returns Array of model names, or empty array if provider unknown
 */
export function getProviderModels(provider: ProviderName): string[] {
    return PROVIDERS[provider]?.models ?? [];
}

// ============================================================================
// API Key Validation
// ============================================================================

/**
 * Test an API key by first validating format, then making a minimal API call.
 *
 * Validation steps:
 * 1. Format validation (prefix, length, characters)
 * 2. Live API call to verify key works
 *
 * @param provider - Provider to test
 * @param apiKey - API key to validate
 * @returns Validation result with success status, error message, and optional hint
 */
export async function testApiKey(
    provider: ProviderName,
    apiKey: string
): Promise<{ valid: boolean; error?: string; hint?: string }> {
    const providerInfo = PROVIDERS[provider];
    if (!providerInfo) {
        return { valid: false, error: `Unknown provider: ${provider}` };
    }

    // Step 1: Trim and basic validation
    const trimmedKey = apiKey?.trim() ?? '';

    if (!trimmedKey) {
        return { valid: false, error: 'API key cannot be empty' };
    }

    // Step 2: Format validation (catches most issues before API call)
    const formatResult = validateKeyFormat(provider, trimmedKey);
    if (!formatResult.valid) {
        return {
            valid: false,
            error: formatResult.error,
            hint: formatResult.hint
        };
    }

    // Step 3: Live API test
    const envVar = providerInfo.envVar;
    const originalKey = process.env[envVar];

    try {
        process.env[envVar] = trimmedKey;

        // Create a minimal model and test with a simple prompt
        const model = createModel({
            provider,
            model: providerInfo.defaultModel
        });

        // Import generateText dynamically to avoid circular dependency issues
        const { generateText } = await import('ai');

        // Make a minimal API call
        await generateText({
            model,
            prompt: 'Say "ok"'
        });

        return { valid: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const lowerMessage = message.toLowerCase();

        // Parse common error patterns with specific hints
        if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized') ||
            lowerMessage.includes('invalid_api_key') || lowerMessage.includes('incorrect api key')) {
            return {
                valid: false,
                error: 'Invalid API key - authentication failed',
                hint: `Check that your key is correct and active at: ${providerInfo.docUrl}`
            };
        }

        if (lowerMessage.includes('403') || lowerMessage.includes('forbidden') ||
            lowerMessage.includes('permission')) {
            return {
                valid: false,
                error: 'API key lacks required permissions',
                hint: 'Check that your key has access to the API and the model you are trying to use'
            };
        }

        if (lowerMessage.includes('429') || lowerMessage.includes('rate') ||
            lowerMessage.includes('too many requests')) {
            // Rate limit means the key is valid but overused
            return {
                valid: true,
                hint: 'Key is valid but rate limited. Wait a moment before making requests.'
            };
        }

        if (lowerMessage.includes('quota') || lowerMessage.includes('insufficient') ||
            lowerMessage.includes('billing') || lowerMessage.includes('credit')) {
            return {
                valid: false,
                error: 'API key has insufficient quota or billing issue',
                hint: 'Add credits or check billing at: ' + providerInfo.docUrl
            };
        }

        if (lowerMessage.includes('model') && (lowerMessage.includes('not found') ||
            lowerMessage.includes('does not exist') || lowerMessage.includes('invalid'))) {
            return {
                valid: false,
                error: `Model '${providerInfo.defaultModel}' not available`,
                hint: 'Your API key may not have access to this model tier'
            };
        }

        if (lowerMessage.includes('network') || lowerMessage.includes('fetch') ||
            lowerMessage.includes('econnrefused') || lowerMessage.includes('timeout')) {
            return {
                valid: false,
                error: 'Network error - could not reach API',
                hint: 'Check your internet connection and try again'
            };
        }

        // Return the original error with a generic hint
        return {
            valid: false,
            error: message.slice(0, 200), // Truncate long errors
            hint: 'If the error persists, try generating a new API key'
        };
    } finally {
        // Restore original key (or remove if it wasn't set)
        if (originalKey !== undefined) {
            process.env[envVar] = originalKey;
        } else {
            delete process.env[envVar];
        }
    }
}

/**
 * Set an API key in the environment for a provider.
 *
 * @param provider - Provider name
 * @param apiKey - API key to set
 */
export function setProviderApiKey(provider: ProviderName, apiKey: string): void {
    const providerInfo = PROVIDERS[provider];
    if (providerInfo) {
        process.env[providerInfo.envVar] = apiKey;
    }
}

/**
 * Check if a provider has an API key configured.
 *
 * @param provider - Provider name
 * @returns True if API key is set
 */
export function hasApiKey(provider: ProviderName): boolean {
    const providerInfo = PROVIDERS[provider];
    if (!providerInfo) return false;
    return Boolean(process.env[providerInfo.envVar]);
}
