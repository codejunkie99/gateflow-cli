/**
 * ThinkingChain Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ThinkingChain } from '../agent/reasoning/ThinkingChain.js';
import { EventBus } from '../events/bus.js';

describe('ThinkingChain', () => {
    let bus: EventBus;
    let chain: ThinkingChain;

    beforeEach(() => {
        bus = new EventBus();
        chain = new ThinkingChain(bus, { showByDefault: true });
    });

    it('should add analysis step', () => {
        chain.addAnalysisStep('Analyzing code', { file: 'test.sv' }, 0.9);
        const steps = chain.getSteps();
        expect(steps.length).toBe(1);
        expect(steps[0].type).toBe('analyzing');
        expect(steps[0].thought).toBe('Analyzing code');
    });

    it('should add planning step', () => {
        chain.addPlanningStep('Creating plan', { tasks: 3 }, 0.95);
        const steps = chain.getSteps();
        expect(steps.length).toBe(1);
        expect(steps[0].type).toBe('planning');
    });

    it('should increment step numbers', () => {
        chain.addAnalysisStep('Step 1');
        chain.addPlanningStep('Step 2');
        chain.addGeneratingStep('Step 3');

        const steps = chain.getSteps();
        expect(steps[0].stepNumber).toBe(1);
        expect(steps[1].stepNumber).toBe(2);
        expect(steps[2].stepNumber).toBe(3);
    });

    it('should get summary', () => {
        chain.addAnalysisStep('Analyze');
        chain.addPlanningStep('Plan');
        chain.addGeneratingStep('Generate');

        const summary = chain.getSummary();
        expect(summary.totalSteps).toBe(3);
        expect(summary.stepsByCategory.analyzing).toBe(1);
        expect(summary.stepsByCategory.planning).toBe(1);
        expect(summary.stepsByCategory.generating).toBe(1);
    });

    it('should clear steps', () => {
        chain.addAnalysisStep('Step 1');
        chain.clear();
        expect(chain.getSteps().length).toBe(0);
    });
});

