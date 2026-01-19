/**
 * Orchestrator
 * Coordinates multiple specialized agents using AI SDK 6 patterns
 * Uses generateObject for intelligent routing to worker agents
 *
 * AI SDK 6 Features:
 * - Tool approval is handled at the executor level via TOOL_APPROVAL_CONFIG
 * - Worker agents receive tools with approval-aware execute functions
 * - Future: Will use ToolLoopAgent when available for cleaner agent management
 */

import { generateObject, streamText, stepCountIs } from 'ai';
import { createModeStopCondition, type StopCondition } from '../stop-conditions.js';
import { createModelWithVariant, type ModelWithVariant } from '../model-provider.js';
import type { EventBus } from '../../events/index.js';
import type {
    GateFlowAgent,
    ExecutionPlan,
    Task,
    TaskContext,
    TaskResult,
    ProjectContext,
    DependencyFailurePolicy
} from '../../types/agent-shared.js';
import { AgentRoutingSchema } from '../../types/agent-shared.js';
import { createPlan } from '../workers/PlanningAgent.js';
import { ThinkingChain } from '../reasoning/ThinkingChain.js';
import type { SVIndexerAdapter } from '../../indexer/sv-indexer-adapter.js';
import type { MemoryService } from '../../memory/MemoryService.js';
import { estimateTokens, truncateToFit } from '../../memory/token-estimator.js';
import {
    AgentResilienceLayer,
    type AgentResilienceConfig
} from './resilience.js';
import { metrics } from '../../observability/index.js';

interface TaskExecutionOutput {
    output: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    stepsExecuted: number;
}

export interface OrchestratorConfig {
    indexer?: SVIndexerAdapter;
    memoryService?: MemoryService;
    dependencyFailurePolicy?: DependencyFailurePolicy;
    concurrencyLimit?: number;
    planningTokenBudget?: number;
    summaryTokenBudget?: number;
    planConfidenceThreshold?: number;
    resilience?: Partial<AgentResilienceConfig>;
}

const DEFAULT_ORCHESTRATOR_CONFIG = {
    dependencyFailurePolicy: 'continue-with-context' as DependencyFailurePolicy,
    concurrencyLimit: 3,
    planningTokenBudget: 2000,
    summaryTokenBudget: 500,
    planConfidenceThreshold: 0.6
};

class OrchestratorAbortError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OrchestratorAbortError';
    }
}

export class Orchestrator {
    private workers: Map<string, GateFlowAgent> = new Map();
    private thinkingChain: ThinkingChain;
    private taskResults: Map<string, TaskResult> = new Map();
    private abortControllers: Map<string, AbortController> = new Map();
    private resilienceLayer: AgentResilienceLayer;
    private indexer?: SVIndexerAdapter;
    private memoryService?: MemoryService;
    /** Model bundle with variant options for API calls */
    private modelBundle: ModelWithVariant;
    private config: {
        dependencyFailurePolicy: DependencyFailurePolicy;
        concurrencyLimit: number;
        planningTokenBudget: number;
        summaryTokenBudget: number;
        planConfidenceThreshold: number;
    };

    constructor(
        private bus: EventBus,
        private projectRoot: string,
        private modelName: string = 'claude-sonnet-4-20250514',
        config?: OrchestratorConfig
    ) {
        this.thinkingChain = new ThinkingChain(bus, { showByDefault: true });

        this.indexer = config?.indexer;
        this.memoryService = config?.memoryService;

        // Parse model and create bundle with variant options
        this.modelBundle = createModelWithVariant(modelName);

        const concurrencyLimit = config?.concurrencyLimit ?? DEFAULT_ORCHESTRATOR_CONFIG.concurrencyLimit;
        const rawThreshold = config?.planConfidenceThreshold ?? DEFAULT_ORCHESTRATOR_CONFIG.planConfidenceThreshold;
        const planConfidenceThreshold = Math.min(1, Math.max(0, rawThreshold));

        this.config = {
            dependencyFailurePolicy:
                config?.dependencyFailurePolicy ?? DEFAULT_ORCHESTRATOR_CONFIG.dependencyFailurePolicy,
            concurrencyLimit: Number.isFinite(concurrencyLimit)
                ? Math.max(1, concurrencyLimit)
                : DEFAULT_ORCHESTRATOR_CONFIG.concurrencyLimit,
            planningTokenBudget:
                config?.planningTokenBudget ?? DEFAULT_ORCHESTRATOR_CONFIG.planningTokenBudget,
            summaryTokenBudget:
                config?.summaryTokenBudget ?? DEFAULT_ORCHESTRATOR_CONFIG.summaryTokenBudget,
            planConfidenceThreshold
        };

        this.resilienceLayer = new AgentResilienceLayer(bus, config?.resilience);
    }

    /**
     * Register a worker agent
     */
    registerWorker(name: string, agent: GateFlowAgent): void {
        this.workers.set(name, agent);
    }

    /**
     * Cancel a running task by ID
     */
    cancelTask(taskId: string): boolean {
        const controller = this.abortControllers.get(taskId);
        if (controller) {
            controller.abort();
            this.abortControllers.delete(taskId);
            return true;
        }
        return false;
    }

    /**
     * Cancel all running tasks
     */
    cancelAll(): void {
        for (const controller of this.abortControllers.values()) {
            controller.abort();
        }
        this.abortControllers.clear();
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

        const { object: routing } = await generateObject({
            model: this.modelBundle.model as any,
            schema: AgentRoutingSchema,
            prompt: `Route this request to the best agent:

Request: "${userRequest}"

Available agents:
- understanding: For reading/analyzing existing code
- codegen: For creating new SystemVerilog modules
- testbench: For generating testbenches
- debug: For diagnosing simulation failures
- refactoring: For modifying existing code

Select the most appropriate agent and describe the task.`,
            ...this.modelBundle.variantOptions
        });

        this.thinkingChain.addCoordinationStep(
            `Selected agent: ${routing.selectedAgent}`,
            { routing },
            0.95
        );

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
            let lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;

            // Use mode-aware stop condition based on worker's name
            const workerStopCondition = this.getWorkerStopCondition(
                worker.name,
                worker.stepLimit || 10
            );

            const result = await streamText({
                model: this.modelBundle.model as any,
                system: worker.system,
                prompt: routing.taskDescription,
                tools: worker.tools,
                toolChoice: worker.toolChoice,
                stopWhen: workerStopCondition,
                ...this.modelBundle.variantOptions,
                onStepFinish: (step) => {
                    this.thinkingChain.onStepFinish(step);
                },
                onError: ({ error }) => {
                    this.bus.emit({
                        type: 'error',
                        message: error instanceof Error ? error.message : String(error)
                    });
                },
                onAbort: ({ steps }) => {
                    this.bus.emit({
                        type: 'status',
                        phase: 'thinking',
                        label: `Agent aborted after ${steps.length} steps`
                    });
                },
                onFinish: ({ totalUsage }) => {
                    lastUsage = totalUsage;
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

                    case 'tool-result': {
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

                    case 'error': {
                        const errorMsg = (part as any).error instanceof Error
                            ? (part as any).error.message
                            : String((part as any).error);
                        this.bus.emit({
                            type: 'error',
                            message: `Stream error: ${errorMsg}`
                        });
                        break;
                    }

                    case 'tool-error': {
                        const toolError = part as any;
                        const errorMsg = toolError.error instanceof Error
                            ? toolError.error.message
                            : String(toolError.error);
                        this.bus.emit({
                            type: 'error',
                            message: `Tool ${toolError.toolName} failed: ${errorMsg}`
                        });
                        break;
                    }
                }
            }

            const finalText = await result.text;
            const duration = Date.now() - startTime;

            this.bus.emit({
                type: 'agent_complete',
                agentName: routing.selectedAgent,
                success: true,
                result: finalText,
                durationMs: duration,
                inputTokens: lastUsage?.inputTokens,
                outputTokens: lastUsage?.outputTokens
            });

            return finalText || output;
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);

            this.thinkingChain.addAnalysisStep(
                `Agent ${routing.selectedAgent} failed: ${errorMsg}`,
                { error: errorMsg },
                0
            );

            this.bus.emit({
                type: 'error',
                message: `Agent ${routing.selectedAgent} failed: ${errorMsg}`
            });

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
        this.taskResults.clear();
        this.abortControllers.clear();

        this.thinkingChain.addPlanningStep(
            'Creating execution plan for complex request',
            { request: userRequest },
            0.9
        );

        const projectContext = await this.buildProjectContext();
        const plan = await createPlan(
            userRequest,
            this.formatContextForPlanning(projectContext),
            this.modelName
        );

        const validation = this.validatePlan(plan);
        if (!validation.valid) {
            this.bus.emit({
                type: 'error',
                message: `Plan validation failed: ${validation.error}`
            });
            throw new Error(`Plan validation failed: ${validation.error}`);
        }

        await this.requestPlanApprovalIfNeeded(plan);

        const taskLevels = this.groupTasksByLevel(plan.tasks);

        this.thinkingChain.addDecompositionStep(
            `Created plan with ${plan.tasks.length} tasks in ${taskLevels.length} levels`,
            {
                levels: taskLevels.map((level, index) => ({
                    level: index,
                    tasks: level.map(task => ({ id: task.id, agent: task.agent }))
                }))
            },
            0.9
        );

        const results: string[] = [];

        for (let levelIndex = 0; levelIndex < taskLevels.length; levelIndex++) {
            const level = taskLevels[levelIndex];

            if (level.length > 1) {
                this.bus.emit({
                    type: 'status',
                    phase: 'thinking',
                    label: `Executing ${level.length} tasks in parallel (level ${levelIndex + 1}/${taskLevels.length})`
                });
            }

            if (level.length === 1) {
                try {
                    const result = await this.executeSingleTask(level[0], projectContext, plan);
                    if (result) results.push(result);
                } catch (error) {
                    if (error instanceof OrchestratorAbortError) {
                        throw error;
                    }
                }
            } else {
                const levelResults = await this.executeParallelWithLimit(
                    level.map(task => () => this.executeSingleTask(task, projectContext, plan)),
                    this.config.concurrencyLimit
                );

                for (let i = 0; i < levelResults.length; i++) {
                    const result = levelResults[i];
                    const task = level[i];

                    if (result.status === 'fulfilled') {
                        if (result.value) results.push(result.value);
                    } else {
                        const reason = result.reason;
                        if (reason instanceof OrchestratorAbortError) {
                            this.cancelAll();
                            throw reason;
                        }
                    }
                }
            }

            const levelOutcomes = level
                .map(task => this.taskResults.get(task.id))
                .filter((result): result is TaskResult => Boolean(result));
            const succeeded = levelOutcomes.filter(result => result.success).length;

            if (levelOutcomes.length > 0 && succeeded === 0) {
                this.bus.emit({
                    type: 'error',
                    message: `All ${level.length} tasks at level ${levelIndex + 1} failed`
                });

                if (this.config.dependencyFailurePolicy === 'abort') {
                    throw new OrchestratorAbortError('All tasks in level failed');
                }
            }
        }

        return results.join('\n\n');
    }

    private async executeSingleTask(
        task: Task,
        projectContext: ProjectContext,
        plan: ExecutionPlan
    ): Promise<string | null> {
        const worker = this.workers.get(task.agent);
        if (!worker) {
            const error = new Error(`Unknown agent: ${task.agent}`);
            this.taskResults.set(task.id, this.createFailedTaskResult(task, error, Date.now()));
            this.bus.emit({
                type: 'error',
                message: `Unknown agent ${task.agent} for task ${task.id}`
            });
            throw error;
        }

        const failedDependencies = this.getFailedDependencies(task);
        if (failedDependencies.length > 0) {
            if (this.config.dependencyFailurePolicy === 'skip') {
                const summary = `Skipped due to failed dependencies: ${failedDependencies.join(', ')}`;
                this.taskResults.set(task.id, this.createSkippedTaskResult(task, summary));
                this.bus.emit({
                    type: 'status',
                    phase: 'thinking',
                    label: `Skipping task ${task.id} due to failed dependencies`
                });
                return null;
            }

            if (this.config.dependencyFailurePolicy === 'abort') {
                const summary = `Dependencies failed: ${failedDependencies.join(', ')}`;
                this.taskResults.set(task.id, this.createSkippedTaskResult(task, summary));
                throw new OrchestratorAbortError(summary);
            }
        }

        const taskContext = this.buildTaskContext(task, projectContext, plan);
        const startTime = Date.now();

        this.emitDelegation(task);
        this.emitAgentStart(task);

        const controller = new AbortController();
        this.abortControllers.set(task.id, controller);

        try {
            const execution = await this.resilienceLayer.executeWithResilience(
                task.agent,
                task.id,
                (signal) => this.runTaskStream(worker, task, taskContext, signal),
                controller.signal
            );

            const taskResult = this.createTaskResult(task, execution.output, startTime, execution.usage);
            this.taskResults.set(task.id, taskResult);

            this.emitAgentComplete(task, true, execution.output, startTime, execution.usage);
            return execution.output;
        } catch (error) {
            const taskResult = this.createFailedTaskResult(task, error, startTime);
            this.taskResults.set(task.id, taskResult);

            const errorMsg = error instanceof Error ? error.message : String(error);
            const durationMs = Date.now() - startTime;
            this.bus.emit({
                type: 'error',
                message: `Task ${task.id} (${task.agent}) failed after ${durationMs}ms: ${errorMsg}`
            });

            this.emitAgentComplete(task, false, undefined, startTime);

            this.thinkingChain.addFixingStep(
                `Task ${task.id} failed: ${errorMsg}`,
                { task, error: errorMsg },
                0.3
            );

            throw error;
        } finally {
            this.abortControllers.delete(task.id);
        }
    }

    private async runTaskStream(
        worker: GateFlowAgent,
        task: Task,
        context: TaskContext,
        signal: AbortSignal
    ): Promise<TaskExecutionOutput> {
        const enhancedPrompt = this.buildEnhancedPrompt(task, context);
        let lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;
        let stepCount = 0;

        // Use mode-aware stop condition based on worker's name
        const workerStopCondition = this.getWorkerStopCondition(
            worker.name,
            worker.stepLimit || 10
        );

        const result = await streamText({
            model: this.modelBundle.model as any,
            system: worker.system,
            prompt: enhancedPrompt,
            tools: worker.tools,
            toolChoice: worker.toolChoice,
            stopWhen: workerStopCondition,
            abortSignal: signal,
            ...this.modelBundle.variantOptions,
            onStepFinish: (step) => {
                stepCount += 1;
                this.thinkingChain.onStepFinish(step);
            },
            onError: ({ error }) => {
                this.bus.emit({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error)
                });
            },
            onAbort: ({ steps }) => {
                this.bus.emit({
                    type: 'status',
                    phase: 'thinking',
                    label: `Task ${task.id} aborted after ${steps.length} steps`
                });
            },
            onFinish: ({ totalUsage }) => {
                lastUsage = totalUsage;
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

                case 'tool-result': {
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

                case 'error': {
                    const errorMsg = (part as any).error instanceof Error
                        ? (part as any).error.message
                        : String((part as any).error);
                    this.bus.emit({
                        type: 'error',
                        message: `Stream error: ${errorMsg}`
                    });
                    break;
                }

                case 'tool-error': {
                    const toolError = part as any;
                    const errorMsg = toolError.error instanceof Error
                        ? toolError.error.message
                        : String(toolError.error);
                    this.bus.emit({
                        type: 'error',
                        message: `Tool ${toolError.toolName} failed: ${errorMsg}`
                    });
                    break;
                }

                case 'abort':
                    this.bus.emit({
                        type: 'status',
                        phase: 'thinking',
                        label: `Task ${task.id} stream aborted`
                    });
                    break;
            }
        }

        const finalText = await result.text;
        const steps = await result.steps;
        const stepsExecuted = steps ? steps.length : stepCount;

        return {
            output: finalText || output,
            usage: lastUsage ? { inputTokens: lastUsage.inputTokens, outputTokens: lastUsage.outputTokens } : undefined,
            stepsExecuted
        };
    }

    private buildTaskContext(
        task: Task,
        projectContext: ProjectContext,
        plan: ExecutionPlan
    ): TaskContext {
        const previousResults = new Map<string, TaskResult>();

        for (const depId of task.dependencies) {
            const result = this.taskResults.get(depId);
            if (result) {
                previousResults.set(depId, result);
            }
        }

        return {
            task,
            previousResults,
            projectContext,
            orchestrationState: {
                completedTasks: this.taskResults.size,
                totalTasks: plan.tasks.length,
                failedTasks: Array.from(this.taskResults.entries())
                    .filter(([, result]) => !result.success)
                    .map(([id]) => id)
            }
        };
    }

    private buildEnhancedPrompt(task: Task, context: TaskContext): string {
        let prompt = task.description.trim();

        const projectSummary = this.formatContextForTask(context.projectContext);
        if (projectSummary) {
            prompt += `\n\n<project_context>\n${projectSummary}\n</project_context>`;
        }

        if (context.previousResults.size > 0) {
            prompt += '\n\n<previous_task_results>';

            for (const [depId, result] of context.previousResults) {
                const status = result.success ? 'success' : 'failed';
                prompt += `\n\n### Task ${depId} (${result.agent}) [${status}]:\n${result.summary}`;

                if (result.artifacts.filesCreated.length > 0) {
                    prompt += `\nFiles created: ${result.artifacts.filesCreated.join(', ')}`;
                }
                if (result.artifacts.filesModified.length > 0) {
                    prompt += `\nFiles referenced: ${result.artifacts.filesModified.join(', ')}`;
                }
                if (result.artifacts.modulesFound.length > 0) {
                    prompt += `\nModules: ${result.artifacts.modulesFound.join(', ')}`;
                }
                if (result.artifacts.errorsDetected.length > 0) {
                    prompt += `\nErrors: ${result.artifacts.errorsDetected.join('; ')}`;
                }
                if (result.insights.length > 0) {
                    prompt += `\nKey insights: ${result.insights.join('; ')}`;
                }
            }

            prompt += '\n</previous_task_results>';
        }

        return prompt;
    }

    private createTaskResult(
        task: Task,
        output: string,
        startTime: number,
        usage?: { inputTokens?: number; outputTokens?: number }
    ): TaskResult {
        return {
            taskId: task.id,
            agent: task.agent,
            success: true,
            output,
            summary: this.summarizeOutput(output, task.type),
            artifacts: this.extractArtifacts(output),
            insights: this.extractInsights(output, task.type),
            durationMs: Date.now() - startTime,
            tokenUsage: usage
                ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
                : undefined
        };
    }

    private createFailedTaskResult(task: Task, error: unknown, startTime: number): TaskResult {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            taskId: task.id,
            agent: task.agent,
            success: false,
            output: '',
            summary: `Failed: ${errorMsg}`,
            artifacts: {
                filesCreated: [],
                filesModified: [],
                modulesFound: [],
                errorsDetected: [errorMsg].slice(0, 1)
            },
            insights: [],
            durationMs: Date.now() - startTime
        };
    }

    private createSkippedTaskResult(task: Task, reason: string): TaskResult {
        return {
            taskId: task.id,
            agent: task.agent,
            success: false,
            output: '',
            summary: reason,
            artifacts: {
                filesCreated: [],
                filesModified: [],
                modulesFound: [],
                errorsDetected: []
            },
            insights: [],
            durationMs: 0
        };
    }

    private summarizeOutput(output: string, _taskType: string): string {
        if (!output) return '';
        const maxTokens = this.config.summaryTokenBudget;

        if (estimateTokens(output).tokens <= maxTokens) {
            return output.trim();
        }

        const lines = output.split('\n');
        const keyLines: string[] = [];

        for (const line of lines) {
            if (/\bmodule\s+\w+/.test(line)) keyLines.push(line);
            if (/(?:created|wrote|modified|generated)/i.test(line)) keyLines.push(line);
            if (/(?:error|warning|note):/i.test(line)) keyLines.push(line);
            if (/(?:found|detected|identified)/i.test(line)) keyLines.push(line);
        }

        const summaryBase = keyLines.length > 0
            ? keyLines.slice(0, 40).join('\n')
            : output;

        return truncateToFit(summaryBase, maxTokens);
    }

    private extractArtifacts(output: string): TaskResult['artifacts'] {
        const artifacts: TaskResult['artifacts'] = {
            filesCreated: [],
            filesModified: [],
            modulesFound: [],
            errorsDetected: []
        };

        if (!output) {
            return artifacts;
        }

        const filePattern = /[\w./\\-]+\.(?:sv|svh|v|vh)/g;
        const files = output.match(filePattern) || [];
        artifacts.filesModified = [...new Set(files)];

        const createdPattern = /(?:created|wrote|generated)\s+["']?([\w./\\-]+\.(?:sv|svh|v|vh))["']?/gi;
        let match: RegExpExecArray | null;
        while ((match = createdPattern.exec(output)) !== null) {
            artifacts.filesCreated.push(match[1]);
        }
        artifacts.filesCreated = [...new Set(artifacts.filesCreated)];

        const modulePattern = /\bmodule\s+(\w+)/g;
        while ((match = modulePattern.exec(output)) !== null) {
            artifacts.modulesFound.push(match[1]);
        }
        artifacts.modulesFound = [...new Set(artifacts.modulesFound)];

        const errorPattern = /\b(?:error|Error):\s*(.+)$/gm;
        while ((match = errorPattern.exec(output)) !== null) {
            artifacts.errorsDetected.push(match[1].slice(0, 100));
        }
        artifacts.errorsDetected = artifacts.errorsDetected.slice(0, 5);

        return artifacts;
    }

    private extractInsights(output: string, _taskType: string): string[] {
        if (!output) return [];
        const insights: string[] = [];
        const bulletPattern = /^\s*[-*]\s+(.+)$/gm;
        let match: RegExpExecArray | null;

        while ((match = bulletPattern.exec(output)) !== null) {
            const line = match[1].trim();
            if (line.length > 20 && line.length < 200) {
                insights.push(line);
            }
        }

        return insights.slice(0, 5);
    }

    private validatePlan(plan: ExecutionPlan): { valid: boolean; error?: string } {
        const ids = new Set<string>();
        for (const task of plan.tasks) {
            if (ids.has(task.id)) {
                return { valid: false, error: `Duplicate task id: ${task.id}` };
            }
            ids.add(task.id);
        }

        const validAgents = new Set(this.workers.keys());

        for (const task of plan.tasks) {
            if (!validAgents.has(task.agent)) {
                return { valid: false, error: `Invalid agent: ${task.agent}` };
            }
            if (task.dependencies.includes(task.id)) {
                return { valid: false, error: `Self-referential dependency: ${task.id}` };
            }
            for (const depId of task.dependencies) {
                if (!ids.has(depId)) {
                    return { valid: false, error: `Missing dependency ${depId} for task ${task.id}` };
                }
            }
        }

        return { valid: true };
    }

    private async requestPlanApprovalIfNeeded(plan: ExecutionPlan): Promise<void> {
        if (plan.confidence >= this.config.planConfidenceThreshold) {
            return;
        }

        const taskSummary = plan.tasks
            .slice(0, 5)
            .map(task => `${task.id}(${task.agent})`)
            .join(', ');
        const suffix = plan.tasks.length > 5 ? ', ...' : '';
        const details = [
            `confidence: ${plan.confidence.toFixed(2)} (threshold ${this.config.planConfidenceThreshold.toFixed(2)})`,
            `tasks: ${taskSummary}${suffix}`
        ].join('\n');

        this.thinkingChain.addCoordinationStep(
            'Plan confidence low; requesting approval',
            { confidence: plan.confidence },
            0.6
        );

        try {
            const response = await this.bus.requestApproval('Low-confidence plan', details);
            if (!response.approved) {
                throw new OrchestratorAbortError('User declined low-confidence plan');
            }
        } catch (error) {
            throw new OrchestratorAbortError(this.formatApprovalError(error, 'Plan approval failed'));
        }
    }

    private getFailedDependencies(task: Task): string[] {
        const failed: string[] = [];
        for (const depId of task.dependencies) {
            const result = this.taskResults.get(depId);
            if (!result || !result.success) {
                failed.push(depId);
            }
        }
        return failed;
    }

    private groupTasksByLevel(tasks: Task[]): Task[][] {
        const taskMap = new Map(tasks.map(task => [task.id, task]));
        const levels: Task[][] = [];
        const assigned = new Set<string>();

        while (assigned.size < tasks.length) {
            const currentLevel: Task[] = [];

            for (const task of tasks) {
                if (assigned.has(task.id)) continue;

                const depsReady = task.dependencies.every(depId =>
                    !taskMap.has(depId) || assigned.has(depId)
                );

                if (depsReady) {
                    currentLevel.push(task);
                }
            }

            if (currentLevel.length === 0 && assigned.size < tasks.length) {
                const remaining = tasks.filter(task => !assigned.has(task.id)).map(task => task.id);
                throw new Error(`Circular dependency detected. Remaining tasks: ${remaining.join(', ')}`);
            }

            levels.push(currentLevel);
            for (const task of currentLevel) {
                assigned.add(task.id);
            }
        }

        return levels;
    }

    private async executeParallelWithLimit<T>(
        tasks: Array<() => Promise<T>>,
        concurrencyLimit: number
    ): Promise<PromiseSettledResult<T>[]> {
        const results: PromiseSettledResult<T>[] = new Array(tasks.length);
        const executing = new Set<Promise<void>>();

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];

            const p = (async () => {
                try {
                    results[i] = { status: 'fulfilled', value: await task() };
                } catch (reason) {
                    results[i] = { status: 'rejected', reason };
                }
            })();

            executing.add(p);
            p.finally(() => executing.delete(p));

            if (executing.size >= concurrencyLimit) {
                await Promise.race(executing);
            }
        }

        await Promise.all(executing);
        return results;
    }

    private async buildProjectContext(): Promise<ProjectContext> {
        const context: ProjectContext = {
            projectRoot: this.projectRoot,
            modules: [],
            dependencies: {
                topModules: [],
                leafModules: [],
                totalModules: 0
            }
        };

        if (!this.indexer) {
            return context;
        }

        try {
            const index = this.indexer.getIndex();
            const stats = this.indexer.getStats();

            for (const [name, module] of index.modules) {
                context.modules.push({
                    name,
                    file: this.relativePath(module.file),
                    ports: module.ports?.length ?? 0,
                    instantiates: module.instantiates ?? []
                });
            }

            context.dependencies.totalModules = stats.modules;

            const instantiated = new Set<string>();
            for (const module of index.modules.values()) {
                for (const inst of module.instantiates ?? []) {
                    instantiated.add(inst);
                }
            }

            for (const name of index.modules.keys()) {
                if (!instantiated.has(name)) {
                    context.dependencies.topModules.push(name);
                }
            }

            for (const [name, module] of index.modules) {
                if (!module.instantiates?.length) {
                    context.dependencies.leafModules.push(name);
                }
            }

            if (this.memoryService?.isInitialized()) {
                context.recentErrors = await this.getRecentLintErrors();
            }

            const project = this.indexer.getProject();
            if (project?.defineContextId) {
                context.defineContextId = project.defineContextId;
            }
        } catch (error) {
            this.bus.emit({
                type: 'error',
                message: `Failed to build full project context: ${error instanceof Error ? error.message : error}`,
                recoverable: true
            });
        }

        return context;
    }

    private async getRecentLintErrors(): Promise<ProjectContext['recentErrors']> {
        if (!this.memoryService) return [];

        try {
            const items = this.memoryService.knowledge.getByType('lint_fix');
            const sorted = [...items].sort((a, b) => b.updated - a.updated);
            return sorted.slice(0, 5).map(item => ({
                file: item.source.filePath ?? 'unknown',
                line: 0,
                message: item.content.slice(0, 200)
            }));
        } catch {
            return [];
        }
    }

    private formatContextForPlanning(context: ProjectContext): string {
        const sections: string[] = [];
        sections.push(`Project: ${context.projectRoot}\nTotal modules: ${context.dependencies.totalModules}`);

        if (context.dependencies.topModules.length > 0) {
            sections.push(`Top-level modules: ${context.dependencies.topModules.join(', ')}`);
        }

        if (context.dependencies.leafModules.length > 0) {
            sections.push(`Leaf modules: ${context.dependencies.leafModules.slice(0, 10).join(', ')}`);
        }

        if (context.modules.length > 0 && context.modules.length <= 20) {
            const lines = context.modules.map(mod => {
                const deps = mod.instantiates.length > 0
                    ? ` [${mod.instantiates.join(', ')}]`
                    : '';
                return `  - ${mod.name} (${mod.ports} ports)${deps}`;
            });
            sections.push(`Module details:\n${lines.join('\n')}`);
        }

        if (context.recentErrors && context.recentErrors.length > 0) {
            const errorLines = context.recentErrors.slice(0, 5).map(err =>
                `  - ${err.file}:${err.line}: ${err.message}`
            );
            sections.push(`Recent lint fixes:\n${errorLines.join('\n')}`);
        }

        const maxTokens = this.config.planningTokenBudget;
        const selected: string[] = [];
        let currentTokens = 0;

        for (const section of sections) {
            const tokens = estimateTokens(section).tokens;
            if (currentTokens + tokens > maxTokens) break;
            selected.push(section);
            currentTokens += tokens;
        }

        if (selected.length === 0 && sections.length > 0) {
            return truncateToFit(sections[0], maxTokens);
        }

        return truncateToFit(selected.join('\n\n'), maxTokens);
    }

    private formatContextForTask(context: ProjectContext): string {
        const lines: string[] = [];
        lines.push(`Project: ${context.projectRoot}`);
        lines.push(`Total modules: ${context.dependencies.totalModules}`);

        if (context.dependencies.topModules.length > 0) {
            lines.push(`Top-level modules: ${context.dependencies.topModules.slice(0, 10).join(', ')}`);
        }

        if (context.dependencies.leafModules.length > 0) {
            lines.push(`Leaf modules: ${context.dependencies.leafModules.slice(0, 10).join(', ')}`);
        }

        if (context.modules.length > 0) {
            const moduleNames = context.modules.map(mod => mod.name);
            const limited = moduleNames.slice(0, 30);
            const suffix = moduleNames.length > 30 ? ', ...' : '';
            lines.push(`Modules: ${limited.join(', ')}${suffix}`);
        }

        if (context.recentErrors && context.recentErrors.length > 0) {
            const err = context.recentErrors[0];
            lines.push(`Recent lint fix: ${err.file}:${err.line}: ${err.message}`);
        }

        return lines.join('\n');
    }

    private relativePath(absolutePath: string): string {
        if (absolutePath.startsWith(this.projectRoot)) {
            return absolutePath
                .slice(this.projectRoot.length + 1)
                .replace(/\\/g, '/');
        }
        return absolutePath;
    }

    private formatApprovalError(error: unknown, fallback: string): string {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        if (lower.includes('timed out') || lower.includes('timeout')) {
            return 'Approval request timed out';
        }
        return message || fallback;
    }

    private emitDelegation(task: Task): void {
        this.bus.emit({
            type: 'delegation',
            from: 'orchestrator',
            to: task.agent,
            taskType: task.type,
            taskData: {
                id: task.id,
                description: task.description,
                dependencies: task.dependencies
            }
        });
    }

    private emitAgentStart(task: Task): void {
        metrics.activeAgents.inc();
        this.bus.emit({
            type: 'agent_start',
            agentName: task.agent,
            task: task.description,
            estimatedDuration: task.estimatedDuration
        });
    }

    private emitAgentComplete(
        task: Task,
        success: boolean,
        result: string | undefined,
        startTime: number,
        usage?: { inputTokens?: number; outputTokens?: number }
    ): void {
        const durationMs = Date.now() - startTime;
        this.recordAgentMetrics(task.agent, success, durationMs);
        this.bus.emit({
            type: 'agent_complete',
            agentName: task.agent,
            success,
            result,
            durationMs,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens
        });
    }

    private recordAgentMetrics(agentName: string, success: boolean, durationMs: number): void {
        const status = success ? 'success' : 'failed';
        metrics.activeAgents.dec();
        metrics.agentExecutions.inc({ agent: agentName, status });
        metrics.agentDuration.observe(durationMs / 1000, { agent: agentName, status });
    }

    /**
     * Summarize tool arguments for display
     */
    private summarizeToolArgs(args: unknown): string {
        if (!args || typeof args !== 'object') return '';
        const obj = args as Record<string, unknown>;

        if (obj.path) return String(obj.path);
        if (obj.name) return String(obj.name);
        if (obj.pattern) return String(obj.pattern);
        if (obj.directory) return String(obj.directory);

        return Object.keys(obj).slice(0, 2).join(', ');
    }

    /**
     * Summarize tool result for display
     */
    private summarizeToolResult(result: unknown): string {
        if (!result || typeof result !== 'object') return String(result ?? 'Done');
        const obj = result as Record<string, unknown>;

        if (obj.error) return `Error: ${obj.error}`;
        if (obj.success === false) return obj.message ? String(obj.message) : 'Failed';
        if (obj.content) return `${String(obj.content).length} chars`;
        if (obj.files && Array.isArray(obj.files)) return `${obj.files.length} files`;
        if (obj.count !== undefined) return `${obj.count} items`;
        if (obj.lines !== undefined) return `${obj.lines} lines`;

        return 'Done';
    }

    /**
     * Get the appropriate stop condition for a worker based on its name.
     * Uses mode-aware stop conditions for enhanced stopping behavior.
     *
     * @param agentName - The name of the agent (understanding, codegen, testbench, debug, refactoring)
     * @param stepLimit - Maximum steps before stopping
     * @returns Stop condition function
     */
    private getWorkerStopCondition(agentName: string | undefined, stepLimit: number): StopCondition {
        // Map agent names to prompt modes for stop condition selection
        const agentNameToMode: Record<string, string> = {
            understanding: 'general',
            codegen: 'generate',
            testbench: 'testbench',
            debug: 'debug',
            refactoring: 'refactoring'
        };

        const mode = agentName ? agentNameToMode[agentName] ?? 'general' : 'general';
        return createModeStopCondition(mode, stepLimit);
    }
}
