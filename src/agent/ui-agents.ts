/**
 * Two-Agent UI Transition System
 *
 * Manages transitions between different CLI UI modes using specialized agents:
 * - PlannerAgent: Plans and orchestrates work
 * - ExecutorAgent: Executes tools and generates code
 *
 * The agents can transition control between each other based on task needs.
 */

import { generateObject, generateText, streamText } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';
import { createAnthropicClient } from './anthropic-client.js';
import type { EventBus } from '../events/index.js';
import {
    combinePrepareSteps,
    contextWindowManager,
    dynamicModelSelector,
    phasedExecution,
    type PrepareStepFn,
    type StepContext
} from './loop-control.js';
import { stepCountIs, type StopCondition } from './stop-conditions.js';

// ============================================================================
// Types
// ============================================================================

export type UIMode = 'planning' | 'execution' | 'review' | 'chat';

export interface UIState {
    mode: UIMode;
    context: {
        task?: string;
        plan?: string[];
        completedSteps?: number;
        totalSteps?: number;
        artifacts?: string[];
    };
}

export interface TransitionRequest {
    targetMode: UIMode;
    reason: string;
    context?: Record<string, unknown>;
}

export interface UIAgentConfig {
    model: string;
    tools: Record<string, Tool>;
    bus: EventBus;
}

// ============================================================================
// UI Mode Schemas
// ============================================================================

const TransitionSchema = z.object({
    shouldTransition: z.boolean().describe('Whether to transition to a different mode'),
    targetMode: z.enum(['planning', 'execution', 'review', 'chat']).optional(),
    reason: z.string().describe('Reason for transition or staying'),
    taskForNextAgent: z.string().optional().describe('Task description for the next agent')
});

const PlanSchema = z.object({
    steps: z.array(z.object({
        id: z.number(),
        description: z.string(),
        type: z.enum(['analysis', 'generation', 'verification', 'refactoring']),
        dependencies: z.array(z.number()).optional()
    })),
    estimatedComplexity: z.enum(['low', 'medium', 'high']),
    summary: z.string()
});

// ============================================================================
// UI Agent Base
// ============================================================================

export abstract class UIAgent {
    protected model: string;
    protected tools: Record<string, Tool>;
    protected bus: EventBus;
    protected state: UIState;

    constructor(config: UIAgentConfig, initialMode: UIMode) {
        this.model = config.model;
        this.tools = config.tools;
        this.bus = config.bus;
        this.state = { mode: initialMode, context: {} };
    }

    abstract get mode(): UIMode;
    abstract get systemPrompt(): string;
    abstract get prepareStep(): PrepareStepFn;

    getState(): UIState {
        return { ...this.state };
    }

    setState(state: Partial<UIState>): void {
        this.state = { ...this.state, ...state };
    }

    /**
     * Check if the agent should transition to a different mode.
     */
    async shouldTransition(userMessage: string): Promise<TransitionRequest | null> {
        const { object } = await generateObject({
            model: createAnthropicClient(this.model) as any,
            schema: TransitionSchema,
            prompt: `Current mode: ${this.mode}
Current context: ${JSON.stringify(this.state.context)}

User message: "${userMessage}"

Should we transition to a different UI mode?
- planning: For complex tasks needing decomposition
- execution: For implementing/running code
- review: For reviewing results and iterating
- chat: For simple Q&A

Only transition if the current mode is not suitable for the task.`
        });

        if (object.shouldTransition && object.targetMode && object.targetMode !== this.mode) {
            return {
                targetMode: object.targetMode,
                reason: object.reason,
                context: object.taskForNextAgent ? { task: object.taskForNextAgent } : undefined
            };
        }

        return null;
    }
}

// ============================================================================
// Planner Agent
// ============================================================================

export class PlannerAgent extends UIAgent {
    constructor(config: UIAgentConfig) {
        super(config, 'planning');
    }

    get mode(): UIMode {
        return 'planning';
    }

    get systemPrompt(): string {
        return `You are a Planning Agent for SystemVerilog development.

Your role is to:
1. Analyze complex requests and break them into steps
2. Identify dependencies between steps
3. Estimate complexity
4. Create actionable plans for the Executor Agent

You do NOT execute code or tools yourself. You only plan.

When the plan is ready, signal to transition to execution mode.

Current plan progress:
${this.state.context.plan ? this.state.context.plan.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'No plan yet'}
`;
    }

    get prepareStep(): PrepareStepFn {
        return combinePrepareSteps(
            contextWindowManager({ maxMessages: 30, keepSystem: true }),
            // Planner uses limited tools - only analysis, no modification
            phasedExecution([
                { name: 'analysis', steps: [0, 100], tools: ['read_file', 'search_code', 'list_files', 'find_module'] }
            ])
        );
    }

    /**
     * Create a plan for a complex task.
     */
    async createPlan(task: string): Promise<z.infer<typeof PlanSchema>> {
        const { object: plan } = await generateObject({
            model: createAnthropicClient(this.model) as any,
            schema: PlanSchema,
            system: this.systemPrompt,
            prompt: `Create a detailed plan for this task:

${task}

Break it into clear, actionable steps. Each step should be something the Executor Agent can complete.`
        });

        this.state.context.plan = plan.steps.map(s => s.description);
        this.state.context.totalSteps = plan.steps.length;
        this.state.context.completedSteps = 0;

        return plan;
    }
}

// ============================================================================
// Executor Agent
// ============================================================================

export class ExecutorAgent extends UIAgent {
    constructor(config: UIAgentConfig) {
        super(config, 'execution');
    }

    get mode(): UIMode {
        return 'execution';
    }

    get systemPrompt(): string {
        const planContext = this.state.context.plan
            ? `\n\nCurrent Plan:\n${this.state.context.plan.map((s, i) => {
                const completed = i < (this.state.context.completedSteps ?? 0);
                return `${completed ? '✓' : '○'} ${i + 1}. ${s}`;
            }).join('\n')}`
            : '';

        return `You are an Executor Agent for SystemVerilog development.

Your role is to:
1. Execute the planned steps using available tools
2. Generate code when needed
3. Run verification (lint, simulation)
4. Report results

You follow plans created by the Planner Agent.
${planContext}

After completing all steps or encountering issues, signal to transition to review mode.`;
    }

    get prepareStep(): PrepareStepFn {
        return combinePrepareSteps(
            contextWindowManager({ maxMessages: 40, keepSystem: true }),
            dynamicModelSelector({
                defaultModel: this.model,
                complexModel: this.model, // Could use a larger model
                complexityThreshold: 5
            }),
            // Executor has full tool access, phased by step
            (context: StepContext) => {
                const plan = this.state.context.plan;
                const currentStep = this.state.context.completedSteps ?? 0;

                // Different tools available based on current plan step
                if (!plan || currentStep >= plan.length) {
                    return { toolChoice: 'auto' as const };
                }

                const stepDesc = plan[currentStep].toLowerCase();

                if (stepDesc.includes('read') || stepDesc.includes('analyze')) {
                    return { activeTools: ['read_file', 'search_code', 'find_module', 'list_files'] };
                }
                if (stepDesc.includes('generate') || stepDesc.includes('create') || stepDesc.includes('write')) {
                    return { activeTools: ['write_file', 'edit_lines', 'search_replace'] };
                }
                if (stepDesc.includes('lint') || stepDesc.includes('verify')) {
                    return { activeTools: ['lint_file', 'run_simulation'] };
                }

                return {};
            }
        );
    }

    /**
     * Mark a step as completed.
     */
    completeStep(): void {
        this.state.context.completedSteps = (this.state.context.completedSteps ?? 0) + 1;
    }

    /**
     * Add an artifact (file created/modified).
     */
    addArtifact(path: string): void {
        this.state.context.artifacts = this.state.context.artifacts ?? [];
        if (!this.state.context.artifacts.includes(path)) {
            this.state.context.artifacts.push(path);
        }
    }
}

// ============================================================================
// Review Agent
// ============================================================================

export class ReviewAgent extends UIAgent {
    constructor(config: UIAgentConfig) {
        super(config, 'review');
    }

    get mode(): UIMode {
        return 'review';
    }

    get systemPrompt(): string {
        return `You are a Review Agent for SystemVerilog development.

Your role is to:
1. Review the work done by the Executor Agent
2. Check for issues or improvements
3. Suggest refinements if needed
4. Confirm completion or request more work

Artifacts created: ${this.state.context.artifacts?.join(', ') || 'None'}
Steps completed: ${this.state.context.completedSteps ?? 0}/${this.state.context.totalSteps ?? 0}

If satisfied, transition back to chat mode.
If issues found, transition back to planning or execution mode with specific feedback.`;
    }

    get prepareStep(): PrepareStepFn {
        return combinePrepareSteps(
            contextWindowManager({ maxMessages: 30, keepSystem: true }),
            phasedExecution([
                { name: 'review', steps: [0, 100], tools: ['read_file', 'lint_file', 'search_code'] }
            ])
        );
    }
}

// ============================================================================
// UI Agent Coordinator
// ============================================================================

export class UIAgentCoordinator {
    private agents: Map<UIMode, UIAgent>;
    private currentAgent: UIAgent;
    private transitionHistory: Array<{ from: UIMode; to: UIMode; reason: string; timestamp: number }> = [];
    private bus: EventBus;

    constructor(config: UIAgentConfig) {
        this.bus = config.bus;

        // Initialize all agents
        this.agents = new Map([
            ['planning', new PlannerAgent(config)],
            ['execution', new ExecutorAgent(config)],
            ['review', new ReviewAgent(config)],
            ['chat', new ChatAgent(config)]
        ]);

        // Start in chat mode
        this.currentAgent = this.agents.get('chat')!;
    }

    get currentMode(): UIMode {
        return this.currentAgent.mode;
    }

    /**
     * Process a user message, potentially transitioning between agents.
     */
    async process(userMessage: string): Promise<{
        response: string;
        mode: UIMode;
        transitioned: boolean;
    }> {
        // Check if we should transition
        const transition = await this.currentAgent.shouldTransition(userMessage);

        if (transition) {
            this.transition(transition.targetMode, transition.reason);

            // Pass context to new agent
            if (transition.context) {
                this.currentAgent.setState({
                    context: { ...this.currentAgent.getState().context, ...transition.context }
                });
            }
        }

        // Generate response with current agent
        const { text } = await generateText({
            model: createAnthropicClient(this.currentAgent['model']) as any,
            system: this.currentAgent.systemPrompt,
            prompt: userMessage
        });

        return {
            response: text,
            mode: this.currentMode,
            transitioned: !!transition
        };
    }

    /**
     * Transition to a new mode.
     */
    transition(targetMode: UIMode, reason: string): void {
        const fromMode = this.currentMode;
        const newAgent = this.agents.get(targetMode);

        if (!newAgent) {
            throw new Error(`Unknown UI mode: ${targetMode}`);
        }

        // Transfer context
        const currentContext = this.currentAgent.getState().context;
        newAgent.setState({ context: currentContext });

        // Switch agent
        this.currentAgent = newAgent;

        // Record transition
        this.transitionHistory.push({
            from: fromMode,
            to: targetMode,
            reason,
            timestamp: Date.now()
        });

        // Emit event
        this.bus.emit({
            type: 'status',
            phase: 'thinking',
            label: `Switched to ${targetMode} mode: ${reason}`
        });
    }

    /**
     * Get transition history.
     */
    getHistory(): typeof this.transitionHistory {
        return [...this.transitionHistory];
    }

    /**
     * Force a specific mode.
     */
    setMode(mode: UIMode): void {
        const agent = this.agents.get(mode);
        if (agent) {
            this.currentAgent = agent;
        }
    }
}

// ============================================================================
// Chat Agent (Default)
// ============================================================================

class ChatAgent extends UIAgent {
    constructor(config: UIAgentConfig) {
        super(config, 'chat');
    }

    get mode(): UIMode {
        return 'chat';
    }

    get systemPrompt(): string {
        return `You are a helpful SystemVerilog assistant.

For simple questions, answer directly.
For complex tasks, suggest transitioning to planning mode.

Available modes:
- chat: Quick Q&A (current)
- planning: Complex task decomposition
- execution: Running tools and generating code
- review: Reviewing and refining work`;
    }

    get prepareStep(): PrepareStepFn {
        return contextWindowManager({ maxMessages: 50, keepSystem: true });
    }
}
