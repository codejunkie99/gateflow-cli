/**
 * Agent Shared Types
 * Ported from shared/agentTypes.ts with AI SDK 6 compatibility
 * Includes Zod schemas for structured outputs
 */
import type { Tool } from 'ai';
import { z } from 'zod';
export type RunKind = 'requirements_to_design' | 'chat_refinement' | 'lint_or_review' | 'planning_phase' | 'analysis_phase';
export type RunStage = "idle" | "parsing" | "planning" | "understanding" | "decomposition" | "rtl" | "testbench" | "sim" | "done" | "error";
export type ThoughtCategory = "analyzing" | "planning" | "decomposing" | "coordinating" | "generating" | "validating" | "fixing";
export declare const ExecutionPlanSchema: z.ZodObject<{
    planType: z.ZodEnum<["single_file", "multi_file", "analysis_only"]>;
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["read", "write", "edit", "analyze", "generate", "test"]>;
        description: z.ZodString;
        priority: z.ZodEnum<["high", "medium", "low"]>;
        dependencies: z.ZodArray<z.ZodString, "many">;
        estimatedDuration: z.ZodOptional<z.ZodNumber>;
        agent: z.ZodEnum<["understanding", "codegen", "testbench", "debug", "refactoring"]>;
    }, "strip", z.ZodTypeAny, {
        type: "analyze" | "test" | "generate" | "edit" | "read" | "write";
        id: string;
        description: string;
        priority: "high" | "medium" | "low";
        dependencies: string[];
        agent: "testbench" | "debug" | "understanding" | "codegen" | "refactoring";
        estimatedDuration?: number | undefined;
    }, {
        type: "analyze" | "test" | "generate" | "edit" | "read" | "write";
        id: string;
        description: string;
        priority: "high" | "medium" | "low";
        dependencies: string[];
        agent: "testbench" | "debug" | "understanding" | "codegen" | "refactoring";
        estimatedDuration?: number | undefined;
    }>, "many">;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    estimatedSteps: z.ZodNumber;
    confidence: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    planType: "single_file" | "multi_file" | "analysis_only";
    tasks: {
        type: "analyze" | "test" | "generate" | "edit" | "read" | "write";
        id: string;
        description: string;
        priority: "high" | "medium" | "low";
        dependencies: string[];
        agent: "testbench" | "debug" | "understanding" | "codegen" | "refactoring";
        estimatedDuration?: number | undefined;
    }[];
    estimatedSteps: number;
    confidence: number;
    dependencies?: string[] | undefined;
}, {
    planType: "single_file" | "multi_file" | "analysis_only";
    tasks: {
        type: "analyze" | "test" | "generate" | "edit" | "read" | "write";
        id: string;
        description: string;
        priority: "high" | "medium" | "low";
        dependencies: string[];
        agent: "testbench" | "debug" | "understanding" | "codegen" | "refactoring";
        estimatedDuration?: number | undefined;
    }[];
    estimatedSteps: number;
    confidence: number;
    dependencies?: string[] | undefined;
}>;
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
export type Task = ExecutionPlan['tasks'][number];
export interface GateFlowAgent {
    name: string;
    system: string;
    tools: Record<string, Tool>;
    toolChoice?: 'auto' | 'required' | 'none';
    maxSteps?: number;
}
export declare const AgentRoutingSchema: z.ZodObject<{
    selectedAgent: z.ZodEnum<["understanding", "codegen", "testbench", "debug", "refactoring"]>;
    taskDescription: z.ZodString;
    reasoning: z.ZodString;
}, "strip", z.ZodTypeAny, {
    selectedAgent: "testbench" | "debug" | "understanding" | "codegen" | "refactoring";
    taskDescription: string;
    reasoning: string;
}, {
    selectedAgent: "testbench" | "debug" | "understanding" | "codegen" | "refactoring";
    taskDescription: string;
    reasoning: string;
}>;
export type AgentRouting = z.infer<typeof AgentRoutingSchema>;
export declare const ComplexityDetectionSchema: z.ZodObject<{
    needsMultiAgent: z.ZodBoolean;
    reasoning: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reasoning: string;
    needsMultiAgent: boolean;
}, {
    reasoning: string;
    needsMultiAgent: boolean;
}>;
export type ComplexityDetection = z.infer<typeof ComplexityDetectionSchema>;
export type EventKind = "status" | "thought" | "answer_delta" | "edit" | "sim" | "error" | "done" | "agent_start" | "agent_complete" | "delegation";
export interface AgentStartEvent {
    type: "agent_start";
    agentName: string;
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
    from: string;
    to: string;
    taskType: string;
    taskData: any;
}
/**
 * Match the signature used in root project's SSE streaming
 * Adapted for CLI event system
 */
export type EmitFn = (event: Omit<AgentStartEvent | AgentCompleteEvent | DelegationEvent, 'timestamp'>) => void;
export interface AgentContext {
    files: Map<string, string>;
    errors: any[];
    plan?: ExecutionPlan;
    previousResults: any[];
    projectRoot: string;
}
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
