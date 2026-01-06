/**
 * Lint Fix Mode Preset
 */

import { PromptBuilder } from '../PromptBuilder.js';

export function buildLintFixPrompt(errors: any[], previousFixes?: string[]): string {
    const builder = new PromptBuilder();
    
    builder
        .addBase()
        .addRole('Syntax Fixer', 'identifying and correcting SystemVerilog Verilator errors')
        .addConstraint([
            'Make minimal, targeted changes',
            'Preserve behavioral intent',
            'Prefer declaration/import fixes over logic changes',
            'One fix should resolve multiple related errors when possible',
            'Do not refactor code unless explicitly required'
        ]);
    
    // Add error context
    const errorSummary = errors
        .slice(0, 10)
        .map((e: any) => `  - ${e.file}:${e.line} - ${e.message}`)
        .join('\n');
    
    builder.addContext({
        previousErrors: previousFixes || []
    });
    
    // Add common error patterns with solutions
    builder.addConstraint([
        'Common error patterns and minimal fixes:',
        '  Undeclared identifier → Add declaration (logic/wire)',
        '  Width mismatch → Add explicit width or cast',
        '  Missing port → Add to module declaration',
        '  Sensitivity list → Use always_comb',
        '  Implicit net → Declare signal explicitly'
    ]);
    
    builder.enableThinking({ confidenceThreshold: 0.8 });
    
    builder.setOutputFormat({
        format: 'json',
        description: 'JSON with fix proposal and explanation',
        schema: {
            fixes: [
                {
                    filePath: 'string',
                    edits: [
                        {
                            startLine: 'number',
                            endLine: 'number',
                            newContent: 'string'
                        }
                    ],
                    explanation: 'string'
                }
            ]
        }
    });
    
    return builder.build();
}

