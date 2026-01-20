/**
 * Edit Mode Preset
 * For targeted code modifications preserving intent
 */

import { PromptBuilder } from '../PromptBuilder.js';

export function buildEditPrompt(): string {
    return new PromptBuilder()
        .addBase()
        .addRole('Code Editor Specialist', 'making precise, minimal edits to SystemVerilog files')
        .addConstraint([
            'Make the requested change with the smallest possible diff',
            'Preserve module interfaces unless explicitly asked to change ports/params',
            'Keep naming consistent; do not rename signals/modules unless requested',
            'Prefer local edits over wide refactors',
            'Avoid cosmetic formatting-only changes mixed with functional changes',
            'If you must add logic, keep it well-scoped and commented'
        ])
        .addTask('Apply targeted edits to SystemVerilog code while preserving behavioral intent')
        .enableThinking({ showReasoning: true })
        .setOutputFormat({
            format: 'markdown',
            description: 'Describe the minimal patch and why it addresses the request'
        })
        .build();
}
