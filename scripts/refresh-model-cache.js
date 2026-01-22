#!/usr/bin/env node

/**
 * Refresh Model Cache Script
 *
 * Fetches latest model data from OpenRouter and updates the bundled cache.
 * Run this before releases to ensure users get fresh pricing/capability data.
 *
 * Usage:
 *   npm run refresh-cache
 *   node scripts/refresh-model-cache.js
 *
 * No API key required - OpenRouter model list is public.
 */

import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '../src/agent/model-capabilities/default-cache.json');
const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';

async function main() {
    console.log('Fetching models from OpenRouter...');

    const response = await fetch(OPENROUTER_API, {
        headers: {
            'HTTP-Referer': 'https://github.com/gateflow-cli',
            'X-Title': 'GateFlow CLI'
        }
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const models = data.data || data;

    if (!Array.isArray(models)) {
        throw new Error('Unexpected API response: models is not an array');
    }

    console.log(`Received ${models.length} models`);

    // Transform to our cache format
    const cache = {
        lastUpdated: new Date().toISOString(),
        source: 'openrouter',
        version: 1,
        models: {}
    };

    let compatible = 0;

    for (const model of models) {
        if (!model.id) continue;
        const params = model.supported_parameters || [];
        const tools = params.includes('tools') || params.includes('functions');
        const structuredOutputs = params.includes('structured_outputs') || params.includes('response_format');
        const reasoning = params.includes('reasoning') || params.includes('include_reasoning');

        cache.models[model.id] = {
            tools,
            structuredOutputs,
            reasoning
        };

        // Add pricing if available
        if (model.pricing) {
            const inputPrice = parseFloat(model.pricing.prompt) * 1_000_000;
            const outputPrice = parseFloat(model.pricing.completion) * 1_000_000;

            if (inputPrice > 0 || outputPrice > 0) {
                cache.models[model.id].pricing = {
                    input: inputPrice,
                    output: outputPrice
                };
            }
        }

        if (tools && structuredOutputs) compatible++;
    }

    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));

    console.log(`\nCache updated: ${CACHE_PATH}`);
    console.log(`  Compatible models: ${compatible}`);
    console.log(`  Last updated: ${cache.lastUpdated}`);
}

main().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});
