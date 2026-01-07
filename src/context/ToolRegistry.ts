/**
 * Tool Registry for Dynamic Context Discovery
 *
 * Implements Cursor's tool description optimization strategy:
 * - Only tool names provided in system prompt
 * - Full descriptions available via describe_tool
 * - Expected ~46% token reduction
 */

import type { ToolDescription, ToolCategory, ToolMatch, ParameterDoc } from './types.js';

// ============================================================================
// Tool Registry
// ============================================================================

export class ToolRegistry {
    private tools: Map<string, ToolDescription> = new Map();
    private initialized: boolean = false;

    constructor() {
        this.initializeToolDescriptions();
    }

    /**
     * Initialize all tool descriptions
     * These are stored in-memory but could be loaded from files for even larger savings
     */
    private initializeToolDescriptions(): void {
        // File Operations
        this.register({
            name: 'read_file',
            description: 'Read the contents of a file. Returns file content with line numbers. Supports reading a specific range of lines.',
            category: 'file',
            parameters: [
                { name: 'path', type: 'string', description: 'Path to the file to read', required: true },
                { name: 'startLine', type: 'number', description: 'Starting line number (1-indexed)', required: false },
                { name: 'endLine', type: 'number', description: 'Ending line number (inclusive)', required: false }
            ],
            example: 'read_file({ path: "src/counter.sv", startLine: 10, endLine: 20 })'
        });

        this.register({
            name: 'write_file',
            description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Requires approval unless auto-approve is enabled.',
            category: 'file',
            parameters: [
                { name: 'path', type: 'string', description: 'Path to the file to write', required: true },
                { name: 'content', type: 'string', description: 'Full content to write to the file', required: true }
            ],
            example: 'write_file({ path: "src/new_module.sv", content: "module new_module(...);" })'
        });

        this.register({
            name: 'list_files',
            description: 'List files in a directory. By default filters for SystemVerilog files (.sv) and searches recursively.',
            category: 'file',
            parameters: [
                { name: 'directory', type: 'string', description: 'Directory path to list', required: true },
                { name: 'extensions', type: 'string[]', description: 'Filter by file extensions', required: false, default: ['.sv'] },
                { name: 'recursive', type: 'boolean', description: 'List recursively', required: false, default: true }
            ]
        });

        // Edit Operations
        this.register({
            name: 'edit_lines',
            description: 'Edit specific lines in a file. Replaces a range of lines with new content. Multiple edits can be applied in a single call.',
            category: 'edit',
            parameters: [
                { name: 'path', type: 'string', description: 'Path to the file to edit', required: true },
                { name: 'edits', type: 'array', description: 'List of edits: { startLine, endLine, newContent }', required: true }
            ],
            example: 'edit_lines({ path: "src/counter.sv", edits: [{ startLine: 5, endLine: 7, newContent: "logic [7:0] count;" }] })'
        });

        this.register({
            name: 'search_replace',
            description: 'Search and replace text in a file. Supports regex patterns and can replace all occurrences or just the first.',
            category: 'edit',
            parameters: [
                { name: 'path', type: 'string', description: 'Path to the file to edit', required: true },
                { name: 'search', type: 'string', description: 'Text or regex pattern to search for', required: true },
                { name: 'replace', type: 'string', description: 'Replacement text', required: true },
                { name: 'all', type: 'boolean', description: 'Replace all occurrences', required: false, default: false },
                { name: 'isRegex', type: 'boolean', description: 'Treat search as regex', required: false, default: false }
            ]
        });

        // Search Operations
        this.register({
            name: 'search_code',
            description: 'Search for a regex pattern across SystemVerilog files. Returns matching lines with file paths and line numbers.',
            category: 'search',
            parameters: [
                { name: 'pattern', type: 'string', description: 'Regex pattern to search for', required: true },
                { name: 'filePattern', type: 'string', description: 'Glob pattern for files to search', required: false, default: '**/*.sv' },
                { name: 'caseSensitive', type: 'boolean', description: 'Case sensitive search', required: false, default: false },
                { name: 'maxResults', type: 'number', description: 'Maximum results to return', required: false, default: 50 }
            ],
            example: 'search_code({ pattern: "always_ff.*posedge", maxResults: 20 })'
        });

        this.register({
            name: 'find_module',
            description: 'Find a module definition in the project index. Returns module info including ports, parameters, and file location.',
            category: 'search',
            parameters: [
                { name: 'name', type: 'string', description: 'Module name to find', required: true }
            ]
        });

        this.register({
            name: 'get_dependencies',
            description: 'Get the dependency graph for a module. Returns compilation order, missing modules, and any circular dependencies.',
            category: 'search',
            parameters: [
                { name: 'module', type: 'string', description: 'Module name to get dependencies for', required: true }
            ]
        });

        this.register({
            name: 'find_all_sv_files',
            description: 'Discover all SystemVerilog files in the project. Returns a list of file paths.',
            category: 'search',
            parameters: []
        });

        // Verification Operations
        this.register({
            name: 'lint_file',
            description: 'Run Verilator lint on a SystemVerilog file. Returns lint errors and warnings with line numbers and descriptions.',
            category: 'verification',
            parameters: [
                { name: 'path', type: 'string', description: 'Path to the SystemVerilog file to lint', required: true }
            ]
        });

        this.register({
            name: 'run_simulation',
            description: 'Run a Verilator simulation. Compiles the design and testbench, runs the simulation, and returns results including any VCD file generated.',
            category: 'verification',
            parameters: [
                { name: 'top', type: 'string', description: 'Top module name', required: true },
                { name: 'testbench', type: 'string', description: 'Testbench file path', required: false },
                { name: 'files', type: 'string[]', description: 'Additional source files', required: false },
                { name: 'plusArgs', type: 'string[]', description: 'Plus args for simulation', required: false },
                { name: 'timeout', type: 'number', description: 'Simulation timeout in seconds', required: false, default: 60 }
            ]
        });

        // Waveform Operations
        this.register({
            name: 'analyze_waveform',
            description: 'Analyze a VCD/FST waveform file. Returns signal list, time range, and detected anomalies (glitches, timing violations).',
            category: 'waveform',
            parameters: [
                { name: 'path', type: 'string', description: 'Path to VCD or FST file', required: true },
                { name: 'signals', type: 'string[]', description: 'Specific signals to analyze (optional)', required: false }
            ]
        });

        this.register({
            name: 'open_waveform',
            description: 'Open a waveform file in the system viewer (GTKWave or similar).',
            category: 'waveform',
            parameters: [
                { name: 'path', type: 'string', description: 'Path to VCD or FST file', required: true }
            ]
        });

        this.register({
            name: 'find_vcd_files',
            description: 'Find VCD/FST waveform files in the project directory.',
            category: 'waveform',
            parameters: [
                { name: 'directory', type: 'string', description: 'Directory to search', required: false }
            ]
        });

        // Project Operations
        this.register({
            name: 'ask_user',
            description: 'Ask the user a question and wait for their response. Use when you need clarification or approval.',
            category: 'project',
            parameters: [
                { name: 'question', type: 'string', description: 'Question to ask the user', required: true }
            ]
        });

        // Context Operations (new tools for dynamic context)
        this.register({
            name: 'describe_tool',
            description: 'Get the full description and parameters for a tool. Use this to understand how to use a tool before calling it.',
            category: 'context',
            parameters: [
                { name: 'toolName', type: 'string', description: 'Name of the tool to describe', required: true }
            ]
        });

        this.register({
            name: 'read_context_output',
            description: 'Read a portion of tool output stored in a context file. Use head/tail for quick inspection, or startLine/endLine for specific ranges.',
            category: 'context',
            parameters: [
                { name: 'ref', type: 'string', description: 'Context file path from tool result', required: true },
                { name: 'head', type: 'number', description: 'Read first N lines', required: false },
                { name: 'tail', type: 'number', description: 'Read last N lines', required: false },
                { name: 'startLine', type: 'number', description: 'Start line for range read', required: false },
                { name: 'endLine', type: 'number', description: 'End line for range read', required: false }
            ]
        });

        this.register({
            name: 'search_history',
            description: 'Search archived conversation history for relevant context. Use when you need to recall earlier discussion details.',
            category: 'context',
            parameters: [
                { name: 'query', type: 'string', description: 'What to search for in history', required: true },
                { name: 'sessionOnly', type: 'boolean', description: 'Search only current session', required: false, default: true }
            ]
        });

        this.register({
            name: 'search_terminal',
            description: 'Search terminal/simulation output for patterns. Use to find specific errors or output in previous command executions.',
            category: 'context',
            parameters: [
                { name: 'pattern', type: 'string', description: 'Regex pattern to search', required: true },
                { name: 'context', type: 'number', description: 'Lines of context around matches', required: false, default: 2 }
            ]
        });

        this.register({
            name: 'get_terminal_file_path',
            description: 'Get the file path of the terminal session log. Use this to grep the terminal output directly.',
            category: 'context',
            parameters: []
        });

        // Skill Operations
        this.register({
            name: 'search_skills',
            description: 'Search for relevant skills by capability or task. Skills are file-based definitions that guide specialized tasks.',
            category: 'skills',
            parameters: [
                { name: 'query', type: 'string', description: 'What capability or task to search for', required: true },
                { name: 'maxResults', type: 'number', description: 'Maximum number of results', required: false, default: 5 }
            ],
            example: 'search_skills({ query: "fix lint errors" })'
        });

        this.register({
            name: 'get_skill',
            description: 'Get the full definition of a skill by name. Returns instructions, triggers, and bundled scripts.',
            category: 'skills',
            parameters: [
                { name: 'name', type: 'string', description: 'Name of the skill to retrieve', required: true }
            ]
        });

        this.register({
            name: 'run_skill_script',
            description: 'Execute a bundled script from a skill. Scripts are defined in the skill file.',
            category: 'skills',
            parameters: [
                { name: 'skillName', type: 'string', description: 'Name of the skill', required: true },
                { name: 'scriptPath', type: 'string', description: 'Path to the script within the skill', required: true },
                { name: 'env', type: 'object', description: 'Additional environment variables', required: false }
            ]
        });

        // MCP Operations
        this.register({
            name: 'check_mcp_status',
            description: 'Check the status of MCP servers and their tools. Shows which servers need re-authentication.',
            category: 'mcp',
            parameters: [
                { name: 'serverName', type: 'string', description: 'Specific server to check (default: all servers)', required: false }
            ]
        });

        this.register({
            name: 'get_mcp_tool',
            description: 'Get the full definition of an MCP tool including its input schema.',
            category: 'mcp',
            parameters: [
                { name: 'serverName', type: 'string', description: 'Name of the MCP server', required: true },
                { name: 'toolName', type: 'string', description: 'Name of the tool', required: true }
            ]
        });

        this.initialized = true;
    }

    /**
     * Register a tool description
     */
    private register(tool: ToolDescription): void {
        this.tools.set(tool.name, tool);
    }

    /**
     * Get minimal tool list for system prompt (names only)
     * This is the key optimization - ~46% token reduction
     */
    getMinimalToolList(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Get minimal tool list grouped by category
     */
    getToolListByCategory(): Record<ToolCategory, string[]> {
        const result: Record<string, string[]> = {};

        for (const [name, tool] of this.tools) {
            if (!result[tool.category]) {
                result[tool.category] = [];
            }
            result[tool.category].push(name);
        }

        return result as Record<ToolCategory, string[]>;
    }

    /**
     * Get full description for a specific tool
     * Called by describe_tool
     */
    getToolDescription(name: string): ToolDescription | null {
        return this.tools.get(name) ?? null;
    }

    /**
     * Format tool description for agent consumption
     */
    formatToolDescription(tool: ToolDescription): string {
        const params = tool.parameters.map(p => {
            const reqStr = p.required ? '(required)' : `(optional, default: ${JSON.stringify(p.default)})`;
            return `  - ${p.name}: ${p.type} ${reqStr}\n    ${p.description}`;
        }).join('\n');

        let result = `## ${tool.name}\n\n`;
        result += `${tool.description}\n\n`;
        result += `**Category**: ${tool.category}\n\n`;

        if (tool.parameters.length > 0) {
            result += `**Parameters**:\n${params}\n`;
        } else {
            result += `**Parameters**: None\n`;
        }

        if (tool.example) {
            result += `\n**Example**:\n\`\`\`\n${tool.example}\n\`\`\`\n`;
        }

        return result;
    }

    /**
     * Search tools by capability (simple keyword matching)
     * Could be enhanced with embeddings for semantic search
     */
    searchTools(query: string): ToolMatch[] {
        const queryLower = query.toLowerCase();
        const matches: ToolMatch[] = [];

        for (const [name, tool] of this.tools) {
            const nameLower = name.toLowerCase();
            const descLower = tool.description.toLowerCase();

            // Simple relevance scoring
            let relevance = 0;

            if (nameLower.includes(queryLower)) {
                relevance += 0.8;
            }
            if (descLower.includes(queryLower)) {
                relevance += 0.5;
            }

            // Check parameter descriptions
            for (const param of tool.parameters) {
                if (param.description.toLowerCase().includes(queryLower)) {
                    relevance += 0.2;
                }
            }

            if (relevance > 0) {
                matches.push({
                    name,
                    description: tool.description,
                    relevance: Math.min(relevance, 1)
                });
            }
        }

        return matches.sort((a, b) => b.relevance - a.relevance);
    }

    /**
     * Get all tools in a specific category
     */
    getToolsByCategory(category: ToolCategory): ToolDescription[] {
        const result: ToolDescription[] = [];

        for (const tool of this.tools.values()) {
            if (tool.category === category) {
                result.push(tool);
            }
        }

        return result;
    }

    /**
     * Check if a tool exists
     */
    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Get count of registered tools
     */
    get toolCount(): number {
        return this.tools.size;
    }
}

// Singleton instance
let registryInstance: ToolRegistry | null = null;

/**
 * Get the global ToolRegistry instance
 */
export function getToolRegistry(): ToolRegistry {
    if (!registryInstance) {
        registryInstance = new ToolRegistry();
    }
    return registryInstance;
}
