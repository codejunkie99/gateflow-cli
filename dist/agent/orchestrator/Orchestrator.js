/**
 * Orchestrator
 * Coordinates multiple specialized agents using AI SDK 6 patterns
 * Uses generateObject for intelligent routing to worker agents
 */
import { generateObject, streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { AgentRoutingSchema } from '../../types/agent-shared.js';
import { createPlan } from '../workers/PlanningAgent.js';
import { ThinkingChain } from '../reasoning/ThinkingChain.js';
export class Orchestrator {
    bus;
    projectRoot;
    workers = new Map();
    thinkingChain;
    constructor(bus, projectRoot) {
        this.bus = bus;
        this.projectRoot = projectRoot;
        this.thinkingChain = new ThinkingChain(bus, { showByDefault: true });
    }
    /**
     * Register a worker agent
     */
    registerWorker(name, agent) {
        this.workers.set(name, agent);
    }
    /**
     * Execute a simple request with single agent routing
     */
    async execute(userRequest) {
        this.thinkingChain.addCoordinationStep('Routing request to appropriate agent', { request: userRequest }, 0.9);
        // Step 1: AI-powered routing using generateObject
        // FIX A: Remove 'planning' from prompt - planning is handled by executeWithPlan(), not as a worker
        const { object: routing } = await generateObject({
            model: anthropic('claude-sonnet-4-20250514'),
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
        this.thinkingChain.addCoordinationStep(`Selected agent: ${routing.selectedAgent}`, { routing }, 0.95);
        // Step 2: Execute with selected worker
        const worker = this.workers.get(routing.selectedAgent);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a4f00bdc-6d66-4cb0-9b9b-8714458232cc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Orchestrator.ts:execute', message: 'Agent selection', data: { selectedAgent: routing.selectedAgent, workerFound: !!worker, registeredAgents: Array.from(this.workers.keys()) }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'A' }) }).catch(() => { });
        // #endregion
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
                model: anthropic('claude-sonnet-4-20250514'),
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
                            args: part.input
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
        }
        catch (error) {
            const duration = Date.now() - startTime;
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
    async executeWithPlan(userRequest) {
        this.thinkingChain.addPlanningStep('Creating execution plan for complex request', { request: userRequest }, 0.9);
        // Step 1: Create plan using PlanningAgent
        const projectContext = await this.getProjectContext();
        const plan = await createPlan(userRequest, projectContext);
        this.thinkingChain.addDecompositionStep(`Created plan with ${plan.tasks.length} tasks`, { plan }, 0.9);
        // Step 2: Sort tasks by dependencies
        const sortedTasks = this.sortByDependencies(plan.tasks);
        // Step 3: Execute tasks in dependency order
        const results = [];
        for (const task of sortedTasks) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/a4f00bdc-6d66-4cb0-9b9b-8714458232cc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Orchestrator.ts:executeWithPlan-task', message: 'Looking up worker for task', data: { taskId: task.id, taskAgent: task.agent, registeredWorkers: Array.from(this.workers.keys()) }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'A' }) }).catch(() => { });
            // #endregion
            const worker = this.workers.get(task.agent);
            if (!worker) {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/a4f00bdc-6d66-4cb0-9b9b-8714458232cc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Orchestrator.ts:executeWithPlan-unknown-agent', message: 'Unknown agent - skipping task', data: { taskId: task.id, taskAgent: task.agent, availableWorkers: Array.from(this.workers.keys()) }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'A' }) }).catch(() => { });
                // #endregion
                this.thinkingChain.addFixingStep(`Unknown agent ${task.agent} for task ${task.id}, skipping`, { task }, 0.5);
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
            }
            catch (error) {
                const duration = Date.now() - startTime;
                this.bus.emit({
                    type: 'agent_complete',
                    agentName: task.agent,
                    success: false,
                    durationMs: duration
                });
                this.thinkingChain.addFixingStep(`Task ${task.id} failed: ${error}`, { task, error }, 0.3);
                // Continue with remaining tasks
            }
        }
        return results.join('\n\n');
    }
    /**
     * Execute a single task with a worker agent
     */
    async executeTask(worker, task) {
        const result = await streamText({
            model: anthropic('claude-sonnet-4-20250514'),
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
                        args: part.input
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
    sortByDependencies(tasks) {
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const sorted = [];
        const visited = new Set();
        const visiting = new Set();
        const visit = (taskId) => {
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
    async getProjectContext() {
        // TODO: Implement project context gathering
        // For now, return basic info
        return `Project root: ${this.projectRoot}`;
    }
    /**
     * Summarize tool arguments for display
     */
    summarizeToolArgs(args) {
        if (!args || typeof args !== 'object')
            return '';
        const obj = args;
        // Prioritize showing path for file operations
        if (obj.path)
            return String(obj.path);
        if (obj.name)
            return String(obj.name);
        if (obj.pattern)
            return String(obj.pattern);
        if (obj.directory)
            return String(obj.directory);
        // Fallback: show first few keys
        return Object.keys(obj).slice(0, 2).join(', ');
    }
    /**
     * Summarize tool result for display
     */
    summarizeToolResult(result) {
        if (!result || typeof result !== 'object')
            return String(result ?? 'Done');
        const obj = result;
        // Handle common result patterns
        if (obj.error)
            return `Error: ${obj.error}`;
        if (obj.success === false)
            return obj.message ? String(obj.message) : 'Failed';
        if (obj.content)
            return `${String(obj.content).length} chars`;
        if (obj.files && Array.isArray(obj.files))
            return `${obj.files.length} files`;
        if (obj.count !== undefined)
            return `${obj.count} items`;
        if (obj.lines !== undefined)
            return `${obj.lines} lines`;
        return 'Done';
    }
}
