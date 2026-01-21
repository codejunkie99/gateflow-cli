/**
 * Agent Shared Types
 * Ported from shared/agentTypes.ts with AI SDK 6 compatibility
 * Includes Zod schemas for structured outputs
 */

import type { Tool } from 'ai';
import { z } from 'zod';

// ============= Run Kinds =============

export type RunKind =
    | 'requirements_to_design'   // spec → RTL → TB → sim
    | 'chat_refinement'          // follow-up questions / edits
    | 'lint_or_review'
    | 'planning_phase'           // NEW: Planning only
    | 'analysis_phase';           // NEW: Understanding only

// ============= Run Stages =============

export type RunStage =
    | "idle"
    | "parsing"
    | "planning"
    | "understanding"            // NEW: Read and analyze
    | "decomposition"           // NEW: Break down tasks
    | "rtl"
    | "testbench"
    | "sim"
    | "done"
    | "error";

// ============= Thought Categories =============

export type ThoughtCategory =
    | "analyzing"    // Reading/understanding input
    | "planning"     // Deciding what to do
    | "decomposing"  // Breaking into subtasks (NEW)
    | "coordinating" // Managing multiple agents (NEW)
    | "generating"   // Creating code/content
    | "validating"   // Checking results
    | "fixing";      // Correcting errors

// ============= Execution Plan Schema (for generateStructured) =============

export const ExecutionPlanSchema = z.object({
    planType: z.enum(['single_file', 'multi_file', 'analysis_only']),
    tasks: z.array(z.object({
        id: z.string(),
        type: z.enum(['read', 'write', 'edit', 'analyze', 'generate', 'test']),
        description: z.string(),
        priority: z.enum(['high', 'medium', 'low']),
        dependencies: z.array(z.string()),
        estimatedDuration: z.number().optional(),
        // FIX A: Remove 'planning' - planning is handled by Orchestrator.executeWithPlan(), not as a worker agent
        agent: z.enum(['understanding', 'codegen', 'testbench', 'debug', 'refactoring'])
    })),
    dependencies: z.array(z.string()).optional(),
    estimatedSteps: z.number(),
    confidence: z.number()
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
export type Task = ExecutionPlan['tasks'][number];

// ============= Worker Profile Interface =============

export interface WorkerProfile {
    name: string;
    system: string;
    tools: Record<string, Tool>;
    toolChoice?: 'auto' | 'required' | 'none';
    /** Maximum steps for tool loop (used with stopWhen: stepCountIs()) */
    stepLimit?: number;
    /** Optional model override (format: provider/model[:variant]) */
    modelName?: string;
    /** Optional generation overrides for this worker */
    maxOutputTokens?: number;
    temperature?: number;
}

// ============= Complexity Detection Schema =============

export const ComplexityDetectionSchema = z.object({
    needsMultiAgent: z.boolean(),
    reasoning: z.string()
});

export type ComplexityDetection = z.infer<typeof ComplexityDetectionSchema>;

// ============= Event Types =============

export type EventKind =
    | "status"
    | "thought"
    | "answer_delta"
    | "edit"
    | "sim"
    | "error"
    | "done"
    | "agent_start"          // NEW: Agent started
    | "agent_complete"        // NEW: Agent finished
    | "delegation";          // NEW: Agent-to-agent message

// ThinkingStepEvent moved to events/types.ts as ThoughtEvent

export interface AgentStartEvent {
    type: "agent_start";
    agentName: string;        // e.g., "planning", "codegen"
    task: string;
    estimatedDuration?: number;
}

export interface AgentCompleteEvent {
    type: "agent_complete";
    agentName: string;
    success: boolean;
    result?: any;
    durationMs: number;
    outputTokens?: number;
    inputTokens?: number;
}

export interface DelegationEvent {
    type: "delegation";
    from: string;              // Sending agent
    to: string;                // Receiving agent
    taskType: string;
    taskData: any;
}

// ============= Emit Function =============

/**
 * Match the signature used in root project's SSE streaming
 * Adapted for CLI event system
 */
// Note: EmitFn now uses ThoughtEvent from events/types.ts
export type EmitFn = (event: Omit<AgentStartEvent | AgentCompleteEvent | DelegationEvent, 'timestamp'>) => void;

// ============= Agent Context =============

export interface AgentContext {
    files: Map<string, string>;
    errors: any[];
    plan?: ExecutionPlan;
    previousResults: any[];
    projectRoot: string;
}

// ============= Agent Result =============

export interface AgentResult {
    success: boolean;
    output?: string;
    data?: any;
    thinkingChain?: {
        steps: Array<{
            stepNumber: number;
            type: ThoughtCategory;
            thought: string;
            data?: any;
            confidence: number;
            timestamp: number;
        }>;
        summary: {
            totalSteps: number;
            stepsByCategory: Record<string, number>;
            duration: number;
            averageConfidence: number;
        };
    };
}

/**
 * Rich project context for planning
 */
export interface ProjectContext {
    projectRoot: string;
    modules: Array<{
        name: string;
        file: string;
        ports: number;
        instantiates: string[];
    }>;
    dependencies: {
        topModules: string[];
        leafModules: string[];
        totalModules: number;
    };
    recentErrors?: Array<{
        file: string;
        line: number;
        message: string;
    }>;
    defineContextId?: string;
}

/**
 * Result of a task execution with context for dependent tasks
 * Used to pass structured results between tasks in multi-agent workflows
 */
export interface TaskResult {
    taskId: string;
    agent: string;
    success: boolean;
    /** Full output (for logging/debugging) */
    output: string;
    /** Summarized output for dependent tasks (max ~500 tokens) */
    summary: string;
    /** Structured data extracted from output */
    artifacts: {
        filesCreated: string[];
        filesModified: string[];
        modulesFound: string[];
        errorsDetected: string[];
    };
    /** Key insights for downstream tasks */
    insights: string[];
    /** Execution timing */
    durationMs: number;
    tokenUsage?: { input: number; output: number };
}

/**
 * Context passed to each task during execution
 */
export interface TaskContext {
    task: Task;
    previousResults: Map<string, TaskResult>;
    projectContext: ProjectContext;
    orchestrationState: {
        completedTasks: number;
        totalTasks: number;
        failedTasks: string[];
    };
}

export interface TaskArtifact {
    type: 'file' | 'code' | 'analysis' | 'error';
    path?: string;
    content?: string;
    description: string;
}

/**
 * Policy for handling dependency failures
 * - 'skip': Skip the task if any dependency failed
 * - 'continue-with-context': Run the task with failure context in prompt
 * - 'abort': Stop the entire plan execution
 */
export type DependencyFailurePolicy = 'skip' | 'continue-with-context' | 'abort';

/**
 * Extended task definition with failure policy
 */
export interface TaskWithPolicy extends Task {
    dependencyFailurePolicy?: DependencyFailurePolicy;
}

/**
 * Map of task IDs to their results for dependency resolution
 */
export type TaskResultMap = Map<string, TaskResult>;

