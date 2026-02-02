/**
 * Model fallback helpers
 * Selects a safe fallback model when the primary model is invalid/unavailable.
 */

import {
    detectAvailableProviders,
    formatModelConfig,
    PROVIDERS,
    type ModelConfigWithVariant,
} from './model-provider.js';

export interface ModelFallbackChoice {
    config: ModelConfigWithVariant;
    reason: string;
}

export function formatModelSpec(config: ModelConfigWithVariant): string {
    return config.variant
        ? `${formatModelConfig(config)}:${config.variant}`
        : formatModelConfig(config);
}

function getStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const err = error as Record<string, unknown>;
    const status = err.status ?? err.statusCode;
    if (typeof status === 'number') return status;
    const response = err.response as Record<string, unknown> | undefined;
    const responseStatus = response?.status;
    if (typeof responseStatus === 'number') return responseStatus;
    return undefined;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function isModelNotFoundError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();
    const status = getStatusCode(error);

    if (status === 404) return true;
    if (status === 400 && message.includes('model')) return true;

    const modelIndicators = ['model', 'model id', 'model name'];
    const failureIndicators = [
        'not found',
        'unknown',
        'invalid',
        'does not exist',
        'no such model',
        'unsupported',
        'not available',
    ];

    const hasModelIndicator = modelIndicators.some((token) => message.includes(token));
    const hasFailureIndicator = failureIndicators.some((token) => message.includes(token));

    return hasModelIndicator && hasFailureIndicator;
}

/**
 * Decide whether to attempt a fallback based on the error and primary model.
 */
export function shouldFallbackOnError(
    error: unknown,
    primary: ModelConfigWithVariant
): boolean {
    if (isModelNotFoundError(error)) return true;

    // OpenRouter frequently returns provider/model errors without a 404
    const message = getErrorMessage(error).toLowerCase();
    if (primary.provider === 'openrouter' && message.includes('model')) {
        return message.includes('not found') || message.includes('invalid') || message.includes('unknown');
    }

    return false;
}

/**
 * Select a fallback model config if an alternative is available.
 */
export function selectFallbackModelConfig(
    primary: ModelConfigWithVariant
): ModelFallbackChoice | null {
    const availableProviders = detectAvailableProviders();
    if (availableProviders.length === 0) {
        return null;
    }

    const alternativeProvider = availableProviders.find(
        (provider) => provider !== primary.provider
    );

    if (alternativeProvider) {
        return {
            config: {
                provider: alternativeProvider,
                model: PROVIDERS[alternativeProvider].defaultModel,
            },
            reason: `fallback provider ${alternativeProvider} is available`,
        };
    }

    const sameProviderDefault = PROVIDERS[primary.provider]?.defaultModel;
    if (sameProviderDefault && sameProviderDefault !== primary.model) {
        return {
            config: {
                provider: primary.provider,
                model: sameProviderDefault,
            },
            reason: 'fallback to provider default model',
        };
    }

    return null;
}

export function formatFallbackMessage(
    primary: ModelConfigWithVariant,
    fallback: ModelConfigWithVariant,
    error: unknown
): string {
    const errorMessage = getErrorMessage(error);
    return `Model ${formatModelSpec(primary)} failed (${errorMessage}). Falling back to ${formatModelSpec(fallback)}.`;
}
