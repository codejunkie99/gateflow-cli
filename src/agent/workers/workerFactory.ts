/**
 * Worker Factory
 * Creates AI SDK 6 compatible worker profiles using PromptBuilder
 */

import type { Tool } from 'ai';
import type { WorkerProfile } from '../../types/agent-shared.js';
import { PromptBuilder } from '../prompts/PromptBuilder.js';

export interface AgentConfig {
    name: string;
    role: string;
    expertise: string;
    constraints: string[];
    tools: Record<string, Tool>;
    /** Maximum steps for tool loop (used with stopWhen: stepCountIs()) */
    stepLimit?: number;
    toolChoice?: 'auto' | 'required' | 'none';
    /** Optional model override (format: provider/model[:variant]) */
    modelName?: string;
    /** Optional generation overrides for this worker */
    maxOutputTokens?: number;
    temperature?: number;
}

/**
 * Factory to create AI SDK 6 compatible worker profiles
 */
export function createAgent(config: AgentConfig): WorkerProfile {
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
        stepLimit: config.stepLimit ?? 10,
        modelName: config.modelName,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature
    };
}

