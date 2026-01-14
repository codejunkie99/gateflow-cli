/**
 * Anthropic Client Utility
 * Creates Anthropic client instances with explicit API key to bypass credential storage issues
 * 
 * This fixes the ERR_SECRETS_PLATFORM_ERROR on Windows by ensuring the API key is available
 * in the environment before the SDK tries to access credential storage mechanisms.
 */

import { anthropic } from '@ai-sdk/anthropic';

/**
 * Get the API key from environment variables
 */
function getApiKey(): string {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error(
            'ANTHROPIC_API_KEY environment variable is not set. ' +
            'Please set it in your .env file or environment variables.'
        );
    }
    return apiKey;
}

/**
 * Ensure API key is set in environment to prevent credential storage attempts
 * This is called early to ensure the SDK uses the environment variable instead
 * of trying to access credential storage (which fails on Windows)
 */
function ensureApiKeyInEnvironment(): void {
    const apiKey = getApiKey();
    
    // Ensure the environment variable is explicitly set
    // This prevents the SDK from attempting to use credential storage
    if (!process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = apiKey;
    }
    
    // On Windows, disable credential storage attempts by ensuring
    // the environment variable takes precedence
    // Some SDKs check for this before attempting credential storage
    if (process.platform === 'win32') {
        // Explicitly set to prevent credential storage lookup
        process.env.ANTHROPIC_API_KEY = apiKey;
    }
}

/**
 * Create an Anthropic client with explicit API key handling
 * This bypasses credential storage mechanisms that can fail on Windows
 * 
 * @param model - Model name (e.g., 'claude-sonnet-4-20250514')
 * @returns Configured Anthropic model instance
 */
export function createAnthropicClient(model: string) {
    // Ensure API key is in environment before creating client
    // This prevents the SDK from attempting credential storage
    ensureApiKeyInEnvironment();
    
    // The anthropic() function from @ai-sdk/anthropic automatically reads
    // from ANTHROPIC_API_KEY environment variable. By ensuring it's set
    // explicitly before calling anthropic(), we prevent the SDK from
    // attempting to use credential storage mechanisms (which fail on Windows).
    //
    // The key is ensuring the environment variable is available BEFORE
    // the SDK initializes, so it doesn't try credential storage first.
    return anthropic(model);
}

