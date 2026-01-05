/**
 * Planning Agent
 * Decomposes user requests into executable tasks with dependencies
 * Uses AI SDK 6's generateObject for type-safe structured output
 */
import type { ExecutionPlan } from '../../types/agent-shared.js';
/**
 * Create an execution plan from a user request
 * Uses generateObject to guarantee type-safe structured output
 */
export declare function createPlan(userRequest: string, projectContext?: string): Promise<ExecutionPlan>;
/**
 * Parse plan from LLM JSON response (fallback if generateObject fails)
 */
export declare function parsePlan(llmOutput: string): ExecutionPlan;
