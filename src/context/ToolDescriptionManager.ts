/**
 * ToolDescriptionManager
 *
 * Implements Cursor's Pattern 4: Tool Description Optimization
 * - Tool descriptions stored in files, not system prompt
 * - Only category/name index sent to agent (~200 tokens vs ~8000)
 * - Full descriptions loaded on-demand via describe_tool
 * - Expected 46.9% token reduction (from Cursor's A/B test)
 *
 * File structure:
 * ~/.gateflow/tools/
 * ├── _index.json           # Category -> tool names mapping
 * ├── file_ops/
 * │   ├── read_file.md
 * │   ├── write_file.md
 * │   └── _index.json       # Category-specific index
 * ├── analysis/
 * │   ├── lint_file.md
 * │   └── run_simulation.md
 * └── ...
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ToolCategory, ToolDescription, ParameterDoc } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal tool index (what goes in system prompt)
 */
export interface ToolIndex {
    categories: Record<string, string[]>;
    totalCount: number;
    lastUpdated: number;
}

/**
 * Tool file metadata
 */
export interface ToolFileMeta {
    name: string;
    category: string;
    filePath: string;
    description: string;  // One-line summary
    hasExample: boolean;
}

/**
 * Configuration for ToolDescriptionManager
 */
export interface ToolDescriptionManagerConfig {
    /** Base directory for tool files */
    toolsDir: string;
    /** Use file-based storage (vs in-memory) */
    useFileStorage: boolean;
}

// ============================================================================
// Default Tool Descriptions
// ============================================================================

// Bundled descriptions for initialization
const DEFAULT_TOOL_DESCRIPTIONS: ToolDescription[] = [
    // File Operations
    {
        name: 'read_file',
        category: 'file',
        description: 'Read the contents of a file. Returns file content with line numbers.',
        parameters: [
            { name: 'path', type: 'string', description: 'Path to the file', required: true },
            { name: 'startLine', type: 'number', description: 'Starting line (1-indexed)', required: false },
            { name: 'endLine', type: 'number', description: 'Ending line (inclusive)', required: false }
        ]
    },
    {
        name: 'write_file',
        category: 'file',
        description: 'Write content to a file. Creates or overwrites. Requires approval.',
        parameters: [
            { name: 'path', type: 'string', description: 'Path to the file', required: true },
            { name: 'content', type: 'string', description: 'Content to write', required: true }
        ]
    },
    {
        name: 'list_files',
        category: 'file',
        description: 'List files in a directory. Default: SystemVerilog files recursively.',
        parameters: [
            { name: 'directory', type: 'string', description: 'Directory path', required: true },
            { name: 'extensions', type: 'string[]', description: 'Filter by extensions', required: false },
            { name: 'recursive', type: 'boolean', description: 'Search recursively', required: false, default: true }
        ]
    },
    // Edit Operations
    {
        name: 'edit_lines',
        category: 'edit',
        description: 'Edit specific lines in a file. Replaces line range with new content.',
        parameters: [
            { name: 'path', type: 'string', description: 'Path to the file', required: true },
            { name: 'edits', type: 'array', description: 'List of {startLine, endLine, newContent}', required: true }
        ],
        example: 'edit_lines({ path: "src/counter.sv", edits: [{ startLine: 5, endLine: 7, newContent: "logic [7:0] count;" }] })'
    },
    {
        name: 'search_replace',
        category: 'edit',
        description: 'Search and replace text. Supports regex patterns.',
        parameters: [
            { name: 'path', type: 'string', description: 'Path to the file', required: true },
            { name: 'search', type: 'string', description: 'Pattern to search', required: true },
            { name: 'replace', type: 'string', description: 'Replacement text', required: true },
            { name: 'all', type: 'boolean', description: 'Replace all occurrences', required: false },
            { name: 'isRegex', type: 'boolean', description: 'Treat as regex', required: false }
        ]
    },
    // Search Operations
    {
        name: 'search_code',
        category: 'search',
        description: 'Search for pattern across SystemVerilog files.',
        parameters: [
            { name: 'pattern', type: 'string', description: 'Regex pattern', required: true },
            { name: 'filePattern', type: 'string', description: 'Glob for files', required: false },
            { name: 'maxResults', type: 'number', description: 'Max results', required: false, default: 50 }
        ]
    },
    {
        name: 'find_module',
        category: 'search',
        description: 'Find module definition in project index. Returns ports and parameters.',
        parameters: [
            { name: 'name', type: 'string', description: 'Module name', required: true }
        ]
    },
    {
        name: 'get_dependencies',
        category: 'search',
        description: 'Get module dependency graph. Returns compilation order.',
        parameters: [
            { name: 'module', type: 'string', description: 'Module name', required: true }
        ]
    },
    // Verification Operations
    {
        name: 'lint_file',
        category: 'verification',
        description: 'Run Verilator lint on a file. Returns errors/warnings with line numbers.',
        parameters: [
            { name: 'path', type: 'string', description: 'Path to SV file', required: true }
        ]
    },
    {
        name: 'run_simulation',
        category: 'verification',
        description: 'Run Verilator simulation. Compiles, runs, returns results and VCD.',
        parameters: [
            { name: 'top', type: 'string', description: 'Top module name', required: true },
            { name: 'testbench', type: 'string', description: 'Testbench file', required: false },
            { name: 'files', type: 'string[]', description: 'Additional sources', required: false },
            { name: 'timeout', type: 'number', description: 'Timeout in seconds', required: false, default: 60 }
        ]
    },
    // Waveform Operations
    {
        name: 'analyze_waveform',
        category: 'waveform',
        description: 'Analyze VCD/FST waveform. Returns signals, time range, anomalies.',
        parameters: [
            { name: 'path', type: 'string', description: 'Path to waveform file', required: true },
            { name: 'signals', type: 'string[]', description: 'Signals to analyze', required: false }
        ]
    },
    // Context Operations
    {
        name: 'grep_context',
        category: 'context',
        description: 'Search context files (tool outputs, history) with grep pattern.',
        parameters: [
            { name: 'file', type: 'string', description: 'File path or pattern', required: true },
            { name: 'pattern', type: 'string', description: 'Search pattern (regex)', required: true },
            { name: 'context', type: 'number', description: 'Context lines', required: false }
        ]
    },
    {
        name: 'tail_context',
        category: 'context',
        description: 'Get last N lines of a context file. Check end for errors.',
        parameters: [
            { name: 'file', type: 'string', description: 'Context file path', required: true },
            { name: 'lines', type: 'number', description: 'Number of lines', required: false, default: 50 }
        ]
    },
    {
        name: 'head_context',
        category: 'context',
        description: 'Get first N lines of a context file.',
        parameters: [
            { name: 'file', type: 'string', description: 'Context file path', required: true },
            { name: 'lines', type: 'number', description: 'Number of lines', required: false, default: 50 }
        ]
    },
    {
        name: 'search_history',
        category: 'context',
        description: 'Search archived conversation history for relevant context.',
        parameters: [
            { name: 'query', type: 'string', description: 'Search query', required: true },
            { name: 'sessionId', type: 'string', description: 'Specific session', required: false }
        ]
    },
    {
        name: 'list_context',
        category: 'context',
        description: 'List available context files for current session.',
        parameters: []
    },
    {
        name: 'describe_tool',
        category: 'context',
        description: 'Get full description of a tool. Use before calling unfamiliar tools.',
        parameters: [
            { name: 'toolName', type: 'string', description: 'Name of the tool', required: true }
        ]
    }
];

// ============================================================================
// ToolDescriptionManager Implementation
// ============================================================================

export class ToolDescriptionManager {
    private config: ToolDescriptionManagerConfig;
    private toolIndex: ToolIndex | null = null;
    private toolCache: Map<string, ToolDescription> = new Map();
    private initialized = false;

    constructor(config?: Partial<ToolDescriptionManagerConfig>) {
        const homeDir = os.homedir();
        this.config = {
            toolsDir: config?.toolsDir ?? path.join(homeDir, '.gateflow', 'tools'),
            useFileStorage: config?.useFileStorage ?? true
        };
    }

    // ========================================================================
    // Initialization
    // ========================================================================

    async initialize(): Promise<void> {
        if (this.initialized) return;

        if (this.config.useFileStorage) {
            await fs.mkdir(this.config.toolsDir, { recursive: true });

            // Check if index exists
            const indexPath = path.join(this.config.toolsDir, '_index.json');
            try {
                await fs.access(indexPath);
            } catch {
                // Initialize with default tools
                await this.writeDefaultTools();
            }
        }

        // Load index
        await this.loadIndex();
        this.initialized = true;
    }

    /**
     * Write default tool descriptions to files
     */
    private async writeDefaultTools(): Promise<void> {
        const categoryTools: Record<string, ToolDescription[]> = {};

        // Group by category
        for (const tool of DEFAULT_TOOL_DESCRIPTIONS) {
            if (!categoryTools[tool.category]) {
                categoryTools[tool.category] = [];
            }
            categoryTools[tool.category].push(tool);
        }

        // Write each category
        for (const [category, tools] of Object.entries(categoryTools)) {
            const categoryDir = path.join(this.config.toolsDir, category);
            await fs.mkdir(categoryDir, { recursive: true });

            // Write each tool
            for (const tool of tools) {
                const content = this.formatToolAsMarkdown(tool);
                const filePath = path.join(categoryDir, `${tool.name}.md`);
                await fs.writeFile(filePath, content, 'utf-8');
            }

            // Write category index
            const categoryIndex = tools.map(t => t.name);
            await fs.writeFile(
                path.join(categoryDir, '_index.json'),
                JSON.stringify(categoryIndex, null, 2),
                'utf-8'
            );
        }

        // Write main index
        const mainIndex: Record<string, string[]> = {};
        for (const [category, tools] of Object.entries(categoryTools)) {
            mainIndex[category] = tools.map(t => t.name);
        }

        await fs.writeFile(
            path.join(this.config.toolsDir, '_index.json'),
            JSON.stringify({
                categories: mainIndex,
                totalCount: DEFAULT_TOOL_DESCRIPTIONS.length,
                lastUpdated: Date.now()
            }, null, 2),
            'utf-8'
        );
    }

    /**
     * Format tool description as markdown file
     */
    private formatToolAsMarkdown(tool: ToolDescription): string {
        let md = `---\n`;
        md += `name: ${tool.name}\n`;
        md += `category: ${tool.category}\n`;
        md += `---\n\n`;
        md += `# ${tool.name}\n\n`;
        md += `${tool.description}\n\n`;
        md += `## Parameters\n\n`;

        if (tool.parameters.length === 0) {
            md += `None\n`;
        } else {
            for (const param of tool.parameters) {
                const req = param.required ? '(required)' : `(optional${param.default !== undefined ? `, default: ${JSON.stringify(param.default)}` : ''})`;
                md += `- **${param.name}** (${param.type}) ${req}\n`;
                md += `  ${param.description}\n`;
            }
        }

        if (tool.example) {
            md += `\n## Example\n\n`;
            md += `\`\`\`typescript\n${tool.example}\n\`\`\`\n`;
        }

        return md;
    }

    /**
     * Load index from file or memory
     */
    private async loadIndex(): Promise<void> {
        if (this.config.useFileStorage) {
            const indexPath = path.join(this.config.toolsDir, '_index.json');
            try {
                const content = await fs.readFile(indexPath, 'utf-8');
                this.toolIndex = JSON.parse(content);
            } catch {
                this.toolIndex = { categories: {}, totalCount: 0, lastUpdated: 0 };
            }
        } else {
            // Build from defaults
            const categories: Record<string, string[]> = {};
            for (const tool of DEFAULT_TOOL_DESCRIPTIONS) {
                if (!categories[tool.category]) {
                    categories[tool.category] = [];
                }
                categories[tool.category].push(tool.name);
            }
            this.toolIndex = {
                categories,
                totalCount: DEFAULT_TOOL_DESCRIPTIONS.length,
                lastUpdated: Date.now()
            };
        }
    }

    // ========================================================================
    // Pattern 4: Minimal Index for System Prompt
    // ========================================================================

    /**
     * Get minimal tool index for system prompt
     * This is the key optimization - ~46.9% token reduction
     *
     * Returns ~200 tokens instead of ~8000 tokens for full descriptions
     */
    async getMinimalIndex(): Promise<string> {
        await this.initialize();

        if (!this.toolIndex) {
            return 'No tools available.';
        }

        let output = 'Available tools by category:\n\n';

        for (const [category, tools] of Object.entries(this.toolIndex.categories)) {
            output += `**${category}**: ${tools.join(', ')}\n`;
        }

        output += `\nTotal: ${this.toolIndex.totalCount} tools. Use describe_tool(name) for details.`;

        return output;
    }

    /**
     * Get tool index as JSON (for structured use)
     */
    async getToolIndexJson(): Promise<ToolIndex> {
        await this.initialize();
        return this.toolIndex ?? { categories: {}, totalCount: 0, lastUpdated: 0 };
    }

    // ========================================================================
    // On-Demand Description Loading
    // ========================================================================

    /**
     * Get full tool description (on-demand)
     * Called by describe_tool agent tool
     */
    async getToolDescription(toolName: string): Promise<ToolDescription | null> {
        await this.initialize();

        // Check cache
        if (this.toolCache.has(toolName)) {
            return this.toolCache.get(toolName) ?? null;
        }

        // Find category
        let category: string | null = null;
        for (const [cat, tools] of Object.entries(this.toolIndex?.categories ?? {})) {
            if (tools.includes(toolName)) {
                category = cat;
                break;
            }
        }

        if (!category) {
            return null;
        }

        // Load from file or defaults
        let tool: ToolDescription | null = null;

        if (this.config.useFileStorage) {
            const filePath = path.join(this.config.toolsDir, category, `${toolName}.md`);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                tool = this.parseToolMarkdown(content, toolName, category);
            } catch {
                // Fall back to defaults
                tool = DEFAULT_TOOL_DESCRIPTIONS.find(t => t.name === toolName) ?? null;
            }
        } else {
            tool = DEFAULT_TOOL_DESCRIPTIONS.find(t => t.name === toolName) ?? null;
        }

        // Cache it
        if (tool) {
            this.toolCache.set(toolName, tool);
        }

        return tool;
    }

    /**
     * Parse tool markdown back to ToolDescription
     */
    private parseToolMarkdown(content: string, name: string, category: string): ToolDescription {
        // Extract description (first paragraph after heading)
        const descMatch = content.match(/^#\s+\w+\s*\n\n(.+?)(?=\n\n|$)/m);
        const description = descMatch?.[1] ?? '';

        // Extract parameters
        const parameters: ParameterDoc[] = [];
        const paramSection = content.match(/## Parameters\n\n([\s\S]*?)(?=\n## |$)/);

        if (paramSection && paramSection[1].trim() !== 'None') {
            const paramRegex = /- \*\*(\w+)\*\* \((\w+(?:\[\])?)\) \((\w+)(?:, default: ([^)]+))?\)\n\s+(.+)/g;
            let match;
            while ((match = paramRegex.exec(paramSection[1])) !== null) {
                parameters.push({
                    name: match[1],
                    type: match[2],
                    required: match[3] === 'required',
                    default: match[4] ? JSON.parse(match[4]) : undefined,
                    description: match[5]
                });
            }
        }

        // Extract example
        const exampleMatch = content.match(/## Example\n\n```typescript\n([\s\S]*?)```/);
        const example = exampleMatch?.[1]?.trim();

        return {
            name,
            category: category as ToolCategory,
            description,
            parameters,
            example
        };
    }

    /**
     * Format tool description for agent output
     */
    formatToolDescriptionForAgent(tool: ToolDescription): string {
        let output = `## ${tool.name}\n\n`;
        output += `${tool.description}\n\n`;
        output += `**Category**: ${tool.category}\n\n`;
        output += `**Parameters**:\n`;

        if (tool.parameters.length === 0) {
            output += 'None\n';
        } else {
            for (const param of tool.parameters) {
                const req = param.required ? '(required)' : `(optional${param.default !== undefined ? `, default: ${JSON.stringify(param.default)}` : ''})`;
                output += `- ${param.name} (${param.type}) ${req}: ${param.description}\n`;
            }
        }

        if (tool.example) {
            output += `\n**Example**:\n\`\`\`\n${tool.example}\n\`\`\`\n`;
        }

        return output;
    }

    // ========================================================================
    // Tool Management
    // ========================================================================

    /**
     * Add or update a tool description
     */
    async addTool(tool: ToolDescription): Promise<void> {
        await this.initialize();

        if (this.config.useFileStorage) {
            // Ensure category directory exists
            const categoryDir = path.join(this.config.toolsDir, tool.category);
            await fs.mkdir(categoryDir, { recursive: true });

            // Write tool file
            const content = this.formatToolAsMarkdown(tool);
            await fs.writeFile(
                path.join(categoryDir, `${tool.name}.md`),
                content,
                'utf-8'
            );

            // Update indices
            await this.rebuildIndex();
        }

        // Update cache
        this.toolCache.set(tool.name, tool);
    }

    /**
     * Remove a tool description
     */
    async removeTool(toolName: string): Promise<boolean> {
        await this.initialize();

        // Find category
        let category: string | null = null;
        for (const [cat, tools] of Object.entries(this.toolIndex?.categories ?? {})) {
            if (tools.includes(toolName)) {
                category = cat;
                break;
            }
        }

        if (!category) return false;

        if (this.config.useFileStorage) {
            const filePath = path.join(this.config.toolsDir, category, `${toolName}.md`);
            try {
                await fs.unlink(filePath);
                await this.rebuildIndex();
            } catch {
                return false;
            }
        }

        this.toolCache.delete(toolName);
        return true;
    }

    /**
     * Rebuild the tool index from files
     */
    private async rebuildIndex(): Promise<void> {
        const categories: Record<string, string[]> = {};
        let totalCount = 0;

        const entries = await fs.readdir(this.config.toolsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const categoryDir = path.join(this.config.toolsDir, entry.name);
            const files = await fs.readdir(categoryDir);

            const tools = files
                .filter(f => f.endsWith('.md') && !f.startsWith('_'))
                .map(f => f.replace('.md', ''));

            if (tools.length > 0) {
                categories[entry.name] = tools;
                totalCount += tools.length;
            }
        }

        this.toolIndex = {
            categories,
            totalCount,
            lastUpdated: Date.now()
        };

        await fs.writeFile(
            path.join(this.config.toolsDir, '_index.json'),
            JSON.stringify(this.toolIndex, null, 2),
            'utf-8'
        );
    }

    /**
     * List all tool names
     */
    async listTools(): Promise<string[]> {
        await this.initialize();
        const tools: string[] = [];

        for (const categoryTools of Object.values(this.toolIndex?.categories ?? {})) {
            tools.push(...categoryTools);
        }

        return tools;
    }

    /**
     * List tools by category
     */
    async listToolsByCategory(category: string): Promise<string[]> {
        await this.initialize();
        return this.toolIndex?.categories[category] ?? [];
    }

    /**
     * Check if tool exists
     */
    async hasTool(toolName: string): Promise<boolean> {
        await this.initialize();

        for (const tools of Object.values(this.toolIndex?.categories ?? {})) {
            if (tools.includes(toolName)) return true;
        }

        return false;
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

let globalToolDescriptionManager: ToolDescriptionManager | null = null;

/**
 * Get the global ToolDescriptionManager instance
 */
export function getToolDescriptionManager(): ToolDescriptionManager {
    if (!globalToolDescriptionManager) {
        globalToolDescriptionManager = new ToolDescriptionManager();
    }
    return globalToolDescriptionManager;
}

/**
 * Create a new ToolDescriptionManager
 */
export function createToolDescriptionManager(
    config?: Partial<ToolDescriptionManagerConfig>
): ToolDescriptionManager {
    return new ToolDescriptionManager(config);
}

/**
 * Set the global ToolDescriptionManager instance
 */
export function setGlobalToolDescriptionManager(manager: ToolDescriptionManager): void {
    globalToolDescriptionManager = manager;
}
