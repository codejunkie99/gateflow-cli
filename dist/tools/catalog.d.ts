/**
 * Tool Catalog
 * Self-documenting tools with metadata for AI SDK 6 Agent interface
 */
import { z } from 'zod';
import type { ToolContext } from '../agent/tools.js';
export interface ToolDefinition {
    name: string;
    description: string;
    category: 'read' | 'write' | 'edit' | 'analyze' | 'execute';
    inputSchema: z.ZodType<any>;
    outputSchema?: z.ZodType<any>;
    preconditions?: string[];
    postconditions?: string[];
    sideEffects?: string[];
    examples?: Array<{
        input: any;
        output: any;
        description: string;
    }>;
    performanceHints?: {
        avgLatency?: number;
        batchSize?: number;
    };
}
/**
 * Create tool catalog from existing tool executors
 * Wraps tools with AI SDK 6's tool() helper
 */
export declare function createToolCatalog(context: ToolContext): Record<string, any>;
/**
 * Get tool definitions for documentation
 */
export declare function getToolDefinitions(): ToolDefinition[];
