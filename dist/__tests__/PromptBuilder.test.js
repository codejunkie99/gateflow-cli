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
});
