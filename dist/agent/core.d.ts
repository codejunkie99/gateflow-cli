/**
 * GateFlow Agent Core
 * Main agent orchestration using Vercel AI SDK
 */
import { type ModelMessage } from 'ai';
import type { EventBus } from '../events/index.js';
import type { ToolContext } from './tools.js';
import { type PromptMode, type DetectModeContext } from './prompts.js';
import { ThinkingChain } from './reasoning/ThinkingChain.js';
export interface AgentConfig {
    model: string;
    maxTokens: number;
    temperature: number;
    maxToolCalls: number;
    systemPrompt: string;
}
export interface AgentSession {
    messages: ModelMessage[];
    turnCount: number;
    toolCallCount: number;
    startTime: number;
    currentMode: PromptMode;
    hasErrors: boolean;
    thinkingChain: ThinkingChain;
}
export interface RunOptions {
    onToolCall?: (name: string, args: unknown) => void;
    onToolResult?: (name: string, result: unknown) => void;
    signal?: AbortSignal;
    /** Override the auto-detected mode */
    mode?: PromptMode;
    /** Context for mode detection */
    modeContext?: DetectModeContext;
}
export declare class GateFlowAgent {
    private bus;
    private config;
    private session;
    private toolContext;
    private tools;
    private executors;
    private orchestrator;
    constructor(bus: EventBus, toolContext: ToolContext, config?: Partial<AgentConfig>);
    /**
     * Initialize orchestrator with all specialized agents
     */
    private initializeOrchestrator;
    private buildTools;
    /**
     * Run the agent with a user message
     */
    run(userMessage: string, options?: RunOptions): Promise<string>;
    private summarizeArgs;
    private summarizeResult;
    private createSession;
    /**
     * Reset the session (clear history)
     */
    resetSession(): void;
    /**
     * Get current session stats
     */
    getSessionStats(): {
        turnCount: number;
        toolCallCount: number;
        messageCount: number;
        durationMs: number;
    };
    /**
     * Add context to the session
     */
    addContext(content: string): void;
    /**
     * Get conversation history
     */
    getHistory(): ModelMessage[];
}
