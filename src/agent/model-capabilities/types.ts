/**
 * Model Capabilities Types
 *
 * Type definitions for the model capability detection system.
 * Used to route structured output calls based on model support.
 */

/**
 * Capabilities for a single model.
 */
export interface ModelCapabilities {
    /** Model supports tool/function calling */
    tools: boolean;
    /** Model supports native structured output (not tool-based) */
    structuredOutputs: boolean;
    /** Model supports thinking/reasoning mode */
    reasoning: boolean;
}

/**
 * Filesystem cache format.
 * Designed to be grep-able for debugging.
 */
export interface CapabilityCache {
    /** ISO timestamp of last update */
    lastUpdated: string;
    /** Data source */
    source: 'openrouter' | 'fallback';
    /** Version for cache invalidation */
    version: number;
    /** Model capabilities map */
    models: Record<string, ModelCapabilities>;
}

/**
 * OpenRouter API model response.
 */
export interface OpenRouterModel {
    id: string;
    name: string;
    supported_parameters?: string[];
    context_length?: number;
    pricing?: {
        prompt: string;
        completion: string;
    };
}

/**
 * OpenRouter API response.
 */
export interface OpenRouterModelsResponse {
    data: OpenRouterModel[];
}

/**
 * Default capabilities for unknown models.
 * Conservative defaults - assume tools only, no native structured output.
 */
export const DEFAULT_CAPABILITIES: ModelCapabilities = {
    tools: true,
    structuredOutputs: false,
    reasoning: false
};

/**
 * Cache version - increment to force refresh.
 */
export const CACHE_VERSION = 1;

/**
 * Cache TTL in milliseconds (24 hours).
 */
export const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
