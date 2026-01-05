/**
 * Orchestrator
 * Coordinates multiple specialized agents using AI SDK 6 patterns
 * Uses generateObject for intelligent routing to worker agents
 */
import type { EventBus } from '../../events/index.js';
import type { GateFlowAgent } from '../../types/agent-shared.js';
export declare class Orchestrator {
    private bus;
    private projectRoot;
    private workers;
    private thinkingChain;
    constructor(bus: EventBus, projectRoot: string);
    /**
     * Register a worker agent
     */
    registerWorker(name: string, agent: GateFlowAgent): void;
    /**
     * Execute a simple request with single agent routing
     */
    execute(userRequest: string): Promise<string>;
    /**
     * Execute complex request with multi-agent coordination
     */
    executeWithPlan(userRequest: string): Promise<string>;
    /**
     * Execute a single task with a worker agent
     */
    private executeTask;
    /**
     * Sort tasks by dependencies (topological sort)
     */
    private sortByDependencies;
    /**
     * Get project context for planning
     */
    private getProjectContext;
    /**
     * Summarize tool arguments for display
     */
    private summarizeToolArgs;
    /**
     * Summarize tool result for display
     */
    private summarizeToolResult;
}
