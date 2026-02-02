/**
 * Tool Schemas
 * Zod schemas for all tool parameters.
 */

import { z } from 'zod';

// ========================================================================
// Tool Definitions (Zod Schemas)
// ========================================================================

// Read File
export const readFileSchema = z.object({
    path: z.string().describe('Path to the file to read'),
    startLine: z.number().optional().describe('Starting line number (1-indexed)'),
    endLine: z.number().optional().describe('Ending line number (inclusive)')
});

// Write File
export const writeFileSchema = z.object({
    path: z.string().describe('Path to the file to write'),
    content: z.string().describe('Full content to write to the file')
});

// Edit Lines
export const editLinesSchema = z.object({
    path: z.string().describe('Path to the file to edit'),
    edits: z.array(z.object({
        startLine: z.number().describe('First line to replace (1-indexed)'),
        endLine: z.number().describe('Last line to replace (inclusive)'),
        newContent: z.string().describe('New content to insert')
    })).describe('List of edits to apply')
});

// Search Replace
export const searchReplaceSchema = z.object({
    path: z.string().describe('Path to the file to edit'),
    search: z.string().describe('Text or regex pattern to search for'),
    replace: z.string().describe('Replacement text'),
    all: z.boolean().optional().default(false).describe('Replace all occurrences'),
    isRegex: z.boolean().optional().default(false).describe('Treat search as regex')
});

// List Files
export const listFilesSchema = z.object({
    directory: z.string().describe('Directory path to list'),
    extensions: z.array(z.string()).optional().default(['.sv']).describe('Filter by file extensions (default: [".sv"])'),
    recursive: z.boolean().optional().default(true).describe('List recursively (default: true)')
});

// Search Code
export const searchCodeSchema = z.object({
    pattern: z.string().describe('Search pattern (regex)'),
    filePattern: z.string().optional().default('**/*.sv').describe('Glob pattern for files to search (default: "**/*.sv")'),
    caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
    maxResults: z.number().optional().default(50).describe('Maximum results to return')
});

// Find Module
export const findModuleSchema = z.object({
    name: z.string().describe('Module name to find')
});

// Get Dependencies
export const getDependenciesSchema = z.object({
    module: z.string().describe('Module name to get dependencies for')
});

// Lint File
export const lintFileSchema = z.object({
    path: z.string().describe('Path to the SystemVerilog file to lint')
});

// Run Simulation
export const runSimSchema = z.object({
    top: z.string().describe('Top module name'),
    testbench: z.string().optional().describe('Testbench file path'),
    timeout: z.number().optional().describe('Simulation timeout in ms'),
    analyzeWaveform: z.boolean().optional().default(false).describe('Analyze the VCD waveform after simulation completes')
});

// Open Waveform Viewer
export const openWaveformSchema = z.object({
    vcdPath: z.string().describe('Path to the VCD file to open in the interactive viewer')
});

// Find All SV Files
export const findAllSvFilesSchema = z.object({
    directory: z.string().optional().default('.').describe('Starting directory (default: project root)')
});

// Analyze Waveform
export const analyzeWaveformSchema = z.object({
    vcdPath: z.string().describe('Path to the VCD file to analyze'),
    signals: z.array(z.string()).optional().describe('Specific signals to analyze (default: all)'),
    detectClocks: z.boolean().optional().default(true).describe('Detect clock signals automatically'),
    checkAnomalies: z.boolean().optional().default(true).describe('Check for signal anomalies')
});

// Ask User (Human-in-the-loop)
export const askUserSchema = z.object({
    question: z.string().describe('Question to ask the user'),
    options: z.array(z.string()).optional().describe('Optional list of choices for the user'),
    default: z.string().optional().describe('Default option if user just presses enter')
});

// Find VCD Files
export const findVcdFilesSchema = z.object({
    directory: z.string().optional().default('.').describe('Starting directory (default: project root)'),
    pattern: z.string().optional().describe('Optional filename pattern to match (e.g., "counter" matches "counter.vcd")')
});

// ========================================================================
// Dynamic Context Discovery Tools (Schemas)
// ========================================================================

// Describe Tool - Get full description of any tool
export const describeToolSchema = z.object({
    toolName: z.string().describe('Name of the tool to describe')
});

// Read Context Output - Read portions of stored tool output
export const readContextOutputSchema = z.object({
    ref: z.string().describe('Context file path from tool result'),
    head: z.number().optional().describe('Read first N lines'),
    tail: z.number().optional().describe('Read last N lines'),
    startLine: z.number().optional().describe('Start line for range read (1-indexed)'),
    endLine: z.number().optional().describe('End line for range read (inclusive)')
});

// Search History - Search archived conversation history
export const searchHistorySchema = z.object({
    query: z.string().describe('Search query (regex supported)'),
    sessionOnly: z.boolean().optional().default(true).describe('Limit to current session history'),
    maxResults: z.number().optional().default(20).describe('Maximum results to return')
});

// Search Terminal - Search terminal output
export const searchTerminalSchema = z.object({
    pattern: z.string().optional().describe('Search pattern (regex supported)'),
    query: z.string().optional().describe('Alias for pattern'),
    context: z.number().optional().default(2).describe('Context lines to include around matches'),
    maxResults: z.number().optional().default(20).describe('Maximum results to return')
});

// Get Terminal File Path
export const getTerminalFilePathSchema = z.object({});

// Search Skills
export const searchSkillsSchema = z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().optional().default(10).describe('Maximum results to return')
});

// Get Skill
export const getSkillSchema = z.object({
    name: z.string().describe('Skill name')
});

// Run Skill Script
export const runSkillScriptSchema = z.object({
    skillName: z.string().optional().describe('Skill name'),
    name: z.string().optional().describe('Alias for skillName'),
    scriptPath: z.string().optional().describe('Script name to run'),
    script: z.string().optional().describe('Alias for scriptPath'),
    args: z.array(z.string()).optional().describe('Optional script arguments'),
    env: z.record(z.string(), z.string()).optional().describe('Environment variables for the script')
});

// MCP Tool Status
export const checkMcpStatusSchema = z.object({
    serverName: z.string().optional().describe('Optional server name to check (default: all)'),
    server: z.string().optional().describe('Alias for serverName')
});

// MCP Tool Definition
export const getMcpToolSchema = z.object({
    serverName: z.string().optional().describe('Server name'),
    toolName: z.string().optional().describe('Tool name'),
    server: z.string().optional().describe('Alias for serverName'),
    tool: z.string().optional().describe('Alias for toolName')
});

// ========================================================================
// Context Window Management (Cursor-style)
// ========================================================================

export const grepContextSchema = z.object({
    pattern: z.string().optional().describe('Search pattern (regex supported)'),
    query: z.string().optional().describe('Alias for pattern'),
    filePattern: z.string().optional().default('**/*').describe('Glob for files to search'),
    context: z.number().optional().default(2).describe('Context lines to include'),
    maxResults: z.number().optional().default(50).describe('Maximum results to return')
});

export const jqContextSchema = z.object({
    filePath: z.string().optional().describe('Context file path'),
    ref: z.string().optional().describe('Alias for filePath'),
    filter: z.string().describe('JQ filter expression')
});

export const tailContextSchema = z.object({
    filePath: z.string().optional().describe('Context file path'),
    ref: z.string().optional().describe('Alias for filePath'),
    lines: z.number().optional().default(50).describe('Number of lines to read')
});

export const headContextSchema = z.object({
    filePath: z.string().optional().describe('Context file path'),
    ref: z.string().optional().describe('Alias for filePath'),
    lines: z.number().optional().default(50).describe('Number of lines to read')
});

export const listContextSchema = z.object({
    type: z.enum(['all', 'tool_output', 'tool', 'history', 'terminal']).optional().default('all')
        .describe('Context file type to list')
});

export const getFileChunkSchema = z.object({
    filePath: z.string().optional().describe('File path to read'),
    path: z.string().optional().describe('Alias for filePath'),
    chunkType: z.enum(['module', 'interface', 'package', 'class', 'function', 'task', 'always_block'])
        .optional()
        .describe('Chunk type to extract'),
    chunkName: z.string().optional().describe('Chunk name to extract'),
    lineNumber: z.number().optional().describe('Line number to locate chunk')
});

export const selectChunksSchema = z.object({
    filePath: z.string().optional().describe('File path to search'),
    path: z.string().optional().describe('Alias for filePath'),
    query: z.string().describe('Query describing what you need (e.g., "clock reset logic", "state machine")'),
    maxTokens: z.number().optional().default(2000).describe('Token budget for selected chunks')
});

export const searchKnowledgeSchema = z.object({
    query: z.string().describe('Search query for knowledge base'),
    maxResults: z.number().optional().default(10).describe('Maximum results to return'),
    structuralOnly: z.boolean().optional().default(false).describe('Search only structural knowledge'),
    learnedOnly: z.boolean().optional().default(false).describe('Search only learned knowledge'),
    types: z.array(z.string()).optional().describe('Filter by knowledge types')
});

export const getTokenBudgetSchema = z.object({});

// Continuation system - checkpoint
export const requestContinuationSchema = z.object({
    completedTasks: z.array(z.string()).describe('List of completed tasks'),
    remainingTasks: z.array(z.string()).describe('List of remaining tasks'),
    partialResults: z.string().describe('Partial results or summary so far'),
    notes: z.string().describe('Notes or warnings for continuation')
});

// Tool setup helpers
export const checkToolStatusSchema = z.object({
    tool: z.enum(['verible', 'slang', 'both']).optional().default('both')
        .describe('Which tool to check status for (default: both)')
});

export const setupVeribleSchema = z.object({});
export const setupSlangSchema = z.object({});

export const helpSetupToolsSchema = z.object({
    tools: z.array(z.enum(['verible', 'slang'])).optional()
        .describe('Specific tools to help with (default: all missing tools)')
});
