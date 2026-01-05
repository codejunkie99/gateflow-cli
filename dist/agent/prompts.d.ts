/**
 * GateFlow Agent Prompt Library
 * Task-specific system prompts for different modes of operation
 *
 * ## Status
 * - getSystemPrompt() and detectMode() are ACTIVE and used by core.ts and fix-loop.ts
 * - The monolithic prompt strings below are DEPRECATED in favor of PromptBuilder
 * - New development should use: cli/src/agent/prompts/presets/*.ts
 *
 * ## Migration Path
 * Once core.ts single-agent flow is updated to use PromptBuilder presets,
 * the SYSTEM_PROMPTS registry and mode-specific prompts can be removed.
 * Keep only: PromptMode type, detectMode(), and getSystemPrompt() delegating to presets.
 */
export type PromptMode = 'general' | 'lint_fix' | 'testbench' | 'debug' | 'edit' | 'generate';
export declare const SYSTEM_PROMPTS: Record<PromptMode, string>;
/**
 * Get the system prompt for a given mode
 */
export declare function getSystemPrompt(mode: PromptMode): string;
export interface DetectModeContext {
    hasErrors?: boolean;
    command?: 'generate' | 'edit' | 'lint' | 'fix' | 'chat';
}
/**
 * Detect the appropriate prompt mode from query text and context.
 * Priority ordering prevents mis-routing (e.g., "generate testbench" -> testbench, not generate)
 */
export declare function detectMode(query: string, context?: DetectModeContext): PromptMode;
