/**
 * MCP Tool Definitions
 * JSON Schema definitions for GateFlow tools.
 */
export interface ToolDefinition {
    description: string;
    inputSchema: Record<string, unknown>;
}
export declare function createToolDefinitions(): Record<string, ToolDefinition>;
