/**
 * Agent Factory
 * Creates AI SDK 6 compatible Agent objects using PromptBuilder
 */
import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
export interface AgentConfig {
    name: string;
    role: string;
    expertise: string;
    constraints: string[];
    tools: Record<string, Tool>;
    maxSteps?: number;
    toolChoice?: 'auto' | 'required' | 'none';
}
/**
 * Factory to create AI SDK 6 compatible Agent objects
 */
export declare function createAgent(config: AgentConfig): GateFlowAgent;
