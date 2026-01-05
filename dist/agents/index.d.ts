/**
 * CLI Agent Orchestrator
 * Main entry point for the agent system with streaming and human-in-the-loop support
 */
import { writeCodeAgent } from './writeCode.js';
import { readCodebaseAgent } from './readCodebase.js';
import { editCodeAgent } from './editCode.js';
import { lintFixAgent } from './lintFix.js';
import { testbenchAgent } from './testbench.js';
import { explainAgent } from './explain.js';
import { routerAgent } from './router.js';
export { writeCodeAgent, readCodebaseAgent, editCodeAgent, lintFixAgent, testbenchAgent, explainAgent, routerAgent };
export * from './tools.js';
/**
 * Stream event types for CLI rendering with comprehensive metadata
 */
export type AgentStreamEvent = {
    type: 'text';
    content: string;
    responseId?: string;
    timestamp?: number;
} | {
    type: 'thinking';
    content: string;
    timestamp?: number;
} | {
    type: 'tool_start';
    toolName: string;
    input?: string;
    arguments?: any;
    toolId?: string;
    responseId?: string;
    timestamp?: number;
} | {
    type: 'tool_end';
    toolName: string;
    output?: string;
    result?: any;
    toolId?: string;
    responseId?: string;
    duration?: number;
    timestamp?: number;
} | {
    type: 'agent_start';
    agentName: string;
    agentId?: string;
    handoffFrom?: string;
    timestamp?: number;
} | {
    type: 'agent_end';
    agentName: string;
    timestamp?: number;
} | {
    type: 'code_start';
    filePath: string;
    timestamp?: number;
} | {
    type: 'code_delta';
    content: string;
} | {
    type: 'code_end';
    filePath: string;
    timestamp?: number;
} | {
    type: 'tool_call_streaming';
    toolName: string;
    delta: string;
    arguments?: string;
} | {
    type: 'message_created';
    responseId?: string;
    timestamp?: number;
} | {
    type: 'response_delta';
    content: string;
    responseId?: string;
} | {
    type: 'human_input_required';
    action: string;
    details: string;
    options?: string[];
} | {
    type: 'error';
    message: string;
    timestamp?: number;
} | {
    type: 'done';
};
/**
 * Human-in-the-loop handler interface
 */
export interface HumanInTheLoopHandler {
    /**
     * Ask the user a question and wait for their response
     */
    askUser(prompt: string, options?: string[]): Promise<string>;
}
/**
 * Get the default model for agents
 *
 * NOTE: This function is now deprecated for agent initialization.
 * Agents are created without a model and updated after initialization.
 * This function is kept for backward compatibility only.
 *
 * @deprecated Agents should not use this at initialization time
 */
export declare function getDefaultModel(): string | any;
/**
 * Initialize the agent system with Anthropic API key only
 * Uses Claude Sonnet 4.5 exclusively
 *
 * Requires @openai/agents-extensions and @ai-sdk/anthropic:
 *   npm install @openai/agents-extensions @ai-sdk/anthropic
 *
 * @see https://openai.github.io/openai-agents-js/extensions/ai-sdk/
 */
export declare function initializeAgents(apiKey?: string): Promise<void>;
/**
 * Execute a natural language query with streaming and human-in-the-loop support
 *
 * Implements the OpenAI Agents SDK streaming pattern:
 * - Uses `{ stream: true }` for streaming responses
 * - Iterates over events with `for await`
 * - Handles all three event types: raw_model_stream_event, run_item_stream_event, agent_updated_stream_event
 * - Supports interruptions for human-in-the-loop approval
 * - Awaits `stream.completed` before finishing
 *
 * @see https://openai.github.io/openai-agents-js/guides/streaming/
 */
export declare function executeQuery(query: string, onEvent: (event: AgentStreamEvent) => void, humanInLoop?: HumanInTheLoopHandler): Promise<string>;
/**
 * Legacy function for backwards compatibility
 * @deprecated Use executeQuery instead
 */
export declare function executeQueryDual(query: string, onEvent: (event: AgentStreamEvent) => void, humanInLoop?: HumanInTheLoopHandler): Promise<string>;
/**
 * Execute a query and pipe the text output directly to stdout
 * Uses the SDK's built-in Node.js compatible stream for maximum compatibility
 */
export declare function executeQueryPipe(query: string): Promise<void>;
/**
 * Simple non-streaming query execution
 */
export declare function executeQuerySimple(query: string): Promise<string>;
