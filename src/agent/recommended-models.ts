/**
 * Recommended Models List
 *
 * Curated list of recommended models with badges for display in the TUI.
 * Helps users choose the right model for their use case.
 *
 * @module agent/recommended-models
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Badge types for model recommendations.
 */
type ModelBadge =
    | 'Recommended'  // Best overall choice for GateFlow
    | 'Fast'         // Optimized for speed
    | 'Reasoning'    // Best for complex reasoning tasks
    | 'Local'        // Runs locally, no API costs
    | 'Budget'       // Cost-effective option
    | 'Coding'       // Optimized for code tasks
    | 'Vision';      // Supports image/vision input

/**
 * Recommended model entry.
 */
interface RecommendedModel {
    /** Full model ID (e.g., "anthropic/claude-sonnet-4-20250514") */
    id: string;
    /** Why this model is recommended */
    reason: string;
    /** Badge to display in UI */
    badge: ModelBadge;
    /** Primary use case */
    useCase: string;
}

// ============================================================================
// Recommended Models
// ============================================================================

/**
 * Curated list of recommended models for GateFlow.
 * These models are tested and work well for SystemVerilog development.
 */
export const RECOMMENDED_MODELS: RecommendedModel[] = [
    {
        id: 'anthropic/claude-sonnet-4-20250514',
        reason: 'Best for SystemVerilog analysis and code generation',
        badge: 'Recommended',
        useCase: 'Primary development'
    },
    {
        id: 'anthropic/claude-opus-4-5-20251101',
        reason: 'Most capable model with extended thinking',
        badge: 'Reasoning',
        useCase: 'Complex debugging and architecture'
    },
    {
        id: 'openai/gpt-5',
        reason: 'Strong general-purpose coding with excellent tool use',
        badge: 'Coding',
        useCase: 'General development'
    },
    {
        id: 'openai/o3',
        reason: 'Superior reasoning for complex debugging',
        badge: 'Reasoning',
        useCase: 'Hard problems'
    },
    {
        id: 'google/gemini-2.5-flash',
        reason: 'Fast and capable with large context',
        badge: 'Fast',
        useCase: 'Quick iterations'
    },
    {
        id: 'mistral/codestral-latest',
        reason: 'Specialized for code generation and editing',
        badge: 'Coding',
        useCase: 'Code-heavy tasks'
    },
    {
        id: 'ollama/llama3.1',
        reason: 'Local inference for offline development',
        badge: 'Local',
        useCase: 'Offline work'
    },
    {
        id: 'deepseek/deepseek-chat',
        reason: 'Cost-effective for high-volume usage',
        badge: 'Budget',
        useCase: 'Budget-conscious'
    },
    {
        // OpenRouter model IDs use format: openrouter/<provider>/<model>
        // The 'openrouter/' prefix routes through OpenRouter's API gateway
        id: 'openrouter/anthropic/claude-sonnet-4',
        reason: 'Access 300+ models with single API key',
        badge: 'Recommended',
        useCase: 'Multi-provider access'
    }
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get badge display text with optional ANSI color.
 */
export function getBadgeDisplay(badge: ModelBadge, useColor: boolean = true): string {
    const badges: Record<ModelBadge, { text: string; color: string }> = {
        'Recommended': { text: 'Recommended', color: '\x1b[32m' },  // Green
        'Fast': { text: 'Fast', color: '\x1b[36m' },               // Cyan
        'Reasoning': { text: 'Reasoning', color: '\x1b[35m' },     // Magenta
        'Local': { text: 'Local', color: '\x1b[33m' },             // Yellow
        'Budget': { text: 'Budget', color: '\x1b[34m' },           // Blue
        'Coding': { text: 'Coding', color: '\x1b[32m' },           // Green
        'Vision': { text: 'Vision', color: '\x1b[35m' },           // Magenta
    };

    const b = badges[badge];
    if (useColor) {
        return `${b.color}[${b.text}]\x1b[0m`;
    }
    return `[${b.text}]`;
}

/**
 * Get a recommended model by ID.
 */
export function getRecommendedModel(id: string): RecommendedModel | undefined {
    return RECOMMENDED_MODELS.find(m => m.id === id);
}

/**
 * Check if a model ID is in the recommended list.
 */
export function isRecommendedModel(id: string): boolean {
    return RECOMMENDED_MODELS.some(m => m.id === id);
}

/**
 * Get all recommended models for a specific badge.
 */
function getModelsByBadge(badge: ModelBadge): RecommendedModel[] {
    return RECOMMENDED_MODELS.filter(m => m.badge === badge);
}

/**
 * Get the recommended models that are available (have API keys configured).
 *
 * @param availableProviders - Array of provider names with configured API keys
 */
function getAvailableRecommendedModels(
    availableProviders: string[]
): RecommendedModel[] {
    return RECOMMENDED_MODELS.filter(model => {
        const provider = model.id.split('/')[0];
        return availableProviders.includes(provider);
    });
}

/**
 * Format a model for display in the interactive menu.
 *
 * @param model - The recommended model
 * @param isCurrent - Whether this is the currently selected model
 * @param useColor - Whether to use ANSI colors
 */
function formatModelForMenu(
    model: RecommendedModel,
    isCurrent: boolean = false,
    useColor: boolean = true
): string {
    const badge = getBadgeDisplay(model.badge, useColor);
    const current = isCurrent ? ' (current)' : '';
    const prefix = isCurrent ? '>* ' : '   ';

    // Extract just the model name from full ID
    const parts = model.id.split('/');
    const provider = parts[0];
    const modelName = parts.slice(1).join('/');

    return `${prefix}${provider}/${modelName}  ${badge}${current}`;
}
