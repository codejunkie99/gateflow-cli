/**
 * Planning Agent
 * Decomposes user requests into executable tasks with dependencies
 * Uses AI SDK 6's generateObject for type-safe structured output
 */

import { generateObject } from 'ai';
import { createModelWithVariant } from '../model-provider.js';
import type { ExecutionPlan } from '../../types/agent-shared.js';
import { ExecutionPlanSchema } from '../../types/agent-shared.js';

/**
 * Create an execution plan from a user request
 * Uses generateObject to guarantee type-safe structured output
 */
export async function createPlan(
    userRequest: string,
    projectContext: string = '',
    modelName: string = 'claude-sonnet-4-20250514'
): Promise<ExecutionPlan> {
    // Parse model and get variant options for extended thinking support
    const { model, variantOptions } = createModelWithVariant(modelName);

    // FIX A: Explicitly list valid agents in prompt to avoid 'planning' being assigned
    const { object: plan } = await generateObject({
        model: model as any,
        schema: ExecutionPlanSchema,
        ...variantOptions,
        prompt: `Analyze this request and create an execution plan:

User Request: ${userRequest}

${projectContext ? `Project Context: ${projectContext}` : ''}

Create a plan with tasks in dependency order. Each task should specify which agent handles it.

AVAILABLE AGENTS (use ONLY these):
- understanding: For reading/analyzing existing code and project structure
- codegen: For creating new SystemVerilog modules and RTL code
- testbench: For generating testbenches and verification code
- debug: For diagnosing simulation failures and fixing errors
- refactoring: For modifying existing code

Guidelines:
- Identify dependencies before proposing edits
- Consider compilation order (packages → modules → top)
- Check if files exist before reading
- Break complex tasks into smaller, manageable subtasks
- Estimate confidence for each task
- Prioritize by dependencies (dependent tasks first)

Return a structured plan with:
- planType: 'single_file' | 'multi_file' | 'analysis_only'
- tasks: Array of tasks with id, type, description, priority, dependencies, agent (MUST be one of: understanding, codegen, testbench, debug, refactoring)
- estimatedSteps: Total number of steps
- confidence: Overall confidence (0-1)`
    });
    
    return plan;  // Fully typed, no parsing needed!
}

/**
 * Parse plan from LLM JSON response (fallback if generateObject fails)
 */
export function parsePlan(llmOutput: string): ExecutionPlan {
    try {
        const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in LLM output');
        }
        
        const parsed = JSON.parse(jsonMatch[0]);
        const plan = ExecutionPlanSchema.parse(parsed);
        return plan;
    } catch (error) {
        // Fallback: create simple plan
        return {
            planType: 'analysis_only',
            tasks: [{
                id: 'fallback-1',
                type: 'analyze',
                description: 'Direct analysis requested',
                priority: 'high',
                dependencies: [],
                agent: 'understanding'
            }],
            estimatedSteps: 1,
            confidence: 0.5
        };
    }
}

