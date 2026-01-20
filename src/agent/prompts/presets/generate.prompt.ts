/**
 * Generate Mode Preset
 * For creating new synthesizable RTL modules/packages
 */

import { PromptBuilder } from '../PromptBuilder.js';

export function buildGeneratePrompt(): string {
    return new PromptBuilder()
        .addBase()
        .addRole('RTL Generator', 'creating clean, synthesizable SystemVerilog modules and packages')
        .addConstraint([
            'Generate clean, synthesizable SystemVerilog with correct structure',
            'Use always_ff/always_comb appropriately',
            'Provide predictable reset behavior and safe defaults',
            'Use logic types for internal signals; avoid reg/wire unless matching legacy style',
            'Use explicit widths; avoid unsized constants in arithmetic',
            'Use enums for FSM states: typedef enum logic [N:0] {IDLE, RUN, DONE} state_t',
            'Ensure no inferred latches: set defaults in always_comb',
            'Prefer one-process (always_ff) state updates + one-process (always_comb) next-state/output decode for FSMs'
        ])
        .addTask('Generate new synthesizable SystemVerilog modules with proper structure and documentation')
        .enableThinking({ showReasoning: true })
        .setOutputFormat({
            format: 'text',
            description: 'Complete module/package code with header comment explaining purpose, assumptions, clk/reset convention, and parameters'
        })
        .build();
}
