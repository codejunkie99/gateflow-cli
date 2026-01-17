/**
 * Workflow Patterns Tests
 *
 * Tests the workflow pattern implementations for correctness.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    executeChain,
    executeParallel,
    evaluatorOptimizer,
    type ChainStep,
    type EvaluationResult
} from '../agent/workflows/patterns.js';

describe('Workflow Patterns', () => {
    describe('executeChain', () => {
        it('should execute steps in sequence', async () => {
            const steps: ChainStep<number, number>[] = [
                { name: 'add1', execute: async (n) => n + 1 },
                { name: 'double', execute: async (n) => n * 2 },
                { name: 'add10', execute: async (n) => n + 10 }
            ];

            const result = await executeChain(5, steps);

            // 5 + 1 = 6, 6 * 2 = 12, 12 + 10 = 22
            expect(result.success).toBe(true);
            expect(result.output).toBe(22);
        });

        it('should pass validation between steps', async () => {
            const steps: ChainStep<number, number>[] = [
                {
                    name: 'double',
                    execute: async (n) => n * 2,
                    validate: (n) => n < 100 // Must be less than 100
                },
                { name: 'add1', execute: async (n) => n + 1 }
            ];

            // 50 * 2 = 100, validation fails (not < 100)
            const result = await executeChain(50, steps);
            expect(result.success).toBe(false);
            expect(result.output).toBe(100);
        });

        it('should succeed when validation passes', async () => {
            const steps: ChainStep<number, number>[] = [
                {
                    name: 'double',
                    execute: async (n) => n * 2,
                    validate: (n) => n < 100
                },
                { name: 'add1', execute: async (n) => n + 1 }
            ];

            // 10 * 2 = 20, validation passes, 20 + 1 = 21
            const result = await executeChain(10, steps);
            expect(result.success).toBe(true);
            expect(result.output).toBe(21);
        });

        it('should handle errors gracefully', async () => {
            const steps: ChainStep<number, number>[] = [
                { name: 'add1', execute: async (n) => n + 1 },
                { name: 'fail', execute: async () => { throw new Error('Test error'); } },
                { name: 'add10', execute: async (n) => n + 10 }
            ];

            const result = await executeChain(5, steps);
            expect(result.success).toBe(false);
            expect(result.output).toBe(6); // Last successful output
        });
    });

    describe('executeParallel', () => {
        it('should execute tasks in parallel', async () => {
            const executionOrder: string[] = [];

            const tasks = [
                {
                    name: 'fast',
                    execute: async () => {
                        executionOrder.push('fast-start');
                        await new Promise(r => setTimeout(r, 10));
                        executionOrder.push('fast-end');
                        return 'fast-result';
                    }
                },
                {
                    name: 'slow',
                    execute: async () => {
                        executionOrder.push('slow-start');
                        await new Promise(r => setTimeout(r, 50));
                        executionOrder.push('slow-end');
                        return 'slow-result';
                    }
                }
            ];

            const results = await executeParallel(tasks);

            // Both should start before either finishes (parallel execution)
            expect(executionOrder[0]).toBe('fast-start');
            expect(executionOrder[1]).toBe('slow-start');

            expect(results.get('fast')?.success).toBe(true);
            expect(results.get('fast')?.output).toBe('fast-result');
            expect(results.get('slow')?.success).toBe(true);
            expect(results.get('slow')?.output).toBe('slow-result');
        });

        it('should handle individual task failures', async () => {
            const tasks = [
                { name: 'success', execute: async () => 'ok' },
                { name: 'failure', execute: async () => { throw new Error('fail'); } }
            ];

            const results = await executeParallel(tasks);

            expect(results.get('success')?.success).toBe(true);
            expect(results.get('failure')?.success).toBe(false);
        });
    });

    describe('evaluatorOptimizer', () => {
        it('should stop when quality threshold is met', async () => {
            let iterations = 0;

            const result = await evaluatorOptimizer({
                maxIterations: 5,
                qualityThreshold: 8,
                generate: async () => {
                    iterations++;
                    return 'initial';
                },
                evaluate: async (output) => ({
                    qualityScore: 9, // Above threshold
                    meetsThreshold: true,
                    issues: [],
                    suggestions: []
                }),
                improve: async () => 'improved'
            }, 'input');

            expect(result.iterations).toBe(1);
            expect(result.output).toBe('initial');
            expect(result.finalEvaluation.meetsThreshold).toBe(true);
        });

        it('should iterate until quality improves', async () => {
            let callCount = 0;

            const result = await evaluatorOptimizer({
                maxIterations: 5,
                qualityThreshold: 8,
                generate: async () => 'v1',
                evaluate: async (output) => {
                    callCount++;
                    // Quality improves each iteration
                    const score = callCount >= 3 ? 9 : 5;
                    return {
                        qualityScore: score,
                        meetsThreshold: score >= 8,
                        issues: score < 8 ? ['needs improvement'] : [],
                        suggestions: []
                    };
                },
                improve: async (_, __, ___) => `v${callCount + 1}`
            }, 'input');

            expect(result.iterations).toBe(3);
            expect(result.finalEvaluation.qualityScore).toBe(9);
        });

        it('should respect maxIterations', async () => {
            const result = await evaluatorOptimizer({
                maxIterations: 3,
                qualityThreshold: 10, // Never met
                generate: async () => 'initial',
                evaluate: async () => ({
                    qualityScore: 5,
                    meetsThreshold: false,
                    issues: ['always failing'],
                    suggestions: []
                }),
                improve: async (output) => output + '+'
            }, 'input');

            expect(result.iterations).toBe(3);
            expect(result.output).toBe('initial++'); // 2 improvements
        });

        it('should track history', async () => {
            let version = 0;

            const result = await evaluatorOptimizer({
                maxIterations: 3,
                qualityThreshold: 10,
                generate: async () => `v${++version}`,
                evaluate: async (output) => ({
                    qualityScore: version * 2,
                    meetsThreshold: false,
                    issues: [],
                    suggestions: []
                }),
                improve: async () => `v${++version}`
            }, 'input');

            expect(result.history).toHaveLength(3);
            expect(result.history[0].output).toBe('v1');
            expect(result.history[1].output).toBe('v2');
            expect(result.history[2].output).toBe('v3');
        });
    });
});
