/**
 * Model Variants System
 *
 * Runtime configuration modifiers for AI models.
 * Allows specifications like "anthropic/claude-sonnet-4:high" for extended thinking.
 *
 * @module agent/model-variants
 */

import type { ProviderName, ModelConfig } from './model-provider.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Available variant names for model configuration.
 * These map to provider-specific options.
 */
export type VariantName =
    | 'minimal'   // Lowest effort/tokens
    | 'low'       // Low effort
    | 'medium'    // Balanced
    | 'high'      // High effort/extended thinking
    | 'max'       // Maximum effort
    | 'fast'      // Fastest (disable thinking/reasoning)
    | 'thorough'; // Most thorough (maximum thinking)

/**
 * Provider-specific options that variants can configure.
 */
export interface ModelVariantOptions {
    // Anthropic extended thinking
    thinking?: {
        type: 'enabled' | 'disabled';
        budgetTokens?: number;
    };
    // OpenAI reasoning effort (o1, o3, etc.)
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    // Google thinking effort
    thinkingConfig?: {
        thinkingBudget?: number;
        includeThoughts?: boolean;
    };
    // General parameters
    temperature?: number;
}

/**
 * Extended model config that includes variant information.
 */
export interface ModelConfigWithVariant extends ModelConfig {
    variant?: VariantName;
    variantOptions?: ModelVariantOptions;
}

// ============================================================================
// Variant Definitions
// ============================================================================

/**
 * Built-in variant definitions per provider.
 * Maps variant names to provider-specific options.
 */
const PROVIDER_VARIANTS: Partial<Record<ProviderName, Partial<Record<VariantName, ModelVariantOptions>>>> = {
    anthropic: {
        minimal: { thinking: { type: 'enabled', budgetTokens: 4096 } },
        low: { thinking: { type: 'enabled', budgetTokens: 8192 } },
        medium: { thinking: { type: 'enabled', budgetTokens: 16384 } },
        high: { thinking: { type: 'enabled', budgetTokens: 24576 } },
        max: { thinking: { type: 'enabled', budgetTokens: 32768 } },
        fast: { thinking: { type: 'disabled' } },
        thorough: { thinking: { type: 'enabled', budgetTokens: 32768 } },
    },
    openai: {
        minimal: { reasoningEffort: 'minimal' },
        low: { reasoningEffort: 'low' },
        medium: { reasoningEffort: 'medium' },
        high: { reasoningEffort: 'high' },
        max: { reasoningEffort: 'xhigh' },
        fast: { reasoningEffort: 'none' },
        thorough: { reasoningEffort: 'high' },
    },
    google: {
        minimal: { thinkingConfig: { thinkingBudget: 1024 } },
        low: { thinkingConfig: { thinkingBudget: 4096 } },
        medium: { thinkingConfig: { thinkingBudget: 8192 } },
        high: { thinkingConfig: { thinkingBudget: 16384 } },
        max: { thinkingConfig: { thinkingBudget: 24576 } },
        fast: { thinkingConfig: { thinkingBudget: 0 } },
        thorough: { thinkingConfig: { thinkingBudget: 24576, includeThoughts: true } },
    },
    // Other providers use defaults (no variants)
};

/**
 * List of all valid variant names.
 */
const VALID_VARIANTS: VariantName[] = [
    'minimal',
    'low',
    'medium',
    'high',
    'max',
    'fast',
    'thorough'
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a string is a valid variant name.
 */
function isValidVariant(v: string): v is VariantName {
    return VALID_VARIANTS.includes(v as VariantName);
}

/**
 * Get variant options for a provider and variant combination.
 *
 * @param provider - Provider name
 * @param variant - Variant name
 * @returns Variant options, or empty object if not defined
 */
export function getVariantOptions(
    provider: ProviderName,
    variant: VariantName
): ModelVariantOptions {
    return PROVIDER_VARIANTS[provider]?.[variant] ?? {};
}

/**
 * Check if a provider supports a specific variant.
 *
 * @param provider - Provider name
 * @param variant - Variant name
 * @returns True if the variant is defined for the provider
 */
function supportsVariant(provider: ProviderName, variant: VariantName): boolean {
    return PROVIDER_VARIANTS[provider]?.[variant] !== undefined;
}

/**
 * Get all supported variants for a provider.
 *
 * @param provider - Provider name
 * @returns Array of supported variant names
 */
export function getSupportedVariants(provider: ProviderName): VariantName[] {
    const providerVariants = PROVIDER_VARIANTS[provider];
    if (!providerVariants) return [];
    return Object.keys(providerVariants) as VariantName[];
}

/**
 * Get a human-readable description of a variant.
 *
 * @param variant - Variant name
 * @returns Description string
 */
export function getVariantDescription(variant: VariantName): string {
    const descriptions: Record<VariantName, string> = {
        minimal: 'Minimal thinking/reasoning effort (fastest, lowest cost)',
        low: 'Low thinking/reasoning effort',
        medium: 'Balanced thinking/reasoning effort',
        high: 'High thinking/reasoning effort (extended thinking)',
        max: 'Maximum thinking/reasoning effort',
        fast: 'Disable thinking/reasoning (fastest response)',
        thorough: 'Most thorough analysis (maximum thinking)',
    };
    return descriptions[variant];
}

/**
 * Parse a model string that may include a variant suffix.
 * Variant format: "provider/model:variant" or "model:variant"
 *
 * @param modelPart - The model part of the spec (may include :variant)
 * @returns Object with cleaned model and optional variant
 */
export function extractVariant(modelPart: string): { model: string; variant?: VariantName } {
    if (!modelPart.includes(':')) {
        return { model: modelPart };
    }

    const colonIndex = modelPart.lastIndexOf(':');
    const potentialVariant = modelPart.slice(colonIndex + 1).toLowerCase();

    if (isValidVariant(potentialVariant)) {
        return {
            model: modelPart.slice(0, colonIndex),
            variant: potentialVariant
        };
    }

    // Not a valid variant, treat the whole string as the model
    // (some models have colons in their names, e.g., ollama/llama3.1:70b)
    return { model: modelPart };
}

/**
 * Get providerOptions for use with generateText/streamText based on variant.
 *
 * @param provider - Provider name
 * @param variant - Variant name (optional)
 * @returns Provider options object to spread into generateText/streamText
 *
 * @example
 * const model = createModel(config);
 * const providerOptions = getVariantProviderOptions(config.provider, config.variant);
 * await generateText({
 *   model,
 *   prompt: 'Hello',
 *   ...providerOptions
 * });
 */
export function getVariantProviderOptions(
    provider: ProviderName,
    variant?: VariantName
): Record<string, unknown> {
    if (!variant) return {};

    const variantOptions = getVariantOptions(provider, variant);
    if (Object.keys(variantOptions).length === 0) return {};

    // Build provider-specific options
    switch (provider) {
        case 'anthropic': {
            if (variantOptions.thinking) {
                return {
                    providerOptions: {
                        anthropic: {
                            thinking: variantOptions.thinking
                        }
                    }
                };
            }
            break;
        }
        case 'openai': {
            if (variantOptions.reasoningEffort) {
                return {
                    providerOptions: {
                        openai: {
                            reasoningEffort: variantOptions.reasoningEffort
                        }
                    }
                };
            }
            break;
        }
        case 'google': {
            if (variantOptions.thinkingConfig) {
                return {
                    providerOptions: {
                        google: {
                            thinkingConfig: variantOptions.thinkingConfig
                        }
                    }
                };
            }
            break;
        }
    }

    return {};
}
