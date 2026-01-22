/**
 * AI SDK 6 Agent Types
 * Type definitions for ToolLoopAgent integration and tool approval
 */

import { z } from 'zod';
import type { PromptMode } from '../agent/prompts.js';
import type { ModelConfig, ModelConfigWithVariant } from '../agent/model-provider.js';

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
    mode: z.enum(['general', 'lint_fix', 'testbench', 'debug', 'edit', 'generate']),
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
    /**
     * Model name (default: claude-sonnet-4-20250514)
     * Formats: "model", "provider/model", or "provider/model:variant"
     * Examples: "claude-sonnet-4", "openai/gpt-5", "anthropic/claude-sonnet-4:high"
     */
    model?: string;
    /**
     * Model configuration (provider + model name + optional variant)
     * Takes precedence over model string if provided
     */
    modelConfig?: ModelConfigWithVariant;
    /**
     * Optional model for complex tasks (high step count, errors, long context).
     * Used by dynamicModelSelector when task complexity increases.
     * Falls back to primary model if not specified.
     *
     * @example "anthropic/claude-opus-4-5-20251101" for reasoning-heavy debugging
     */
    complexModel?: string;
    /**
     * Complex model configuration (provider + model name + optional variant)
     * Takes precedence over complexModel string if provided
     */
    complexModelConfig?: ModelConfigWithVariant;
    /** Maximum steps for tool loop (default: 25, used with stopWhen: stepCountIs()) */
    stepLimit?: number;
    /** Whether to auto-approve all tool calls */
    autoApprove?: boolean;
}

// ============================================================================
// Runtime Call Options (per-request overrides)
// ============================================================================

/**
 * Approval policy for tool execution
 */
export type ApprovalPolicy = 'always_ask' | 'auto_approve' | 'deny_writes';

/**
 * Stop condition function type (imported from stop-conditions.ts)
 */
export type StopConditionFn = (context: {
    steps?: Array<{
        toolCalls?: Array<{ toolName: string; args: unknown }>;
        toolResults?: Array<{ toolName: string; result: unknown }>;
    }>;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    finishReason?: string;
}) => boolean;

/**
 * Per-request runtime options for agent execution.
 * These override the defaults set during agent creation.
 *
 * @example
 * // Run with custom step limit and token budget
 * agent.run("Fix all lint errors", {
 *     stepLimit: 50,
 *     maxTokens: 8000,
 *     stopConditions: [tokenBudgetExhausted(100000)]
 * });
 */
export interface RuntimeCallOptions {
    /** Abort signal for cancellation */
    signal?: AbortSignal;

    /** Override step limit for this request */
    stepLimit?: number;

    /** Override max output tokens for this request */
    maxTokens?: number;

    /** Override temperature for this request */
    temperature?: number;

    /** Additional stop conditions to combine with defaults */
    stopConditions?: StopConditionFn[];

    /** Override approval policy for this request */
    approvalPolicy?: ApprovalPolicy;

    /** Custom metadata to pass through the request */
    metadata?: Record<string, unknown>;
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
// Issue Category Types (for robust quality checks)
// ============================================================================

/**
 * Categories for code quality issues.
 * Used for structured filtering instead of fragile keyword matching.
 */
export enum IssueCategory {
    /** Synthesizability problems (unsynthesizable constructs, timing issues) */
    SYNTHESIZABILITY = 'synthesizability',
    /** Documentation problems (missing comments, unclear descriptions) */
    DOCUMENTATION = 'documentation',
    /** Convention violations (naming, style, structure) */
    CONVENTION = 'convention',
    /** Security vulnerabilities */
    SECURITY = 'security',
    /** Performance concerns */
    PERFORMANCE = 'performance',
    /** Maintainability problems */
    MAINTAINABILITY = 'maintainability',
    /** Correctness/logic errors */
    CORRECTNESS = 'correctness',
    /** General/uncategorized issues */
    GENERAL = 'general'
}

/**
 * Severity levels for issues
 */
export enum IssueSeverity {
    ERROR = 'error',
    WARNING = 'warning',
    INFO = 'info',
    HINT = 'hint'
}

/**
 * A structured issue with category, severity, and description
 */
export interface CategorizedIssue {
    /** Issue category for filtering */
    category: IssueCategory;
    /** Severity level */
    severity: IssueSeverity;
    /** Human-readable description */
    message: string;
    /** Optional file location */
    location?: {
        file?: string;
        line?: number;
        column?: number;
    };
    /** Optional suggestion for fixing */
    suggestion?: string;
}

/**
 * Quality assessment result with categorized issues
 */
export interface QualityAssessment {
    /** Overall quality score (0-10) */
    score: number;
    /** All issues found */
    issues: CategorizedIssue[];
    /** Whether quality threshold is met */
    meetsThreshold: boolean;
}

/**
 * Helper to check if any issues exist in a category
 */
export function hasIssuesInCategory(issues: CategorizedIssue[], category: IssueCategory): boolean {
    return issues.some(issue => issue.category === category);
}

/**
 * Helper to filter issues by category
 */
export function getIssuesByCategory(issues: CategorizedIssue[], category: IssueCategory): CategorizedIssue[] {
    return issues.filter(issue => issue.category === category);
}

/**
 * Helper to filter issues by severity
 */
export function getIssuesBySeverity(issues: CategorizedIssue[], severity: IssueSeverity): CategorizedIssue[] {
    return issues.filter(issue => issue.severity === severity);
}

/**
 * Helper to categorize a string issue based on keywords (migration helper)
 */
export function categorizeIssue(message: string, defaultCategory = IssueCategory.GENERAL): CategorizedIssue {
    const lowerMessage = message.toLowerCase();

    // Determine category from keywords
    let category = defaultCategory;
    if (/synthesiz|timing|clock|latch|combinator/i.test(lowerMessage)) {
        category = IssueCategory.SYNTHESIZABILITY;
    } else if (/document|comment|describe|explain/i.test(lowerMessage)) {
        category = IssueCategory.DOCUMENTATION;
    } else if (/convention|naming|style|format|indent/i.test(lowerMessage)) {
        category = IssueCategory.CONVENTION;
    } else if (/security|vulnerab|inject|overflow/i.test(lowerMessage)) {
        category = IssueCategory.SECURITY;
    } else if (/performance|slow|optimi|efficien/i.test(lowerMessage)) {
        category = IssueCategory.PERFORMANCE;
    } else if (/maintain|complex|readab|refactor/i.test(lowerMessage)) {
        category = IssueCategory.MAINTAINABILITY;
    } else if (/error|bug|incorrect|wrong|fail/i.test(lowerMessage)) {
        category = IssueCategory.CORRECTNESS;
    }

    // Determine severity from keywords
    let severity = IssueSeverity.WARNING;
    if (/error|critical|fail|must/i.test(lowerMessage)) {
        severity = IssueSeverity.ERROR;
    } else if (/info|note|fyi/i.test(lowerMessage)) {
        severity = IssueSeverity.INFO;
    } else if (/hint|consider|might|could/i.test(lowerMessage)) {
        severity = IssueSeverity.HINT;
    }

    return {
        category,
        severity,
        message
    };
}

/**
 * Convert string array to categorized issues (migration helper)
 */
export function categorizeIssues(messages: string[]): CategorizedIssue[] {
    return messages.map(msg => categorizeIssue(msg));
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { PromptMode } from '../agent/prompts.js';
