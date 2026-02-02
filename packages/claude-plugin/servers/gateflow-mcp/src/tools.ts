/**
 * MCP Tool Definitions
 * JSON Schema definitions for GateFlow tools.
 */

export interface ToolDefinition {
    description: string;
    inputSchema: Record<string, unknown>;
}

export function createToolDefinitions(): Record<string, ToolDefinition> {
    return {
        // ========================================
        // File Operations
        // ========================================
        read_file: {
            description: 'Read contents of a file with optional line range',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to file' },
                    startLine: { type: 'number', description: 'Starting line (1-indexed)' },
                    endLine: { type: 'number', description: 'Ending line (inclusive)' },
                },
                required: ['path'],
            },
        },
        write_file: {
            description: 'Write content to a file (creates or overwrites)',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to file' },
                    content: { type: 'string', description: 'Content to write' },
                },
                required: ['path', 'content'],
            },
        },
        edit_lines: {
            description: 'Edit specific line ranges in a file',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to file' },
                    edits: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                startLine: { type: 'number' },
                                endLine: { type: 'number' },
                                newContent: { type: 'string' },
                            },
                            required: ['startLine', 'endLine', 'newContent'],
                        },
                    },
                },
                required: ['path', 'edits'],
            },
        },
        search_replace: {
            description: 'Search and replace text in a file',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to file' },
                    search: { type: 'string', description: 'Text or regex to find' },
                    replace: { type: 'string', description: 'Replacement text' },
                    all: { type: 'boolean', description: 'Replace all occurrences' },
                    isRegex: { type: 'boolean', description: 'Treat search as regex' },
                },
                required: ['path', 'search', 'replace'],
            },
        },
        list_files: {
            description: 'List files in a directory with optional filtering',
            inputSchema: {
                type: 'object',
                properties: {
                    directory: { type: 'string', description: 'Directory path' },
                    extensions: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Filter by extensions (default: [".sv"])',
                    },
                    recursive: { type: 'boolean', description: 'List recursively' },
                },
                required: ['directory'],
            },
        },
        search_code: {
            description: 'Search for pattern across project files',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Search pattern (regex)' },
                    filePattern: { type: 'string', description: 'Glob for files (default: **/*.sv)' },
                    caseSensitive: { type: 'boolean' },
                    maxResults: { type: 'number' },
                },
                required: ['pattern'],
            },
        },

        // ========================================
        // SystemVerilog Analysis
        // ========================================
        find_module: {
            description: 'Find a SystemVerilog module by name, returns location and interface',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Module name to find' },
                },
                required: ['name'],
            },
        },
        get_dependencies: {
            description: 'Get dependency graph for a module',
            inputSchema: {
                type: 'object',
                properties: {
                    module: { type: 'string', description: 'Module name' },
                },
                required: ['module'],
            },
        },
        lint_file: {
            description: 'Run Verilator lint on a SystemVerilog file',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to .sv file' },
                },
                required: ['path'],
            },
        },
        find_all_sv_files: {
            description: 'Find all SystemVerilog files in project',
            inputSchema: {
                type: 'object',
                properties: {
                    directory: { type: 'string', description: 'Starting directory' },
                },
            },
        },
        get_project_stats: {
            description: 'Get project statistics (files, modules, packages)',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },

        // ========================================
        // Simulation & Waveform
        // ========================================
        run_simulation: {
            description: 'Compile and run simulation with Verilator',
            inputSchema: {
                type: 'object',
                properties: {
                    top: { type: 'string', description: 'Top module name' },
                    testbench: { type: 'string', description: 'Testbench file path' },
                    timeout: { type: 'number', description: 'Timeout in ms' },
                    analyzeWaveform: { type: 'boolean', description: 'Analyze VCD after simulation' },
                },
                required: ['top'],
            },
        },
        analyze_waveform: {
            description: 'Analyze VCD waveform file',
            inputSchema: {
                type: 'object',
                properties: {
                    vcdPath: { type: 'string', description: 'Path to VCD file' },
                    signals: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Specific signals to analyze',
                    },
                    detectClocks: { type: 'boolean' },
                    checkAnomalies: { type: 'boolean' },
                },
                required: ['vcdPath'],
            },
        },
        find_vcd_files: {
            description: 'Search for VCD waveform files in project',
            inputSchema: {
                type: 'object',
                properties: {
                    directory: { type: 'string' },
                    pattern: { type: 'string', description: 'Filename pattern to match' },
                },
            },
        },

        // ========================================
        // Setup & Configuration
        // ========================================
        check_tool_status: {
            description: 'Check if Verilator/Verible/Slang tools are installed',
            inputSchema: {
                type: 'object',
                properties: {
                    tool: {
                        type: 'string',
                        enum: ['verilator', 'verible', 'slang', 'all'],
                        description: 'Which tool to check (default: all)',
                    },
                },
            },
        },
        setup_verible: {
            description: 'Install Verible via Homebrew (macOS)',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        setup_slang: {
            description: 'Install Slang analyzer via Homebrew (macOS)',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        setup_verilator: {
            description: 'Install Verilator via Homebrew (macOS) or apt (Linux)',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },

        // ========================================
        // Multi-Agent Orchestration
        // ========================================
        plan_complex_task: {
            description: 'Plan a complex hardware task by breaking it into subtasks for specialized agents (understanding, codegen, testbench, debug, refactor)',
            inputSchema: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'Description of the complex task to plan' },
                    context: { type: 'string', description: 'Additional context about the project' },
                },
                required: ['task'],
            },
        },
        spawn_agent: {
            description: 'Spawn a specialized agent to handle a subtask. Agents: understanding (analyze code), codegen (write RTL), testbench (create tests), debug (fix errors), refactor (improve code)',
            inputSchema: {
                type: 'object',
                properties: {
                    agent: {
                        type: 'string',
                        enum: ['understanding', 'codegen', 'testbench', 'debug', 'refactor'],
                        description: 'Which specialized agent to spawn',
                    },
                    task: { type: 'string', description: 'Specific task for this agent' },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Files relevant to this task',
                    },
                    waitForResult: { type: 'boolean', description: 'Wait for agent to complete (default: true)' },
                },
                required: ['agent', 'task'],
            },
        },
        parallel_agents: {
            description: 'Run multiple agents in parallel for independent subtasks',
            inputSchema: {
                type: 'object',
                properties: {
                    tasks: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                agent: { type: 'string', enum: ['understanding', 'codegen', 'testbench', 'debug', 'refactor'] },
                                task: { type: 'string' },
                                files: { type: 'array', items: { type: 'string' } },
                            },
                            required: ['agent', 'task'],
                        },
                        description: 'List of agent tasks to run in parallel',
                    },
                },
                required: ['tasks'],
            },
        },

        // ========================================
        // Context & Knowledge
        // ========================================
        describe_tool: {
            description: 'Get full description of a GateFlow tool',
            inputSchema: {
                type: 'object',
                properties: {
                    toolName: { type: 'string', description: 'Tool name to describe' },
                },
                required: ['toolName'],
            },
        },
        search_knowledge: {
            description: 'Search knowledge base for patterns and fixes',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    maxResults: { type: 'number' },
                },
                required: ['query'],
            },
        },
        get_file_chunk: {
            description: 'Extract semantic chunk from file (module, interface, etc)',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path' },
                    chunkType: {
                        type: 'string',
                        enum: ['module', 'interface', 'package', 'class', 'function', 'task', 'always_block'],
                    },
                },
                required: ['path', 'chunkType'],
            },
        },
    };
}
