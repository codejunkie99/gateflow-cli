/**
 * MCP (Model Context Protocol) Types
 *
 * Implements Cursor's strategy for MCP tool management:
 * - Sync tool descriptions to folder
 * - Track server status (available, needs_auth, etc.)
 * - Enable grep-based tool discovery
 */

// ============================================================================
// MCP Server Status
// ============================================================================

/**
 * Status of an MCP server connection
 */
export type MCPServerStatus =
    | 'available'      // Server connected and tools available
    | 'needs_auth'     // Server requires re-authentication
    | 'disconnected'   // Server not connected
    | 'error'          // Server in error state
    | 'connecting';    // Server connecting

/**
 * MCP Server information
 */
export interface MCPServerInfo {
    /** Server name/identifier */
    name: string;

    /** Human-readable description */
    description?: string;

    /** Current connection status */
    status: MCPServerStatus;

    /** Error message if status is 'error' */
    error?: string;

    /** URL or connection string */
    uri?: string;

    /** Number of tools provided */
    toolCount: number;

    /** Last successful sync timestamp */
    lastSync?: number;

    /** Authentication info (if applicable) */
    auth?: {
        type: 'oauth' | 'api_key' | 'none';
        required: boolean;
        configured: boolean;
    };
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

/**
 * MCP Tool definition as stored in .tool.json files
 */
export interface MCPToolDefinition {
    /** Tool name */
    name: string;

    /** Tool description */
    description: string;

    /** Server that provides this tool */
    server: string;

    /** Current availability status */
    status: MCPServerStatus;

    /** JSON Schema for input parameters */
    inputSchema: Record<string, unknown>;

    /** JSON Schema for output (if available) */
    outputSchema?: Record<string, unknown>;

    /** When tool was last synced */
    lastSynced: string;

    /** Version or revision */
    version?: string;

    /** Example usage */
    examples?: Array<{
        description: string;
        input: Record<string, unknown>;
    }>;

    /** Rate limiting info */
    rateLimit?: {
        requests: number;
        period: string;
    };

    /** Tags for categorization */
    tags?: string[];
}

/**
 * Reference to a synced MCP tool file
 */
export interface MCPToolFileRef {
    /** Absolute path to the .tool.json file */
    filePath: string;

    /** The tool definition */
    tool: MCPToolDefinition;

    /** Server info */
    server: MCPServerInfo;
}

// ============================================================================
// MCP Sync Configuration
// ============================================================================

/**
 * Configuration for MCP tool syncing
 */
export interface MCPSyncConfig {
    /** Whether MCP sync is enabled */
    enabled: boolean;

    /** Directory to sync tool definitions */
    syncDir: string;

    /** How often to refresh tool definitions (ms) */
    refreshInterval: number;

    /** Whether to sync on startup */
    syncOnStartup: boolean;

    /** Maximum tools to sync per server */
    maxToolsPerServer: number;

    /** Whether to include input schemas in sync files */
    includeSchemas: boolean;
}

/**
 * Default MCP sync configuration
 */
export const DEFAULT_MCP_SYNC_CONFIG: MCPSyncConfig = {
    enabled: true,
    syncDir: '.gateflow/mcp-tools',
    refreshInterval: 5 * 60 * 1000,  // 5 minutes
    syncOnStartup: true,
    maxToolsPerServer: 100,
    includeSchemas: true
};

// ============================================================================
// MCP Events
// ============================================================================

/**
 * Events emitted by MCP sync
 */
export type MCPSyncEvent =
    | { type: 'mcp_server_connected'; server: string; toolCount: number }
    | { type: 'mcp_server_disconnected'; server: string; reason?: string }
    | { type: 'mcp_server_auth_required'; server: string; authType: string }
    | { type: 'mcp_tools_synced'; server: string; count: number; dir: string }
    | { type: 'mcp_sync_error'; server: string; error: string }
    | { type: 'mcp_tool_status_changed'; tool: string; server: string; oldStatus: MCPServerStatus; newStatus: MCPServerStatus };

// ============================================================================
// MCP Tool Summary
// ============================================================================

/**
 * Summary of MCP tools for system prompt
 */
export interface MCPToolSummary {
    /** Total number of MCP servers configured */
    serverCount: number;

    /** Number of servers currently available */
    availableServers: number;

    /** Servers needing re-authentication */
    serversNeedingAuth: string[];

    /** Total tools available */
    totalTools: number;

    /** Tools grouped by server */
    toolsByServer: Record<string, string[]>;

    /** Path to tools directory for grep access */
    toolsDir: string;
}
