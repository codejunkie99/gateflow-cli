/**
 * Agent Factory
 * Creates GateFlow agent instances with AI SDK 6 features
 *
 * This factory creates agents that:
 * 1. Use the needsApproval configuration for tool approval
 * 2. Build tools with conditional execute functions
 * 3. Support both current streamText and future ToolLoopAgent patterns
 */

import { stepCountIs, type Tool, type LanguageModel } from 'ai';
import {
    createModel,
    parseModelString,
    getVariantProviderOptions,
    type ModelConfig,
    type ModelConfigWithVariant,
    type VariantName,
} from './model-provider.js';
import { getToolSpecs, createToolExecutors, TOOL_APPROVAL_CONFIG, type ToolContext, type ToolSpec } from './tools.js';
import { getSystemPrompt, type PromptMode } from './prompts.js';
import type { CreateAgentOptions } from '../types/agent-types.js';
import { createModeStopCondition, type StopCondition } from './stop-conditions.js';
import { modelRegistry } from './model-registry.js';
import { getAllModelCapabilities, type ModelCapabilities as OpenRouterCapabilities } from './model-provider-openrouter.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended Tool type with optional execute for needsApproval pattern
 */
export interface ApprovalAwareTool {
    description: string;
    inputSchema: ToolSpec['parameters'];
    /**
     * Execute function is omitted for tools that need approval.
     * AI SDK 6 will return tool-approval-request parts for these tools.
     */
    execute?: (args: unknown) => Promise<unknown>;
}

/**
 * Agent configuration bundle for use with streamText or ToolLoopAgent
 */
export interface AgentBundle {
    /** Model instance */
    model: LanguageModel;
    /** Model configuration (provider + model name + optional variant) */
    modelConfig: ModelConfigWithVariant;
    /**
     * Optional model for complex tasks (high step count, errors, long context).
     * Used by dynamicModelSelector when task complexity increases.
     * Falls back to primary model if not specified.
     */
    complexModel?: LanguageModel;
    /** System prompt */
    instructions: string;
    /** Tools with approval-aware execute functions */
    tools: Record<string, Tool>;
    /** Stop condition - can be composed with stopWhenAny/stopWhenAll */
    stopWhen: StopCondition;
    /** Model name for reference (format: provider/model[:variant]) */
    modelName: string;
    /** Current mode */
    mode: PromptMode;
    /** Whether auto-approve is enabled */
    autoApprove: boolean;
    /**
     * Provider options for variant support.
     * Apply these in streamText/generateText calls to enable extended thinking,
     * reasoning effort, or other provider-specific features.
     *
     * @example
     * streamText({
     *   model: bundle.model,
     *   ...bundle.variantOptions,  // Apply variant options
     *   // ... other options
     * });
     */
    variantOptions: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find a reasoning-capable alternative model from OpenRouter's cache.
 * Matches by provider prefix (e.g., 'anthropic/') and finds a more expensive
 * reasoning model from the same provider.
 *
 * @param currentModelId - Current model ID (e.g., 'anthropic/claude-3-haiku')
 * @returns Alternative model ID with reasoning capability, or undefined
 */
function findOpenRouterReasoningAlternative(currentModelId: string): string | undefined {
    const allCaps = getAllModelCapabilities();
    if (allCaps.size === 0) return undefined;

    // Extract provider prefix (e.g., 'anthropic/' from 'anthropic/claude-3-haiku')
    const providerPrefix = currentModelId.includes('/')
        ? currentModelId.split('/')[0] + '/'
        : undefined;

    if (!providerPrefix) return undefined;

    // Get current model's pricing for comparison
    const currentCaps = allCaps.get(currentModelId);
    const currentInputPrice = currentCaps?.pricing?.input ?? 0;

    // Find reasoning-capable models from the same provider that are more expensive
    const candidates: Array<{ id: string; caps: OpenRouterCapabilities }> = [];

    for (const [id, caps] of allCaps) {
        if (
            id.startsWith(providerPrefix) &&
            id !== currentModelId &&
            caps.reasoning &&
            caps.tools &&
            caps.pricing &&
            caps.pricing.input > currentInputPrice
        ) {
            candidates.push({ id, caps });
        }
    }

    if (candidates.length === 0) return undefined;

    // Sort by price (ascending) and pick the cheapest reasoning model that's still more capable
    candidates.sort((a, b) => (a.caps.pricing?.input ?? 0) - (b.caps.pricing?.input ?? 0));

    return candidates[0].id;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an agent bundle with tools configured for needsApproval.
 *
 * This factory:
 * 1. Loads tool specs with needsApproval metadata
 * 2. Creates tool executors from the context
 * 3. Builds AI SDK tools with conditional execute functions
 * 4. Returns a bundle ready for streamText or future ToolLoopAgent
 *
 * @param options - Agent creation options
 * @param toolContext - Context containing bus, policy, fileTools, etc.
 * @returns Agent bundle ready for use
 */
export function createAgentBundle(
    options: CreateAgentOptions,
    toolContext: ToolContext
): AgentBundle {
    const {
        mode,
        model = 'claude-sonnet-4-20250514',
        modelConfig: providedModelConfig,
        complexModel,
        complexModelConfig: providedComplexModelConfig,
        stepLimit = 25,
        autoApprove = false,
    } = options;

    // Resolve model config: use provided config or parse from model string
    // parseModelString now returns ModelConfigWithVariant (includes variant)
    const modelConfig: ModelConfigWithVariant = providedModelConfig ?? parseModelString(model);

    // Resolve complex model config: explicit > string > auto-select from registry
    let complexModelConfig = providedComplexModelConfig
        ?? (complexModel ? parseModelString(complexModel) : undefined);

    // Auto-select a more capable model if not explicitly configured
    if (!complexModelConfig) {
        // First, try static registry
        const alternatives = modelRegistry.findAlternatives(modelConfig.model)
            .filter(m => m.provider === modelConfig.provider);
        // Find a model with reasoning capability that's more expensive (likely more capable)
        const reasoningModel = alternatives.find(m =>
            m.capabilities.reasoning && m.pricing &&
            (m.pricing.inputPer1M > (modelRegistry.getModel(modelConfig.model)?.pricing?.inputPer1M ?? 0))
        );
        if (reasoningModel) {
            complexModelConfig = {
                provider: reasoningModel.provider,
                model: reasoningModel.id,
            };
        }

        // If static registry didn't find an alternative and using OpenRouter, query its cache
        if (!complexModelConfig && modelConfig.provider === 'openrouter') {
            const openRouterAlternative = findOpenRouterReasoningAlternative(modelConfig.model);
            if (openRouterAlternative) {
                complexModelConfig = {
                    provider: 'openrouter',
                    model: openRouterAlternative,
                };
            }
        }
    }

    // Get variant options for providerOptions (used in streamText/generateText)
    const variantOptions = getVariantProviderOptions(modelConfig.provider, modelConfig.variant);

    const specs = getToolSpecs();
    const executors = createToolExecutors(toolContext);

    // Build tools with conditional execute based on approval config
    const tools: Record<string, Tool> = {};

    for (const [name, spec] of Object.entries(specs)) {
        // Determine if this tool needs approval
        // Tool needs approval if:
        // 1. The spec says it needs approval AND
        // 2. autoApprove is not enabled
        const needsApproval = spec.needsApproval && !autoApprove;

        if (needsApproval) {
            // For tools needing approval, we still provide execute but
            // approvals are enforced inside tool executors.
            // AI SDK 6's ToolLoopAgent would handle this differently by omitting execute.
            tools[name] = {
                description: spec.description,
                inputSchema: spec.parameters,
                execute: async (args: unknown) => {
                    const executor = (executors as Record<string, (args: unknown) => Promise<unknown>>)[name];
                    if (!executor) {
                        throw new Error(`Unknown tool: ${name}`);
                    }
                    return executor(args);
                }
            };
        } else {
            // Tools that don't need approval execute directly
            tools[name] = {
                description: spec.description,
                inputSchema: spec.parameters,
                execute: async (args: unknown) => {
                    const executor = (executors as Record<string, (args: unknown) => Promise<unknown>>)[name];
                    if (!executor) {
                        throw new Error(`Unknown tool: ${name}`);
                    }
                    return executor(args);
                }
            };
        }
    }

    // Build model name string (include variant if present)
    const modelName = modelConfig.variant
        ? `${modelConfig.provider}/${modelConfig.model}:${modelConfig.variant}`
        : `${modelConfig.provider}/${modelConfig.model}`;

    return {
        model: createModel(modelConfig),
        modelConfig,
        // Create complex model if config was provided
        complexModel: complexModelConfig ? createModel(complexModelConfig) : undefined,
        instructions: getSystemPrompt(mode),
        tools,
        // Use mode-aware stop condition (e.g., lint_fix stops when lint passes)
        stopWhen: createModeStopCondition({ mode, stepLimit }),
        modelName,
        mode,
        autoApprove,
        variantOptions,
    };
}

/**
 * Get the approval requirement for a specific tool.
 *
 * @param toolName - Name of the tool
 * @param autoApprove - Whether auto-approve is globally enabled
 * @returns Whether the tool needs approval
 */
export function toolNeedsApproval(toolName: string, autoApprove: boolean = false): boolean {
    if (autoApprove) return false;
    return TOOL_APPROVAL_CONFIG[toolName] ?? false;
}

/**
 * Check if a file path should be auto-approved for write operations.
 * SystemVerilog files in safe directories are auto-approved.
 *
 * @param path - File path being written
 * @returns Whether the path should be auto-approved
 */
export function shouldAutoApprovePath(path: string): boolean {
    // Auto-approve SystemVerilog files
    const ext = path.split('.').pop()?.toLowerCase();
    if (['sv', 'svh', 'v', 'vh'].includes(ext || '')) {
        return true;
    }
    return false;
}

/**
 * Get list of all tools that require approval.
 *
 * @returns Array of tool names that need approval
 */
export function getToolsRequiringApproval(): string[] {
    return Object.entries(TOOL_APPROVAL_CONFIG)
        .filter(([_, needsApproval]) => needsApproval)
        .map(([name]) => name);
}

/**
 * Get list of all tools that are auto-approved.
 *
 * @returns Array of tool names that don't need approval
 */
export function getAutoApprovedTools(): string[] {
    return Object.entries(TOOL_APPROVAL_CONFIG)
        .filter(([_, needsApproval]) => !needsApproval)
        .map(([name]) => name);
}

// ============================================================================
// Future: ToolLoopAgent Support
// ============================================================================

/**
 * NOTE: When AI SDK 6's ToolLoopAgent becomes available in the package,
 * add the following function:
 *
 * export function createToolLoopAgent(
 *     options: CreateAgentOptions,
 *     toolContext: ToolContext
 * ): ToolLoopAgent {
 *     const bundle = createAgentBundle(options, toolContext);
 *
 *     // For ToolLoopAgent, tools needing approval should NOT have execute
 *     const toolsForAgent: Record<string, Tool> = {};
 *     const specs = getToolSpecs();
 *
 *     for (const [name, tool] of Object.entries(bundle.tools)) {
 *         const needsApproval = specs[name]?.needsApproval && !bundle.autoApprove;
 *         if (needsApproval) {
 *             // Omit execute for approval-required tools
 *             toolsForAgent[name] = {
 *                 description: tool.description,
 *                 inputSchema: tool.inputSchema,
 *                 // No execute - triggers tool-approval-request
 *             };
 *         } else {
 *             toolsForAgent[name] = tool;
 *         }
 *     }
 *
 *     return new ToolLoopAgent({
 *         model: bundle.model,
 *         instructions: bundle.instructions,
 *         tools: toolsForAgent,
 *         stopWhen: bundle.stopWhen,
 *     });
 * }
 */
