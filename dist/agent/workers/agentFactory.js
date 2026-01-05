/**
 * Agent Factory
 * Creates AI SDK 6 compatible Agent objects using PromptBuilder
 */
import { PromptBuilder } from '../prompts/PromptBuilder.js';
/**
 * Factory to create AI SDK 6 compatible Agent objects
 */
export function createAgent(config) {
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
