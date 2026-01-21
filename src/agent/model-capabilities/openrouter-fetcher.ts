/**
 * OpenRouter Model Capability Fetcher
 *
 * Fetches model capability metadata from OpenRouter.
 */

import { type ModelCapabilities, type OpenRouterModelsResponse } from './types.js';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';

function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'HTTP-Referer': 'https://github.com/gateflow-cli',
        'X-Title': 'GateFlow CLI',
    };
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
}

export async function fetchModelCapabilities(): Promise<Record<string, ModelCapabilities>> {
    const response = await fetch(OPENROUTER_API, { headers: buildHeaders() });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterModelsResponse;
    if (!data || !Array.isArray(data.data)) {
        throw new Error('OpenRouter API response missing data array');
    }

    const capabilities: Record<string, ModelCapabilities> = {};

    for (const model of data.data) {
        const params = Array.isArray(model.supported_parameters)
            ? model.supported_parameters
            : [];
        const hasTools = params.includes('tools') || params.includes('functions');
        capabilities[model.id] = {
            tools: hasTools,
            structuredOutputs: params.includes('structured_outputs'),
            reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
        };
    }

    return capabilities;
}
