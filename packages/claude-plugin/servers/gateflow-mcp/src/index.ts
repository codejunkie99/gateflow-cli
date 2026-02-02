#!/usr/bin/env node
/**
 * GateFlow MCP Server
 * Exposes SystemVerilog development tools via Model Context Protocol.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { createToolDefinitions, type ToolDefinition } from './tools.js';
import { createToolExecutor } from './executor.js';

const PROJECT_ROOT = process.env.GATEFLOW_PROJECT_ROOT || process.cwd();

async function main() {
    const server = new Server(
        {
            name: 'gateflow',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Get tool definitions
    const toolDefinitions = createToolDefinitions();
    const executor = createToolExecutor(PROJECT_ROOT);

    // Handle list tools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const tools: Tool[] = Object.entries(toolDefinitions).map(
            ([name, def]: [string, ToolDefinition]) => ({
                name: `gf_${name}`,
                description: def.description,
                inputSchema: {
                    type: 'object' as const,
                    ...def.inputSchema,
                },
            })
        );
        return { tools };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const toolName = request.params.name.replace(/^gf_/, '');
        const args = request.params.arguments ?? {};

        try {
            const result = await executor.execute(toolName, args);
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string'
                            ? result
                            : JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });

    // Connect via stdio
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('GateFlow MCP server running');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
