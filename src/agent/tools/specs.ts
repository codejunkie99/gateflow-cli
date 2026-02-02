/**
 * Tool Specifications
 * AI SDK tool descriptors and metadata.
 */

import { z } from 'zod';
import { TOOL_APPROVAL_CONFIG } from './approval-config.js';
import {
    readFileSchema,
    writeFileSchema,
    editLinesSchema,
    searchReplaceSchema,
    listFilesSchema,
    searchCodeSchema,
    findModuleSchema,
    getDependenciesSchema,
    lintFileSchema,
    runSimSchema,
    openWaveformSchema,
    findAllSvFilesSchema,
    analyzeWaveformSchema,
    askUserSchema,
    findVcdFilesSchema,
    describeToolSchema,
    readContextOutputSchema,
    searchHistorySchema,
    searchTerminalSchema,
    getTerminalFilePathSchema,
    searchSkillsSchema,
    getSkillSchema,
    runSkillScriptSchema,
    checkMcpStatusSchema,
    getMcpToolSchema,
    grepContextSchema,
    jqContextSchema,
    tailContextSchema,
    headContextSchema,
    listContextSchema,
    getFileChunkSchema,
    selectChunksSchema,
    searchKnowledgeSchema,
    getTokenBudgetSchema,
    requestContinuationSchema,
    checkToolStatusSchema,
    setupVeribleSchema,
    setupSlangSchema,
    helpSetupToolsSchema,
} from './schemas.js';

// ============================================================================
// Tool Specifications for AI SDK
// ============================================================================

/**
 * Tool specification with AI SDK 6 needsApproval support.
 * When needsApproval is true and autoApprove is false, tools will pause
 * for human approval before execution.
 */
export interface ToolSpec {
    description: string;
    parameters: z.ZodType<unknown>;
    needsApproval: boolean;
}

export function getToolSpecs(): Record<string, ToolSpec> {
    return {
        // File operations
        read_file: {
            description: 'Read the contents of a file. Returns the file content with line numbers.',
            parameters: readFileSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.read_file
        },
        write_file: {
            description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
            parameters: writeFileSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.write_file
        },
        edit_lines: {
            description: 'Edit specific lines in a file. Specify line ranges to replace with new content.',
            parameters: editLinesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.edit_lines
        },
        search_replace: {
            description: 'Search and replace text in a file. Can use regex patterns.',
            parameters: searchReplaceSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_replace
        },
        list_files: {
            description: 'List files in a directory. Can filter by extension and recurse.',
            parameters: listFilesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.list_files
        },
        search_code: {
            description: 'Search for a pattern across all project files. Returns matching lines with context.',
            parameters: searchCodeSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_code
        },

        // SystemVerilog analysis
        find_module: {
            description: 'Find a SystemVerilog module by name. Returns its location, ports, and parameters.',
            parameters: findModuleSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.find_module
        },
        get_dependencies: {
            description: 'Get the dependency graph for a module. Returns compilation order and any missing modules.',
            parameters: getDependenciesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_dependencies
        },
        lint_file: {
            description: 'Run Verilator lint on a SystemVerilog file. Returns errors and warnings.',
            parameters: lintFileSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.lint_file
        },
        find_all_sv_files: {
            description: 'Find all SystemVerilog (.sv) files in the project. Returns a list of all .sv file paths.',
            parameters: findAllSvFilesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.find_all_sv_files
        },
        get_project_stats: {
            description: 'Get statistics about the project: file count, modules, packages, etc.',
            parameters: z.object({}),
            needsApproval: TOOL_APPROVAL_CONFIG.get_project_stats
        },

        // Simulation and waveform
        run_simulation: {
            description: 'Compile and run a simulation with Verilator. Returns stdout, stderr, VCD path, and optional waveform analysis. Set analyzeWaveform=true to automatically parse and analyze the VCD output.',
            parameters: runSimSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.run_simulation
        },
        open_waveform: {
            description: 'Open an interactive terminal-based waveform viewer for a VCD file. Supports keyboard navigation, zoom, pan, and signal inspection. Blocks until the viewer is closed.',
            parameters: openWaveformSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.open_waveform
        },
        // IMPORTANT: analyze_waveform is here but implementation was truncated in view. Assuming it exists.

        // Context Tools
        grep_context: {
            description: 'Search through context files (tool outputs, history, logs) using regex patterns.',
            parameters: grepContextSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.grep_context
        },
        jq_context: {
            description: 'Filter JSON context files using JQ syntax. Falls back to simple parsing if JQ is missing.',
            parameters: jqContextSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.jq_context
        },
        tail_context: {
            description: 'Read the last N lines of a context file. Use to check if a process finished correctly.',
            parameters: tailContextSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.tail_context
        },
        analyze_waveform: {
            description: 'Analyze a VCD waveform file from simulation. Detects clocks, checks for X/Z anomalies, and calculates signal coverage. Returns signal list, timing info, and analysis summary.',
            parameters: analyzeWaveformSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.analyze_waveform
        },
        find_vcd_files: {
            description: 'Search for VCD waveform files in the project. ALWAYS use this tool first when user mentions a VCD file by name to find its full path before opening. Returns list of matching files with paths.',
            parameters: findVcdFilesSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.find_vcd_files
        },

        // Human-in-the-loop
        ask_user: {
            description: 'Ask the user a question and wait for their response. Use this for human-in-the-loop confirmations, like asking if they want to view waveforms after simulation. Returns the user response with isYes/isNo flags for easy checking.',
            parameters: askUserSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.ask_user
        },

        // Dynamic Context Discovery Tools
        describe_tool: {
            description: 'Get full description and parameters for a tool. Use this to understand how to use any tool.',
            parameters: describeToolSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.describe_tool
        },
        read_context_output: {
            description: 'Read a portion of tool output stored in a context file. Use head/tail for quick inspection.',
            parameters: readContextOutputSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.read_context_output
        },
        search_history: {
            description: 'Search archived conversation history for relevant context from earlier in the session.',
            parameters: searchHistorySchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_history
        },
        search_terminal: {
            description: 'Search terminal/simulation output for patterns. Find specific errors or output from commands.',
            parameters: searchTerminalSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_terminal
        },
        get_terminal_file_path: {
            description: 'Get the path to the terminal session file for direct grep access.',
            parameters: getTerminalFilePathSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_terminal_file_path
        },

        // Skills
        search_skills: {
            description: 'Search skill files for relevant capabilities based on a query.',
            parameters: searchSkillsSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.search_skills
        },
        get_skill: {
            description: 'Get full skill definition by name.',
            parameters: getSkillSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_skill
        },
        run_skill_script: {
            description: 'Execute a bundled script from a skill.',
            parameters: runSkillScriptSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.run_skill_script
        },

        // MCP integration
        check_mcp_status: {
            description: 'Check status of MCP servers and tools.',
            parameters: checkMcpStatusSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.check_mcp_status
        },
        get_mcp_tool: {
            description: 'Get full definition of an MCP tool.',
            parameters: getMcpToolSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.get_mcp_tool
        },

        // Tool Setup Tools - for installing/configuring analysis tools
        check_tool_status: {
            description: 'Check if SystemVerilog analysis tools (Verible and/or Slang) are installed and working. Use this when the user asks about tool availability, wants to know what tools are installed, or when you need to verify tools before suggesting installation. Returns installation status, version, and path for each tool.',
            parameters: checkToolStatusSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.check_tool_status
        },
        setup_verible: {
            description: 'Download and configure Verible (SystemVerilog syntax parser). Use this when the user wants to install Verible, asks to set up parsing tools, or needs help getting Verible working. Downloads prebuilt binaries from GitHub - fast and easy, no compilation required. Requires user approval for downloads.',
            parameters: setupVeribleSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.setup_verible
        },
        setup_slang: {
            description: 'Build and configure Slang (SystemVerilog semantic analyzer). Use this when the user wants to install Slang, asks to set up semantic analysis, or needs help getting Slang working. WARNING: Requires git, cmake, and a C++20 compiler. Takes several minutes to build from source. Requires user approval for build commands.',
            parameters: setupSlangSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.setup_slang
        },
        help_setup_tools: {
            description: 'Interactive helper for setting up missing analysis tools. Use this when the user asks for help setting up tools, when a tool operation fails due to missing tools, when the user asks "why isnt X working", or when they want guided setup assistance. Automatically detects which tools are missing and runs an interactive setup conversation. Preferred over individual setup_verible/setup_slang for general setup help.',
            parameters: helpSetupToolsSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.help_setup_tools
        },

        // Continuation system
        request_continuation: {
            description: 'Request continuation to a new segment when approaching the step limit but more work remains. Call this when you have completed some tasks but need more steps to finish. Provide a checkpoint of completed tasks, remaining tasks, and any context notes. The system will continue execution in a new segment with fresh step budget.',
            parameters: requestContinuationSchema,
            needsApproval: TOOL_APPROVAL_CONFIG.request_continuation
        }
    };
}
