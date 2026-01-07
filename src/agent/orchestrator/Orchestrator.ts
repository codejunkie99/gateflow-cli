/**
 * Orchestrator
 * Coordinates multiple specialized agents using AI SDK 6 patterns
 * Uses generateObject for intelligent routing to worker agents
 */

import { generateObject, streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { EventBus } from '../../events/index.js';
import type { GateFlowAgent, ExecutionPlan, Task, AgentRouting, ComplexityDetection } from '../../types/agent-shared.js';
import { AgentRoutingSchema, ComplexityDetectionSchema } from '../../types/agent-shared.js';
import { createPlan } from '../workers/PlanningAgent.js';
import { ThinkingChain } from '../reasoning/ThinkingChain.js';

export class Orchestrator {
    private workers: Map<string, GateFlowAgent> = new Map();
    private thinkingChain: ThinkingChain;

    constructor(
        private bus: EventBus,
        private projectRoot: string
    ) {
        this.thinkingChain = new ThinkingChain(bus, { showByDefault: true });
    }

    /**
     * Register a worker agent
     */
    registerWorker(name: string, agent: GateFlowAgent): void {
        this.workers.set(name, agent);
    }

    /**
     * Execute a simple request with single agent routing
     */
    async execute(userRequest: string): Promise<string> {
        this.thinkingChain.addCoordinationStep(
            'Routing request to appropriate agent',
            { request: userRequest },
            0.9
        );

        // Step 1: AI-powered routing using generateObject
        // FIX A: Remove 'planning' from prompt - planning is handled by executeWithPlan(), not as a worker
        const { object: routing } = await generateObject({
            model: anthropic('claude-sonnet-4-20250514') as any,
            schema: AgentRoutingSchema,
            prompt: `Route this request to the best agent:

Request: "${userRequest}"

Available agents:
- understanding: For reading/analyzing existing code
- codegen: For creating new SystemVerilog modules
- testbench: For generating testbenches
- debug: For diagnosing simulation failures
- refactoring: For modifying existing code

Select the most appropriate agent and describe the task.`
        });

        this.thinkingChain.addCoordinationStep(
            `Selected agent: ${routing.selectedAgent}`,
            { routing },
            0.95
        );

        // Step 2: Execute with selected worker
        const worker = this.workers.get(routing.selectedAgent);
        if (!worker) {
            throw new Error(`Unknown agent: ${routing.selectedAgent}`);
        }

        this.bus.emit({
            type: 'agent_start',
            agentName: routing.selectedAgent,
            task: routing.taskDescription
        });

        const startTime = Date.now();

        try {
            const result = await streamText({
                model: anthropic('claude-sonnet-4-20250514') as any,
                system: worker.system,
                prompt: routing.taskDescription,
                tools: worker.tools,
                stopWhen: stepCountIs(worker.maxSteps || 10),
                onStepFinish: (step) => {
                    this.thinkingChain.onStepFinish(step);
                }
            });

            let output = '';
            for await (const part of result.fullStream) {
                switch (part.type) {
                    case 'text-delta':
                        output += part.text;
                        this.bus.emit({
                            type: 'token',
                            text: part.text
                        });
                        break;
                    
                    case 'tool-call':
                        // AI SDK 6: Emit tool call as it's being made
                        this.bus.emit({
                            type: 'tool_call',
                            tool: part.toolName,
                            argsSummary: this.summarizeToolArgs(part.input),
                            args: part.input as Record<string, unknown>
                        });
                        break;
                    
                    case 'tool-result':
                        // AI SDK 6: Emit tool result when received (uses 'output' not 'result')
                        const hasError = part.output && typeof part.output === 'object' && 
                                        part.output !== null && 'error' in part.output;
                        this.bus.emit({
                            type: 'tool_result',
                            tool: part.toolName,
                            ok: !hasError,
                            summary: this.summarizeToolResult(part.output)
                        });
                        break;
                }
            }

            const finalText = await result.text;
            const duration = Date.now() - startTime;

            this.bus.emit({
                type: 'agent_complete',
                agentName: routing.selectedAgent,
                success: true,
                result: finalText,
                durationMs: duration
            });

            return finalText || output;
        } catch (error) {
            const duration = Date.now() - startTime;

            // Mark thinking chain step as failed
            this.thinkingChain.addAnalysisStep(
                `Agent ${routing.selectedAgent} failed: ${error instanceof Error ? error.message : String(error)}`,
                { error: error instanceof Error ? error.message : String(error) },
                0
            );

            this.bus.emit({
                type: 'agent_complete',
                agentName: routing.selectedAgent,
                success: false,
                durationMs: duration
            });
            throw error;
        }
    }

    /**
     * Execute complex request with multi-agent coordination
     */
    async executeWithPlan(userRequest: string): Promise<string> {
        this.thinkingChain.addPlanningStep(
            'Creating execution plan for complex request',
            { request: userRequest },
            0.9
        );

        // Step 1: Create plan using PlanningAgent
        const projectContext = await this.getProjectContext();
        const plan = await createPlan(userRequest, projectContext);

        this.thinkingChain.addDecompositionStep(
            `Created plan with ${plan.tasks.length} tasks`,
            { plan },
            0.9
        );

        // Step 2: Sort tasks by dependencies
        const sortedTasks = this.sortByDependencies(plan.tasks);

        // Step 3: Execute tasks in dependency order
        const results: string[] = [];
        for (const task of sortedTasks) {
            const worker = this.workers.get(task.agent);
            if (!worker) {
                this.thinkingChain.addFixingStep(
                    `Unknown agent ${task.agent} for task ${task.id}, skipping`,
                    { task },
                    0.5
                );
                continue;
            }

            this.bus.emit({
                type: 'agent_start',
                agentName: task.agent,
                task: task.description
            });

            const startTime = Date.now();

            try {
                const result = await this.executeTask(worker, task);
                results.push(result);

                const duration = Date.now() - startTime;
                this.bus.emit({
                    type: 'agent_complete',
                    agentName: task.agent,
                    success: true,
                    result,
                    durationMs: duration
                });
            } catch (error) {
                const duration = Date.now() - startTime;
                this.bus.emit({
                    type: 'agent_complete',
                    agentName: task.agent,
                    success: false,
                    durationMs: duration
                });
                this.thinkingChain.addFixingStep(
                    `Task ${task.id} failed: ${error}`,
                    { task, error },
                    0.3
                );
                // Continue with remaining tasks
            }
        }

        return results.join('\n\n');
    }

    /**
     * Execute a single task with a worker agent
     */
    private async executeTask(worker: GateFlowAgent, task: Task): Promise<string> {
        const result = await streamText({
            model: anthropic('claude-sonnet-4-20250514') as any,
            system: worker.system,
            prompt: task.description,
            tools: worker.tools,
            stopWhen: stepCountIs(worker.maxSteps || 10),
            onStepFinish: (step) => {
                this.thinkingChain.onStepFinish(step);
            }
        });

        let output = '';
        for await (const part of result.fullStream) {
            switch (part.type) {
                case 'text-delta':
                    output += part.text;
                    this.bus.emit({
                        type: 'token',
                        text: part.text
                    });
                    break;
                
                case 'tool-call':
                    this.bus.emit({
                        type: 'tool_call',
                        tool: part.toolName,
                        argsSummary: this.summarizeToolArgs(part.input),
                        args: part.input as Record<string, unknown>
                    });
                    break;
                
                case 'tool-result':
                    const taskHasError = part.output && typeof part.output === 'object' && 
                                    part.output !== null && 'error' in part.output;
                    this.bus.emit({
                        type: 'tool_result',
                        tool: part.toolName,
                        ok: !taskHasError,
                        summary: this.summarizeToolResult(part.output)
                    });
                    break;
            }
        }

        const finalText = await result.text;
        return finalText || output;
    }

    /**
     * Sort tasks by dependencies (topological sort)
     */
    private sortByDependencies(tasks: Task[]): Task[] {
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const sorted: Task[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (taskId: string) => {
            if (visiting.has(taskId)) {
                throw new Error(`Circular dependency detected involving task ${taskId}`);
            }
            if (visited.has(taskId)) {
                return;
            }

            visiting.add(taskId);
            const task = taskMap.get(taskId);
            if (task) {
                for (const depId of task.dependencies) {
                    visit(depId);
                }
                sorted.push(task);
            }
            visiting.delete(taskId);
            visited.add(taskId);
        };

        for (const task of tasks) {
            if (!visited.has(task.id)) {
                visit(task.id);
            }
        }

        return sorted;
    }

    /**
     * Get project context for planning
     */
    private async getProjectContext(): Promise<string> {
        // TODO: Implement project context gathering
        // For now, return basic info
        return `Project root: ${this.projectRoot}`;
    }

    /**
     * Summarize tool arguments for display
     */
    private summarizeToolArgs(args: unknown): string {
        if (!args || typeof args !== 'object') return '';
        const obj = args as Record<string, unknown>;
        
        // Prioritize showing path for file operations
        if (obj.path) return String(obj.path);
        if (obj.name) return String(obj.name);
        if (obj.pattern) return String(obj.pattern);
        if (obj.directory) return String(obj.directory);
        
        // Fallback: show first few keys
        return Object.keys(obj).slice(0, 2).join(', ');
    }

    /**
     * Summarize tool result for display
     */
    private summarizeToolResult(result: unknown): string {
        if (!result || typeof result !== 'object') return String(result ?? 'Done');
        const obj = result as Record<string, unknown>;
        
        // Handle common result patterns
        if (obj.error) return `Error: ${obj.error}`;
        if (obj.success === false) return obj.message ? String(obj.message) : 'Failed';
        if (obj.content) return `${String(obj.content).length} chars`;
        if (obj.files && Array.isArray(obj.files)) return `${obj.files.length} files`;
        if (obj.count !== undefined) return `${obj.count} items`;
        if (obj.lines !== undefined) return `${obj.lines} lines`;
        
        return 'Done';
    }
}

