/**
 * Refactoring Agent
 * Modifies existing code with constraints
 * Uses AI SDK 6 Agent interface with edit tools
 */
import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
/**
 * Create refactoring agent with edit tools
 */
export declare function createRefactoringAgent(tools: Record<string, Tool>): GateFlowAgent;
