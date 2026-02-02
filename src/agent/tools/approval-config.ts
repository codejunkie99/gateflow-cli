/**
 * Tool Approval Configuration
 * Declarative mapping for tools requiring human approval.
 */

export const TOOL_APPROVAL_CONFIG: Record<string, boolean> = {
    // Read-only tools - no approval needed
    read_file: false,
    list_files: false,
    search_code: false,
    lint_file: false,
    find_module: false,
    get_dependencies: false,
    find_all_sv_files: false,
    find_vcd_files: false,
    analyze_waveform: false,
    get_project_stats: false,

    // Dynamic context discovery - no approval (read-only)
    describe_tool: false,
    read_context_output: false,
    search_history: false,
    search_terminal: false,
    get_terminal_file_path: false,

    // Phase 2: Context Window Management - no approval (read-only)
    grep_context: false,
    jq_context: false,
    tail_context: false,
    head_context: false,
    list_context: false,
    get_file_chunk: false,
    select_chunks: false,
    search_knowledge: false,
    get_token_budget: false,

    // Continuation coordination - no approval (doesn't modify files)
    request_continuation: false,

    // Skills and MCP - read operations (no approval)
    search_skills: false,
    get_skill: false,
    check_mcp_status: false,
    get_mcp_tool: false,

    // Write/modify tools - needs approval
    write_file: true,
    edit_lines: true,
    search_replace: true,

    // Execution tools - needs approval
    run_simulation: true,
    run_skill_script: true,

    // Setup tools - needs approval
    setup_verible: true,
    setup_slang: true,
    help_setup_tools: true,
    check_tool_status: false, // Just checking status, not modifying

    // Interactive tools - no approval (they prompt user directly)
    ask_user: false,
    open_waveform: false,
};
