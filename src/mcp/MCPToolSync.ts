/**
 * MCP Tool Sync
 *
 * Implements Cursor's strategy for MCP tool management:
 * - Sync tool descriptions to folder (.gateflow/mcp-tools/{server}/)
 * - Track server status (available, needs_auth, disconnected)
 * - Enable grep-based tool discovery
 * - Communicate auth status to agent
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
    MCPServerInfo,
    MCPServerStatus,
    MCPToolDefinition,
    MCPToolFileRef,
    MCPSyncConfig,
    MCPSyncEvent,
    MCPToolSummary
} from './types.js';
import { DEFAULT_MCP_SYNC_CONFIG } from './types.js';

// ============================================================================
// MCP Tool Sync
// ============================================================================

export class MCPToolSync {
    private config: MCPSyncConfig;
    private projectRoot: string;
    private servers: Map<string, MCPServerInfo> = new Map();
    private tools: Map<string, MCPToolFileRef[]> = new Map();
    private eventHandler?: (event: MCPSyncEvent) => void;
    private initialized: boolean = false;

    constructor(projectRoot: string, config?: Partial<MCPSyncConfig>) {
        this.projectRoot = projectRoot;
        this.config = { ...DEFAULT_MCP_SYNC_CONFIG, ...config };
    }

    /**
     * Set event handler for MCP events
     */
    onEvent(handler: (event: MCPSyncEvent) => void): void {
        this.eventHandler = handler;
    }

    private emit(event: MCPSyncEvent): void {
        this.eventHandler?.(event);
    }

    /**
     * Get the MCP tools directory
     */
    getToolsDir(): string {
        return path.join(this.projectRoot, this.config.syncDir);
    }

    /**
     * Get the directory for a specific server's tools
     */
    getServerToolsDir(serverName: string): string {
        return path.join(this.getToolsDir(), serverName);
    }

    /**
     * Initialize the sync directory structure
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        await fs.mkdir(this.getToolsDir(), { recursive: true });
        this.initialized = true;

        // Load existing tool files
        await this.loadExistingTools();
    }

    /**
     * Load existing tool files from disk
     */
    private async loadExistingTools(): Promise<void> {
        const toolsDir = this.getToolsDir();

        try {
            const entries = await fs.readdir(toolsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const serverName = entry.name;
                    const serverDir = path.join(toolsDir, serverName);
                    await this.loadServerTools(serverName, serverDir);
                }
            }
        } catch {
            // Directory may not exist yet
        }
    }

    /**
     * Load tools for a specific server
     */
    private async loadServerTools(serverName: string, serverDir: string): Promise<void> {
        const toolRefs: MCPToolFileRef[] = [];

        try {
            const files = await fs.readdir(serverDir);

            // Load server info
            const infoPath = path.join(serverDir, '_server.json');
            let serverInfo: MCPServerInfo;

            try {
                const infoContent = await fs.readFile(infoPath, 'utf-8');
                serverInfo = JSON.parse(infoContent);
            } catch {
                serverInfo = {
                    name: serverName,
                    status: 'disconnected',
                    toolCount: 0
                };
            }

            this.servers.set(serverName, serverInfo);

            // Load tool files
            for (const file of files) {
                if (file.endsWith('.tool.json')) {
                    const toolPath = path.join(serverDir, file);
                    try {
                        const content = await fs.readFile(toolPath, 'utf-8');
                        const tool: MCPToolDefinition = JSON.parse(content);
                        toolRefs.push({
                            filePath: toolPath,
                            tool,
                            server: serverInfo
                        });
                    } catch {
                        // Skip invalid tool files
                    }
                }
            }

            this.tools.set(serverName, toolRefs);
        } catch {
            // Server directory doesn't exist
        }
    }

    /**
     * Register an MCP server
     */
    async registerServer(info: MCPServerInfo): Promise<void> {
        await this.initialize();

        const oldInfo = this.servers.get(info.name);
        this.servers.set(info.name, info);

        // Create server directory
        const serverDir = this.getServerToolsDir(info.name);
        await fs.mkdir(serverDir, { recursive: true });

        // Write server info file
        const infoPath = path.join(serverDir, '_server.json');
        await fs.writeFile(infoPath, JSON.stringify(info, null, 2), 'utf-8');

        // Emit status change event
        if (oldInfo && oldInfo.status !== info.status) {
            if (info.status === 'needs_auth') {
                this.emit({
                    type: 'mcp_server_auth_required',
                    server: info.name,
                    authType: info.auth?.type ?? 'unknown'
                });
            }
        }

        if (info.status === 'available') {
            this.emit({
                type: 'mcp_server_connected',
                server: info.name,
                toolCount: info.toolCount
            });
        } else if (info.status === 'disconnected') {
            this.emit({
                type: 'mcp_server_disconnected',
                server: info.name
            });
        }
    }

    /**
     * Update server status
     */
    async updateServerStatus(serverName: string, status: MCPServerStatus, error?: string): Promise<void> {
        const info = this.servers.get(serverName);
        if (!info) return;

        const oldStatus = info.status;
        info.status = status;
        if (error) info.error = error;

        await this.registerServer(info);

        // Update all tool files for this server
        const toolRefs = this.tools.get(serverName) ?? [];
        for (const ref of toolRefs) {
            ref.tool.status = status;
            await this.writeToolFile(ref.tool);

            this.emit({
                type: 'mcp_tool_status_changed',
                tool: ref.tool.name,
                server: serverName,
                oldStatus,
                newStatus: status
            });
        }
    }

    /**
     * Sync tools from an MCP server
     */
    async syncTools(serverName: string, tools: Omit<MCPToolDefinition, 'server' | 'status' | 'lastSynced'>[]): Promise<void> {
        await this.initialize();

        const serverInfo = this.servers.get(serverName);
        if (!serverInfo) {
            this.emit({
                type: 'mcp_sync_error',
                server: serverName,
                error: `Server not registered: ${serverName}`
            });
            return;
        }

        const serverDir = this.getServerToolsDir(serverName);
        await fs.mkdir(serverDir, { recursive: true });

        const toolRefs: MCPToolFileRef[] = [];
        const now = new Date().toISOString();

        // Limit tools per server
        const toolsToSync = tools.slice(0, this.config.maxToolsPerServer);

        for (const toolInput of toolsToSync) {
            const tool: MCPToolDefinition = {
                ...toolInput,
                server: serverName,
                status: serverInfo.status,
                lastSynced: now
            };

            // Optionally strip schemas to reduce file size
            if (!this.config.includeSchemas) {
                tool.inputSchema = { note: 'Schema omitted. See MCP server documentation.' };
                delete tool.outputSchema;
            }

            const filePath = await this.writeToolFile(tool);

            toolRefs.push({
                filePath,
                tool,
                server: serverInfo
            });
        }

        // Update server info
        serverInfo.toolCount = toolRefs.length;
        serverInfo.lastSync = Date.now();
        await this.registerServer(serverInfo);

        this.tools.set(serverName, toolRefs);

        this.emit({
            type: 'mcp_tools_synced',
            server: serverName,
            count: toolRefs.length,
            dir: serverDir
        });
    }

    /**
     * Write a tool definition to a file
     */
    private async writeToolFile(tool: MCPToolDefinition): Promise<string> {
        const serverDir = this.getServerToolsDir(tool.server);
        const fileName = `${tool.name}.tool.json`;
        const filePath = path.join(serverDir, fileName);

        await fs.writeFile(filePath, JSON.stringify(tool, null, 2), 'utf-8');

        return filePath;
    }

    /**
     * Get tool by name
     */
    getTool(serverName: string, toolName: string): MCPToolDefinition | undefined {
        const toolRefs = this.tools.get(serverName);
        if (!toolRefs) return undefined;

        const ref = toolRefs.find(r => r.tool.name === toolName);
        return ref?.tool;
    }

    /**
     * Get all tools for a server
     */
    getServerTools(serverName: string): MCPToolDefinition[] {
        const toolRefs = this.tools.get(serverName) ?? [];
        return toolRefs.map(r => r.tool);
    }

    /**
     * Get all servers
     */
    getAllServers(): MCPServerInfo[] {
        return Array.from(this.servers.values());
    }

    /**
     * Get servers needing authentication
     */
    getServersNeedingAuth(): MCPServerInfo[] {
        return Array.from(this.servers.values())
            .filter(s => s.status === 'needs_auth');
    }

    /**
     * Get summary for system prompt
     */
    getSummary(): MCPToolSummary {
        const servers = Array.from(this.servers.values());
        const toolsByServer: Record<string, string[]> = {};

        let totalTools = 0;

        for (const [serverName, toolRefs] of this.tools) {
            const toolNames = toolRefs.map(r => r.tool.name);
            toolsByServer[serverName] = toolNames;
            totalTools += toolNames.length;
        }

        return {
            serverCount: servers.length,
            availableServers: servers.filter(s => s.status === 'available').length,
            serversNeedingAuth: servers.filter(s => s.status === 'needs_auth').map(s => s.name),
            totalTools,
            toolsByServer,
            toolsDir: this.getToolsDir()
        };
    }

    /**
     * Format summary for agent
     */
    formatSummaryForAgent(): string {
        const summary = this.getSummary();

        if (summary.serverCount === 0) {
            return 'No MCP servers configured.';
        }

        let result = `## MCP Tools\n\n`;
        result += `**Servers:** ${summary.availableServers}/${summary.serverCount} available\n`;
        result += `**Total Tools:** ${summary.totalTools}\n`;
        result += `**Tools Directory:** ${summary.toolsDir}\n\n`;

        if (summary.serversNeedingAuth.length > 0) {
            result += `**Needs Re-authentication:** ${summary.serversNeedingAuth.join(', ')}\n`;
            result += `_Tell the user to re-authenticate these servers._\n\n`;
        }

        result += `**Tools by Server:**\n`;
        for (const [server, tools] of Object.entries(summary.toolsByServer)) {
            const serverInfo = this.servers.get(server);
            const statusIcon = serverInfo?.status === 'available' ? '' :
                serverInfo?.status === 'needs_auth' ? ' [AUTH REQUIRED]' : ' [OFFLINE]';
            result += `- ${server}${statusIcon}: ${tools.join(', ')}\n`;
        }

        result += `\nUse grep ${summary.toolsDir} to search tool definitions.`;

        return result;
    }

    /**
     * Get minimal tool list for system prompt
     */
    getMinimalToolList(): string {
        const summary = this.getSummary();

        if (summary.totalTools === 0) {
            return '';
        }

        let result = 'MCP Tools: ';
        const allTools: string[] = [];

        for (const tools of Object.values(summary.toolsByServer)) {
            allTools.push(...tools);
        }

        result += allTools.join(', ');

        if (summary.serversNeedingAuth.length > 0) {
            result += `\n[Warning: ${summary.serversNeedingAuth.join(', ')} need re-authentication]`;
        }

        return result;
    }

    /**
     * Check if a specific tool is available
     */
    isToolAvailable(serverName: string, toolName: string): { available: boolean; reason?: string } {
        const server = this.servers.get(serverName);
        if (!server) {
            return { available: false, reason: 'Server not found' };
        }

        if (server.status === 'needs_auth') {
            return { available: false, reason: 'Server requires re-authentication' };
        }

        if (server.status !== 'available') {
            return { available: false, reason: `Server status: ${server.status}` };
        }

        const tool = this.getTool(serverName, toolName);
        if (!tool) {
            return { available: false, reason: 'Tool not found' };
        }

        return { available: true };
    }

    /**
     * Clean up old sync files
     */
    async cleanup(): Promise<void> {
        // Remove server directories for servers no longer registered
        const toolsDir = this.getToolsDir();

        try {
            const entries = await fs.readdir(toolsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory() && !this.servers.has(entry.name)) {
                    const serverDir = path.join(toolsDir, entry.name);
                    await fs.rm(serverDir, { recursive: true });
                }
            }
        } catch {
            // Directory may not exist
        }
    }
}

// ============================================================================
// Singleton
// ============================================================================

let syncInstance: MCPToolSync | null = null;

/**
 * Get the global MCPToolSync instance
 */
export function getMCPToolSync(projectRoot?: string, config?: Partial<MCPSyncConfig>): MCPToolSync {
    if (!syncInstance && projectRoot) {
        syncInstance = new MCPToolSync(projectRoot, config);
    }
    if (!syncInstance) {
        throw new Error('MCPToolSync not initialized. Call with projectRoot first.');
    }
    return syncInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetMCPToolSync(): void {
    syncInstance = null;
}
