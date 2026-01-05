/**
 * Integration Tests
 * Full flow tests with mock LLM
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../events/bus.js';
import { ThinkingChain } from '../agent/reasoning/ThinkingChain.js';
describe('Integration Tests', () => {
    describe('ThinkingChain + EventBus', () => {
        it('should emit events when adding steps', () => {
            const bus = new EventBus();
            const chain = new ThinkingChain(bus, { showByDefault: true });
            const events = [];
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
            const { createUnderstandingAgent, createCodeGenAgent, createTestbenchAgent, createDebugAgent, createRefactoringAgent } = await import('../agent/specialized/index.js');
            const mockTools = {};
            const understanding = createUnderstandingAgent(mockTools);
            expect(understanding.name).toBe('understanding');
            const codegen = createCodeGenAgent(mockTools);
            expect(codegen.name).toBe('codegen');
            const testbench = createTestbenchAgent(mockTools);
            expect(testbench.name).toBe('testbench');
            const debug = createDebugAgent(mockTools);
            expect(debug.name).toBe('debug');
            const refactoring = createRefactoringAgent(mockTools);
            expect(refactoring.name).toBe('refactoring');
        });
    });
});
