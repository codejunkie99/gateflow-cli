/**
 * Agent Factory
 * Creates AI SDK 6 compatible Agent objects using PromptBuilder
 */

import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
import { PromptBuilder } from '../prompts/PromptBuilder.js';

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
export function createAgent(config: AgentConfig): GateFlowAgent {
    const system = new PromptBuilder()
        .addBase('GateFlow')
        .addRole(config.role, config.expertise)
        .addConstraint(config.constraints)
        .enableThinking({ showReasoning: true })
        .build();

    return {
        name: config.name,
        system,
        tools: config.tools,
        toolChoice: config.toolChoice ?? 'auto',
        maxSteps: config.maxSteps ?? 10
    };
}

