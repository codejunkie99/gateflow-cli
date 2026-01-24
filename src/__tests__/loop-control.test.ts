/**
 * Unit tests for loop control functions
 *
 * NOTE: stepNumber is 0-indexed (AI SDK convention), but warningStep/criticalStep/stepLimit
 * are 1-indexed (human-readable). The implementation converts via: currentStep = stepNumber + 1
 */

import { describe, it, expect } from 'vitest';
import { continuationWarning, type StepContext, type StepSettings } from '../agent/loop-control.js';

// Helper to create test contexts
function createStepContext(stepNumber: number): StepContext {
    return {
        stepNumber,
        messages: [],
        model: 'test-model',
        steps: []
    };
}

// Helper to get synchronous result (continuationWarning always returns sync)
function getResult(fn: ReturnType<typeof continuationWarning>, ctx: StepContext): StepSettings {
    return fn(ctx) as StepSettings;
}

describe('Loop Control', () => {
    describe('continuationWarning', () => {
        it('should return empty object for steps before warning threshold', () => {
            const prepareStep = continuationWarning();

            // 0-indexed steps 0-18 (currentStep 1-19) should return empty (warning starts at currentStep 20)
            for (let step = 0; step < 19; step++) {
                const result = getResult(prepareStep, createStepContext(step));
                expect(result).toEqual({});
            }
        });

        it('should inject warning at warning step (default 20)', () => {
            const prepareStep = continuationWarning();
            // stepNumber 19 -> currentStep 20
            const result = getResult(prepareStep, createStepContext(19));

            expect(result.system).toBeDefined();
            expect(result.system).toContain('WARNING');
            expect(result.system).toContain('20/25');
            expect(result.system).toContain('5 remaining');
        });

        it('should inject critical warning at critical step (default 23)', () => {
            const prepareStep = continuationWarning();
            // stepNumber 22 -> currentStep 23
            const result = getResult(prepareStep, createStepContext(22));

            expect(result.system).toBeDefined();
            expect(result.system).toContain('CRITICAL');
            expect(result.system).toContain('2 steps remaining');
            expect(result.system).toContain('MUST use the request_continuation tool NOW');
        });

        it('should use custom thresholds', () => {
            const prepareStep = continuationWarning({
                warningStep: 10,
                criticalStep: 15,
                stepLimit: 20
            });

            // stepNumber 8 -> currentStep 9, should return empty (warning starts at 10)
            expect(getResult(prepareStep, createStepContext(8))).toEqual({});

            // stepNumber 9 -> currentStep 10, should trigger warning
            const warning = getResult(prepareStep, createStepContext(9));
            expect(warning.system).toContain('WARNING');
            expect(warning.system).toContain('10/20');

            // stepNumber 14 -> currentStep 15, should trigger critical
            const critical = getResult(prepareStep, createStepContext(14));
            expect(critical.system).toContain('CRITICAL');
            expect(critical.system).toContain('5 steps remaining');
        });

        it('should show correct remaining steps at different thresholds', () => {
            const prepareStep = continuationWarning({ stepLimit: 25 });

            // stepNumber 20 -> currentStep 21: 4 remaining
            const step21 = getResult(prepareStep, createStepContext(20));
            expect(step21.system).toContain('4 remaining');

            // stepNumber 23 -> currentStep 24: 1 step remaining (singular)
            const step24 = getResult(prepareStep, createStepContext(23));
            expect(step24.system).toContain('1 step remaining');
        });

        it('should use singular "step" when only 1 remains', () => {
            const prepareStep = continuationWarning();
            // stepNumber 23 -> currentStep 24, remaining = 1
            const result = getResult(prepareStep, createStepContext(23));

            expect(result.system).toContain('1 step remaining');
            expect(result.system).not.toContain('1 steps remaining');
        });

        it('should warn in the range between warning and critical', () => {
            const prepareStep = continuationWarning();

            // 0-indexed steps 19, 20, 21 (currentStep 20, 21, 22) should show WARNING
            for (let step = 19; step < 22; step++) {
                const result = getResult(prepareStep, createStepContext(step));
                expect(result.system).toContain('WARNING');
                expect(result.system).not.toContain('CRITICAL');
            }
        });

        it('should show CRITICAL at or after critical threshold', () => {
            const prepareStep = continuationWarning();

            // 0-indexed steps 22, 23, 24 (currentStep 23, 24, 25) should show CRITICAL
            for (let step = 22; step <= 24; step++) {
                const result = getResult(prepareStep, createStepContext(step));
                expect(result.system).toContain('CRITICAL');
                expect(result.system).not.toContain('WARNING:');
            }
        });

        it('should use default values when config is empty', () => {
            const prepareStep = continuationWarning({});

            // Default warningStep is 20
            // stepNumber 18 -> currentStep 19, should be empty
            expect(getResult(prepareStep, createStepContext(18))).toEqual({});
            // stepNumber 19 -> currentStep 20, should trigger warning
            expect(getResult(prepareStep, createStepContext(19)).system).toContain('WARNING');

            // Default criticalStep is 23
            // stepNumber 21 -> currentStep 22, should be warning
            expect(getResult(prepareStep, createStepContext(21)).system).toContain('WARNING');
            // stepNumber 22 -> currentStep 23, should be critical
            expect(getResult(prepareStep, createStepContext(22)).system).toContain('CRITICAL');
        });

        it('should never show negative remaining steps', () => {
            const prepareStep = continuationWarning({ stepLimit: 25 });

            // stepNumber 25 -> currentStep 26 (past limit), remaining should be clamped to 0
            const result = getResult(prepareStep, createStepContext(25));
            expect(result.system).toContain('CRITICAL');
            expect(result.system).not.toContain('-1');
            expect(result.system).not.toContain('negative');
        });

        it('should show special message when step limit is reached', () => {
            const prepareStep = continuationWarning({ stepLimit: 25, criticalStep: 23 });

            // stepNumber 24 -> currentStep 25, remaining = 0
            const result = getResult(prepareStep, createStepContext(24));
            expect(result.system).toContain('Step limit reached');
            expect(result.system).toContain('IMMEDIATELY');
            expect(result.system).toContain('25/25');
        });

        it('should show special message when past step limit', () => {
            const prepareStep = continuationWarning({ stepLimit: 25, criticalStep: 23 });

            // stepNumber 29 -> currentStep 30 (well past limit)
            const result = getResult(prepareStep, createStepContext(29));
            expect(result.system).toContain('Step limit reached');
            expect(result.system).toContain('30/25');
            expect(result.system).not.toContain('-5');
        });
    });
});
