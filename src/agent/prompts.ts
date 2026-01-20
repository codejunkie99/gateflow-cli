/**
 * GateFlow Agent Prompt Library
 * Task-specific system prompts using PromptBuilder presets
 */

import {
    buildGeneralPrompt,
    buildLintFixPrompt,
    buildTestbenchPrompt,
    buildEditPrompt,
    buildDebugPrompt,
    buildGeneratePrompt,
} from './prompts/presets/index.js';

// ============================================================================
// Types
// ============================================================================

export type PromptMode =
    | 'general'
    | 'lint_fix'
    | 'testbench'
    | 'debug'
    | 'edit'
    | 'generate';

// ============================================================================
// Dynamic Context Discovery: Minimal Tool List
// ============================================================================

/**
 * Generate minimal tool list for system prompt.
 * This implements Cursor's ~46% token reduction strategy:
 * - Only tool names provided in context
 * - Agent must call describe_tool for full details
 */
export function getMinimalToolSection(enableOptimization: boolean = true): string {
    if (!enableOptimization) {
        // Return empty - full tool descriptions will be in the SDK tool definitions
        return '';
    }

    return `
## Available Tools

**File Operations**: read_file, write_file, list_files
**Edit Operations**: edit_lines, search_replace
**Search Operations**: search_code, find_module, find_all_sv_files, get_dependencies
**Verification**: lint_file, run_simulation
**Waveform**: analyze_waveform, open_waveform, find_vcd_files
**Context Discovery**: describe_tool, read_context_output, search_terminal, search_history, get_terminal_file_path
**Skills**: search_skills, get_skill, run_skill_script
**MCP Tools**: check_mcp_status, get_mcp_tool
**Interaction**: ask_user

To learn about any tool's parameters and usage, call: describe_tool({ toolName: "tool_name" })

## Dynamic Context Discovery

**Large Outputs**: For large tool outputs (lint errors, simulation logs), the response includes:
- outputFile: Path to the full output file
- commands: Ready-to-use shell commands (tail, head, grep)

When you receive a large output:
1. First use \`tail -50 "path"\` to check the end (often contains the summary/result)
2. Use \`grep -n "error\\|ERROR" "path"\` to find specific issues
3. Use \`head -50 "path"\` or line ranges if you need earlier content
4. Only read the full file if absolutely necessary

**Terminal History**: Use get_terminal_file_path to get the terminal log file, then grep it directly.

**Skills**: Skills are file-based capabilities in .gateflow/skills/. Use search_skills to find relevant skills,
or grep the skills directory directly. Skills may include bundled scripts you can run with run_skill_script.

**MCP Tools**: External tools from MCP servers. Use check_mcp_status to see available servers and their auth status.
If a server needs re-authentication, inform the user. MCP tool definitions are synced to .gateflow/mcp-tools/.

**History**: If context was summarized, use search_history to recover archived details, or grep the archive file.
`;
}

// ============================================================================
// System Prompt Options
// ============================================================================

export interface SystemPromptOptions {
    /** Enable minimal tool list optimization (default: true) */
    enableToolOptimization?: boolean;
    /** Lint errors for lint_fix mode */
    errors?: any[];
    /** Previous fix attempts for lint_fix mode */
    previousFixes?: string[];
    /** Module specification for testbench mode */
    moduleSpec?: any;
}

/**
 * Get the system prompt for a given mode using PromptBuilder presets
 * @param mode - The prompt mode to use
 * @param options - Optional configuration
 */
export function getSystemPrompt(mode: PromptMode, options: SystemPromptOptions = {}): string {
    const toolSection = getMinimalToolSection(options.enableToolOptimization ?? true);

    // Use PromptBuilder presets for each mode
    let basePrompt: string;

    switch (mode) {
        case 'general':
            basePrompt = buildGeneralPrompt();
            break;
        case 'lint_fix':
            basePrompt = buildLintFixPrompt(options.errors || [], options.previousFixes);
            break;
        case 'testbench':
            basePrompt = buildTestbenchPrompt(options.moduleSpec || { name: 'unknown' });
            break;
        case 'edit':
            basePrompt = buildEditPrompt();
            break;
        case 'debug':
            basePrompt = buildDebugPrompt();
            break;
        case 'generate':
            basePrompt = buildGeneratePrompt();
            break;
        default:
            basePrompt = buildGeneralPrompt();
    }

    return basePrompt + toolSection;
}

// ============================================================================
// Mode Detection
// ============================================================================

export interface DetectModeContext {
    hasErrors?: boolean;
    command?: 'generate' | 'edit' | 'lint' | 'fix' | 'chat';
}

/**
 * Detect the appropriate prompt mode from query text and context.
 * Priority ordering prevents mis-routing (e.g., "generate testbench" -> testbench, not generate)
 */
export function detectMode(query: string, context: DetectModeContext = {}): PromptMode {
    const q = (query || '').toLowerCase();

    // Highest priority: known error context (from previous lint)
    if (context.hasErrors) return 'lint_fix';

    // Command hints (from CLI command)
    if (context.command === 'lint' || context.command === 'fix') return 'lint_fix';
    if (context.command === 'generate') {
        // "generate testbench" should route to testbench mode
        if (q.includes('testbench') || /\btb\b/.test(q)) return 'testbench';
        return 'generate';
    }
    if (context.command === 'edit') return 'edit';

    // Keyword-based routing (order matters!)

    // Lint/fix errors
    if (
        q.includes('lint') ||
        q.includes('verilator') ||
        q.includes('fix error') ||
        q.includes('compile error') ||
        q.includes('syntax error')
    ) {
        return 'lint_fix';
    }

    // Testbench phrases (before generate, since "generate testbench" is common)
    if (
        q.includes('testbench') ||
        q.includes('test bench') ||
        /\btb[_\s]/.test(q) ||
        q.includes('stimulus') ||
        q.includes('scoreboard')
    ) {
        return 'testbench';
    }

    // Debug (runtime / simulation failures)
    if (
        q.includes('debug') ||
        (q.includes('simulation') && (q.includes('fail') || q.includes('hang') || q.includes('mismatch'))) ||
        q.includes('$fatal') ||
        q.includes('assertion')
    ) {
        return 'debug';
    }

    // Edit intent
    if (
        q.includes('edit') ||
        q.includes('modify') ||
        q.includes('change') ||
        q.includes('update') ||
        q.includes('refactor') ||
        q.includes('add a') ||
        q.includes('remove')
    ) {
        return 'edit';
    }

    // Generate intent
    if (
        q.includes('create') ||
        q.includes('generate') ||
        q.includes('new module') ||
        q.includes('write a module') ||
        q.includes('implement a')
    ) {
        return 'generate';
    }

    return 'general';
}
