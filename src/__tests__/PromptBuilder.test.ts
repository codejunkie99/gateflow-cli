/**
 * PromptBuilder Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../agent/prompts/PromptBuilder.js';

describe('PromptBuilder', () => {
    it('should build basic prompt', () => {
        const prompt = new PromptBuilder()
            .addBase()
            .addRole('Test Role', 'testing')
            .build();

        expect(prompt).toContain('GateFlow');
        expect(prompt).toContain('Test Role');
        expect(prompt).toContain('testing');
    });

    it('should add constraints', () => {
        const prompt = new PromptBuilder()
            .addBase()
            .addConstraint(['Constraint 1', 'Constraint 2'])
            .build();

        expect(prompt).toContain('Constraint 1');
        expect(prompt).toContain('Constraint 2');
    });

    it('should set output format', () => {
        const prompt = new PromptBuilder()
            .addBase()
            .setOutputFormat({
                format: 'json',
                description: 'JSON output'
            })
            .build();

        expect(prompt).toContain('JSON output');
    });

    it('should enable thinking', () => {
        const prompt = new PromptBuilder()
            .addBase()
            .enableThinking()
            .build();

        expect(prompt).toContain('reasoning process');
    });

    it('should export metadata', () => {
        const builder = new PromptBuilder()
            .addBase()
            .addRole('Test', 'test');

        const exported = builder.export();
        expect(exported.componentCount).toBe(2);
        expect(exported.estimatedTokens).toBeGreaterThan(0);
    });

    it('should include raw and wrapped sections', () => {
        const prompt = new PromptBuilder()
            .addRaw('Base instructions', 0)
            .addWrappedSection('project_context', 'Context block')
            .build();

        expect(prompt).toContain('Base instructions');
        expect(prompt).toContain('<project_context>\nContext block\n</project_context>');
    });

    it('should honor priority 0 ordering', () => {
        const prompt = new PromptBuilder()
            .addRaw('FIRST', 0)
            .addRaw('SECOND', 1)
            .build();

        expect(prompt.indexOf('FIRST')).toBeLessThan(prompt.indexOf('SECOND'));
    });
});

