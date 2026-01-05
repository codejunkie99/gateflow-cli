/**
 * General Mode Preset
 * Using modular prompt builder instead of monolithic string
 */
import { PromptBuilder } from '../PromptBuilder.js';
export function buildGeneralPrompt() {
    return new PromptBuilder()
        .addBase()
        .addRole('Codebase Understanding Specialist', 'explaining SystemVerilog code, reading files, answering questions')
        .addConstraint([
        'Prefer reading files over guessing',
        'Provide minimal, targeted answers',
        'Use available tools to verify information'
    ])
        .addConditionalConstraint('If code is complex, break down explanation into steps', () => true // Always applicable
    )
        .enableThinking({ showReasoning: true })
        .setOutputFormat({
        format: 'markdown',
        description: 'Clear, concise explanation with code examples if relevant'
    })
        .build();
}
