/**
 * Unit tests for loop control functions
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

            // Steps 1-19 should return empty
            for (let step = 1; step < 20; step++) {
                const result = getResult(prepareStep, createStepContext(step));
                expect(result).toEqual({});
            }
        });

        it('should inject warning at warning step (default 20)', () => {
            const prepareStep = continuationWarning();
            const result = getResult(prepareStep, createStepContext(20));

            expect(result.system).toBeDefined();
            expect(result.system).toContain('WARNING');
            expect(result.system).toContain('20/25');
            expect(result.system).toContain('5 remaining');
        });

        it('should inject critical warning at critical step (default 23)', () => {
            const prepareStep = continuationWarning();
            const result = getResult(prepareStep, createStepContext(23));

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

            // Step 9 should return empty
            expect(getResult(prepareStep, createStepContext(9))).toEqual({});

            // Step 10 should trigger warning
            const warning = getResult(prepareStep, createStepContext(10));
            expect(warning.system).toContain('WARNING');
            expect(warning.system).toContain('10/20');

            // Step 15 should trigger critical
            const critical = getResult(prepareStep, createStepContext(15));
            expect(critical.system).toContain('CRITICAL');
            expect(critical.system).toContain('5 steps remaining');
        });

        it('should show correct remaining steps at different thresholds', () => {
            const prepareStep = continuationWarning({ stepLimit: 25 });

            // At step 21: 4 remaining
            const step21 = getResult(prepareStep, createStepContext(21));
            expect(step21.system).toContain('4 remaining');

            // At step 24: 1 step remaining (singular)
            const step24 = getResult(prepareStep, createStepContext(24));
            expect(step24.system).toContain('1 step remaining');
        });

        it('should use singular "step" when only 1 remains', () => {
            const prepareStep = continuationWarning();
            const result = getResult(prepareStep, createStepContext(24));

            expect(result.system).toContain('1 step remaining');
            expect(result.system).not.toContain('1 steps remaining');
        });

        it('should warn in the range between warning and critical', () => {
            const prepareStep = continuationWarning();

            // Steps 20, 21, 22 should show WARNING
            for (let step = 20; step < 23; step++) {
                const result = getResult(prepareStep, createStepContext(step));
                expect(result.system).toContain('WARNING');
                expect(result.system).not.toContain('CRITICAL');
            }
        });

        it('should show CRITICAL at or after critical threshold', () => {
            const prepareStep = continuationWarning();

            // Steps 23, 24, 25 should show CRITICAL
            for (let step = 23; step <= 25; step++) {
                const result = getResult(prepareStep, createStepContext(step));
                expect(result.system).toContain('CRITICAL');
                expect(result.system).not.toContain('WARNING:');
            }
        });

        it('should use default values when config is empty', () => {
            const prepareStep = continuationWarning({});

            // Default warningStep is 20
            expect(getResult(prepareStep, createStepContext(19))).toEqual({});
            expect(getResult(prepareStep, createStepContext(20)).system).toContain('WARNING');

            // Default criticalStep is 23
            expect(getResult(prepareStep, createStepContext(22)).system).toContain('WARNING');
            expect(getResult(prepareStep, createStepContext(23)).system).toContain('CRITICAL');
        });

        it('should never show negative remaining steps', () => {
            const prepareStep = continuationWarning({ stepLimit: 25 });

            // At step 26 (past limit), remaining should be clamped to 0
            const result = getResult(prepareStep, createStepContext(26));
            expect(result.system).toContain('CRITICAL');
            expect(result.system).not.toContain('-1');
            expect(result.system).not.toContain('negative');
        });

        it('should show special message when step limit is reached', () => {
            const prepareStep = continuationWarning({ stepLimit: 25, criticalStep: 23 });

            // At exactly step 25, remaining = 0
            const result = getResult(prepareStep, createStepContext(25));
            expect(result.system).toContain('Step limit reached');
            expect(result.system).toContain('IMMEDIATELY');
            expect(result.system).toContain('25/25');
        });

        it('should show special message when past step limit', () => {
            const prepareStep = continuationWarning({ stepLimit: 25, criticalStep: 23 });

            // At step 30 (well past limit)
            const result = getResult(prepareStep, createStepContext(30));
            expect(result.system).toContain('Step limit reached');
            expect(result.system).toContain('30/25');
            expect(result.system).not.toContain('-5');
        });
    });
});
