/**
 * Agent Shared Types
 * Ported from shared/agentTypes.ts with AI SDK 6 compatibility
 * Includes Zod schemas for structured outputs
 */
import { z } from 'zod';
// ============= Execution Plan Schema (for generateObject) =============
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
// ============= Routing Schema (for orchestrator) =============
export const AgentRoutingSchema = z.object({
    // FIX A: Remove 'planning' from routing - planning is handled by Orchestrator.executeWithPlan()
    selectedAgent: z.enum(['understanding', 'codegen', 'testbench', 'debug', 'refactoring']),
    taskDescription: z.string(),
    reasoning: z.string()
});
// ============= Complexity Detection Schema =============
export const ComplexityDetectionSchema = z.object({
    needsMultiAgent: z.boolean(),
    reasoning: z.string()
});
