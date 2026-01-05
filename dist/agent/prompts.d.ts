/**
 * GateFlow Agent Prompt Library
 * Task-specific system prompts for different modes of operation
 *
 * @deprecated The prompt strings below are deprecated in favor of PromptBuilder.
 * This file is kept for getSystemPrompt() and detectMode() functions which are still used.
 * The old prompt strings will be removed once all code is migrated to PromptBuilder presets.
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
