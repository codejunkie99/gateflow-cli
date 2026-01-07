/**
 * Dynamic Context Discovery Types
 * Shared types for the context management system
 */

// ============================================================================
// Context File Types (Phase 2)
// ============================================================================

/**
 * Reference to a context file storing tool output
 */
export interface ContextFileRef {
    /** Absolute path to the context file */
    path: string;
    /** Name of the tool that generated this output */
    toolName: string;
    /** Session ID for cleanup purposes */
    sessionId: string;
    /** File size in bytes */
    size: number;
    /** Number of lines in the file */
    lineCount: number;
    /** Timestamp when the file was created */
    timestamp: number;
}

/**
 * Options for reading portions of a context file
 */
export interface ReadOptions {
    /** Read first N lines */
    head?: number;
    /** Read last N lines */
    tail?: number;
    /** Start line for range read (1-indexed) */
    startLine?: number;
    /** End line for range read (inclusive) */
    endLine?: number;
}

/**
 * Summary of a context file for agent awareness
 */
export interface FileSummary {
    /** First 10 lines of the file */
    firstLines: string;
    /** Last 10 lines of the file */
    lastLines: string;
    /** File size in bytes */
    size: number;
    /** Total line count */
    lineCount: number;
}

// ============================================================================
// Tool Registry Types (Phase 1)
// ============================================================================

/**
 * Categories of tools for discovery
 */
export type ToolCategory =
    | 'file'           // File read/write operations
    | 'edit'           // Code editing operations
    | 'search'         // Code search and discovery
    | 'verification'   // Lint and simulation
    | 'waveform'       // VCD/FST analysis
    | 'project'        // Project-level operations
    | 'context'        // Context management (dynamic context discovery)
    | 'skills'         // Skill discovery and execution
    | 'mcp';           // MCP server tools

/**
 * Full tool description stored in registry
 */
export interface ToolDescription {
    /** Tool name (identifier) */
    name: string;
    /** Human-readable description */
    description: string;
    /** Tool category for grouping */
    category: ToolCategory;
    /** Parameter documentation */
    parameters: ParameterDoc[];
    /** Example usage */
    example?: string;
}

/**
 * Parameter documentation for a tool
 */
export interface ParameterDoc {
    /** Parameter name */
    name: string;
    /** Parameter type */
    type: string;
    /** Description */
    description: string;
    /** Whether the parameter is required */
    required: boolean;
    /** Default value if optional */
    default?: unknown;
}

/**
 * Match result when searching for tools
 */
export interface ToolMatch {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** Relevance score (0-1) */
    relevance: number;
}

// ============================================================================
// Chat History Types (Phase 3)
// ============================================================================

/**
 * Reference to an archived chat history file
 */
export interface ChatHistoryFile {
    /** Session ID */
    sessionId: string;
    /** Range of turns archived */
    turnRange: { start: number; end: number };
    /** Summary of the archived conversation */
    summary: string;
    /** Path to the archive file */
    filePath: string;
    /** Timestamp of archival */
    timestamp: number;
}

/**
 * Result from searching archived history
 */
export interface RelevantMessage {
    /** Turn number in the original conversation */
    turnNumber: number;
    /** Role (user or assistant) */
    role: 'user' | 'assistant';
    /** Message content excerpt */
    content: string;
    /** Relevance to the search query */
    relevance: number;
}

// ============================================================================
// Terminal Session Types (Phase 4)
// ============================================================================

/**
 * Terminal session for output persistence
 */
export interface TerminalSession {
    /** Session identifier */
    id: string;
    /** Path to the session file */
    filePath: string;
    /** Session start time */
    startTime: number;
    /** Current line count */
    lineCount: number;
}

/**
 * Search hit in terminal output
 */
export interface TerminalSearchHit {
    /** Line number */
    line: number;
    /** Matching content */
    content: string;
    /** Context lines before */
    before: string[];
    /** Context lines after */
    after: string[];
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the context discovery system
 */
export interface ContextConfig {
    /** Enable writing tool outputs to files */
    enableContextFiles: boolean;
    /** Enable tool description optimization */
    enableToolOptimization: boolean;
    /** Enable chat history archiving */
    enableHistoryArchiving: boolean;
    /** Directory for context files */
    contextFileDir: string;
    /** Maximum age of context files before cleanup (ms) */
    maxContextFileAge: number;
    /** Summary line count for head/tail */
    summaryLines: number;
    /** Threshold for archiving messages (message count) */
    archiveThreshold: number;
    /** Number of recent messages to keep after archiving */
    keepRecentMessages: number;
}

/**
 * Default context configuration
 */
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
    enableContextFiles: true,
    enableToolOptimization: true,
    enableHistoryArchiving: true,
    contextFileDir: '', // Set at runtime to os.tmpdir()/gateflow-context
    maxContextFileAge: 24 * 60 * 60 * 1000, // 24 hours
    summaryLines: 10,
    archiveThreshold: 10,
    keepRecentMessages: 4
};

// ============================================================================
// History File Reference (for summarization)
// ============================================================================

/**
 * Reference to archived history given to agent during summarization
 * Implements Cursor's "give the agent a reference to the history file" pattern
 */
export interface HistoryFileReference {
    /** Path to the archived history file */
    filePath: string;

    /** Session ID of the archived conversation */
    sessionId: string;

    /** Brief summary of what was archived */
    summary: string;

    /** Number of messages archived */
    messageCount: number;

    /** Turn range covered by this archive */
    turnRange: { start: number; end: number };

    /** When the archive was created */
    timestamp: number;

    /** Instructions for the agent on how to use this reference */
    agentInstructions: string;
}

/**
 * Result of triggering summarization
 */
export interface SummarizationResult {
    /** Whether summarization occurred */
    triggered: boolean;

    /** The history file reference (if summarization occurred) */
    historyRef?: HistoryFileReference;

    /** Messages to keep in active context */
    remainingMessages: Array<{ role: string; content: string }>;

    /** Summary for the agent */
    summary: string;
}
