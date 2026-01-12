/**
 * AI SDK 6 Agent Types
 * Type definitions for ToolLoopAgent integration and tool approval
 */

import { z } from 'zod';
import type { PromptMode } from '../agent/prompts.js';

// ============================================================================
// Tool Approval Types
// ============================================================================

/**
 * Tool approval categories for declarative configuration
 */
export type ToolApprovalCategory = 'always_allow' | 'needs_approval' | 'always_deny';

/**
 * Map of tool names to their approval requirements
 */
export interface ToolApprovalConfig {
    [toolName: string]: ToolApprovalCategory;
}

/**
 * Result of checking tool approval
 */
export interface ToolApprovalDecision {
    allowed: boolean;
    needsApproval: boolean;
    reason?: string;
}

// ============================================================================
// Agent Call Options Schema (AI SDK 6 pattern)
// ============================================================================

/**
 * Type-safe call options for agent invocation
 * Used with ToolLoopAgent's callOptionsSchema
 */
export const AgentCallOptionsSchema = z.object({
    /** Project root directory */
    projectRoot: z.string(),
    /** Session ID for memory/context management */
    sessionId: z.string(),
    /** Execution mode (affects system prompt and tool selection) */
    mode: z.enum(['general', 'lint_fix', 'testbench', 'debug', 'edit', 'generate', 'refactoring']),
    /** Auto-approve all tool calls */
    autoApprove: z.boolean().default(false),
    /** User ID for personalization */
    userId: z.string().optional(),
});

export type AgentCallOptions = z.infer<typeof AgentCallOptionsSchema>;

// ============================================================================
// Tool Spec Extension for needsApproval
// ============================================================================

/**
 * Extended tool specification with approval metadata
 */
export interface ToolSpecWithApproval {
    description: string;
    parameters: z.ZodType<unknown>;
    /** Whether this tool requires human approval before execution */
    needsApproval: boolean;
}

// ============================================================================
// Stream Part Types (AI SDK 6)
// ============================================================================

/**
 * Tool approval request part from AI SDK 6
 * Emitted when a tool with needsApproval is called
 */
export interface ToolApprovalRequestPart {
    type: 'tool-approval-request';
    toolCallId: string;
    toolName: string;
    input: unknown;
}

/**
 * Union of stream part types we handle
 */
export type StreamPartType =
    | 'text-delta'
    | 'tool-call'
    | 'tool-result'
    | 'tool-approval-request'
    | 'error'
    | 'tool-error'
    | 'abort';

// ============================================================================
// Agent Factory Options
// ============================================================================

/**
 * Options for creating a GateFlow agent instance
 */
export interface CreateAgentOptions {
    /** Execution mode (affects system prompt) */
    mode: PromptMode;
    /** Model name (default: claude-sonnet-4-20250514) */
    model?: string;
    /** Maximum tool call steps (default: 25) */
    maxSteps?: number;
    /** Whether to auto-approve all tool calls */
    autoApprove?: boolean;
}

// ============================================================================
// UI Message Types (for type-safe streaming)
// ============================================================================

/**
 * Base interface for UI messages
 * Can be extended with InferAgentUIMessage<typeof agent> when available
 */
export interface GateFlowUIMessageBase {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: {
        createdAt?: number;
        tokens?: {
            input?: number;
            output?: number;
        };
        finishReason?: string;
        toolCalls?: Array<{
            id: string;
            name: string;
            args: unknown;
        }>;
    };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { PromptMode } from '../agent/prompts.js';
