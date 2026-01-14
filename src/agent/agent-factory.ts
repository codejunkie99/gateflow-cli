/**
 * Agent Factory
 * Creates GateFlow agent instances with AI SDK 6 features
 *
 * This factory creates agents that:
 * 1. Use the needsApproval configuration for tool approval
 * 2. Build tools with conditional execute functions
 * 3. Support both current streamText and future ToolLoopAgent patterns
 */

import { stepCountIs, type Tool } from 'ai';
import { createAnthropicClient } from './anthropic-client.js';
import { getToolSpecs, createToolExecutors, TOOL_APPROVAL_CONFIG, type ToolContext, type ToolSpec } from './tools.js';
import { getSystemPrompt, type PromptMode } from './prompts.js';
import type { CreateAgentOptions } from '../types/agent-types.js';

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
    model: ReturnType<typeof anthropic>;
    /** System prompt */
    instructions: string;
    /** Tools with approval-aware execute functions */
    tools: Record<string, Tool>;
    /** Stop condition */
    stopWhen: ReturnType<typeof stepCountIs>;
    /** Model name for reference */
    modelName: string;
    /** Current mode */
    mode: PromptMode;
    /** Whether auto-approve is enabled */
    autoApprove: boolean;
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
        maxSteps = 25,
        autoApprove = false,
    } = options;

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
            // the caller (core.ts) will handle approval before calling it
            // This is the current pattern; AI SDK 6's ToolLoopAgent would
            // handle this differently by omitting execute
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

    return {
        model: createAnthropicClient(model) as ReturnType<typeof createAnthropicClient>,
        instructions: getSystemPrompt(mode),
        tools,
        stopWhen: stepCountIs(maxSteps),
        modelName: model,
        mode,
        autoApprove,
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
