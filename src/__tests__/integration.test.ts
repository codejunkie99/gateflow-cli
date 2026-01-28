/**
 * Integration Tests
 * Full flow tests with mock LLM
 */

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../events/bus.js';
import { ThinkingChain } from '../agent/reasoning/ThinkingChain.js';
import { PromptBuilder } from '../agent/prompts/PromptBuilder.js';

describe('Integration Tests', () => {
    describe('ThinkingChain + EventBus', () => {
        it('should emit events when adding steps', () => {
            const bus = new EventBus();
            const chain = new ThinkingChain(bus, { showByDefault: true });
            
            const events: any[] = [];
            bus.subscribe((event) => events.push(event));

            chain.addAnalysisStep('Test step');
            
            expect(events.length).toBeGreaterThan(0);
            expect(events[0].type).toBe('thought');
        });
    });

    describe('PromptBuilder + Presets', () => {
        it('should build general prompt', async () => {
            const { buildGeneralPrompt } = await import('../agent/prompts/presets/general.prompt.js');
            const prompt = buildGeneralPrompt();
            
            expect(prompt).toContain('GateFlow');
            expect(prompt).toContain('Codebase Understanding');
        });

        it('should build lint fix prompt', async () => {
            const { buildLintFixPrompt } = await import('../agent/prompts/presets/lintFix.prompt.js');
            const prompt = buildLintFixPrompt([
                { file: 'test.sv', line: 10, message: 'Error' }
            ]);
            
            expect(prompt).toContain('Syntax Fixer');
            expect(prompt).toContain('Verilator');
        });
    });

    describe('Agent Creation', () => {
        it('should create all specialized agents', async () => {
            const {
                createUnderstandingAgent,
                createCodeGenAgent,
                createTestbenchAgent,
                createDebugAgent,
                createRefactoringAgent
            } = await import('../agent/workers/index.js');

            const mockTools = {};

            const understanding = createUnderstandingAgent(mockTools as any);
            expect(understanding.name).toBe('understanding');
            expect(understanding.system).toContain('Do not write or modify files; describe findings only');

            const codegen = createCodeGenAgent(mockTools as any);
            expect(codegen.name).toBe('codegen');

            const testbench = createTestbenchAgent(mockTools as any);
            expect(testbench.name).toBe('testbench');

            const debug = createDebugAgent(mockTools as any);
            expect(debug.name).toBe('debug');

            const refactoring = createRefactoringAgent(mockTools as any);
            expect(refactoring.name).toBe('refactoring');
        }, 15000);  // Increase timeout for dynamic import of heavy modules
    });
});

