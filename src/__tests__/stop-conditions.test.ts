/**
 * Unit tests for enhanced stop conditions
 */

import { describe, it, expect } from 'vitest';
import {
    stopWhenAny,
    stopWhenAll,
    tokenBudgetExhausted,
    completionTokensExceeded,
    toolResultMatches,
    anyToolResultMatches,
    toolCallCountExceeded,
    lintPasses,
    simulationPasses,
    fileWritten,
    neverStop,
    alwaysStop,
    durationExceeded,
    createModeStopCondition,
    type StopConditionContext
} from '../agent/stop-conditions.js';

// Helper to create test contexts
function createContext(overrides: Partial<StopConditionContext> = {}): StopConditionContext {
    return {
        steps: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        ...overrides
    };
}

describe('Stop Conditions', () => {
    describe('stopWhenAny', () => {
        it('should return true when any condition is true', () => {
            const condition = stopWhenAny(
                () => false,
                () => true,
                () => false
            );
            expect(condition(createContext())).toBe(true);
        });

        it('should return false when all conditions are false', () => {
            const condition = stopWhenAny(
                () => false,
                () => false
            );
            expect(condition(createContext())).toBe(false);
        });

        it('should work with single condition', () => {
            const condition = stopWhenAny(() => true);
            expect(condition(createContext())).toBe(true);
        });
    });

    describe('stopWhenAll', () => {
        it('should return true only when all conditions are true', () => {
            const condition = stopWhenAll(
                () => true,
                () => true,
                () => true
            );
            expect(condition(createContext())).toBe(true);
        });

        it('should return false when any condition is false', () => {
            const condition = stopWhenAll(
                () => true,
                () => false,
                () => true
            );
            expect(condition(createContext())).toBe(false);
        });
    });

    describe('tokenBudgetExhausted', () => {
        it('should return true when accumulated tokens exceed budget', () => {
            const condition = tokenBudgetExhausted(1000);
            const context = createContext({
                steps: [
                    { usage: { totalTokens: 600 } },
                    { usage: { totalTokens: 500 } }
                ]
            });
            expect(condition(context)).toBe(true); // 1100 >= 1000
        });

        it('should return false when accumulated tokens are within budget', () => {
            const condition = tokenBudgetExhausted(1000);
            const context = createContext({
                steps: [
                    { usage: { totalTokens: 300 } },
                    { usage: { totalTokens: 200 } }
                ]
            });
            expect(condition(context)).toBe(false); // 500 < 1000
        });

        it('should return true when accumulated tokens equal budget', () => {
            const condition = tokenBudgetExhausted(1000);
            const context = createContext({
                steps: [
                    { usage: { totalTokens: 500 } },
                    { usage: { totalTokens: 500 } }
                ]
            });
            expect(condition(context)).toBe(true); // 1000 >= 1000
        });

        it('should handle empty steps array', () => {
            const condition = tokenBudgetExhausted(1000);
            const context = createContext({ steps: [] });
            expect(condition(context)).toBe(false); // 0 < 1000
        });

        it('should handle steps with missing usage', () => {
            const condition = tokenBudgetExhausted(1000);
            const context = createContext({
                steps: [
                    { usage: { totalTokens: 600 } },
                    { usage: undefined },
                    { usage: { totalTokens: 300 } }
                ]
            });
            expect(condition(context)).toBe(false); // 900 < 1000
        });
    });

    describe('completionTokensExceeded', () => {
        it('should check completion tokens specifically', () => {
            const condition = completionTokensExceeded(500);
            const context = createContext({
                steps: [{ usage: { completionTokens: 600, promptTokens: 200, totalTokens: 800 } }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should not trigger on prompt tokens', () => {
            const condition = completionTokensExceeded(500);
            const context = createContext({
                steps: [{ usage: { completionTokens: 100, promptTokens: 600, totalTokens: 700 } }]
            });
            expect(condition(context)).toBe(false);
        });

        it('should accumulate completion tokens across multiple steps', () => {
            const condition = completionTokensExceeded(500);
            const context = createContext({
                steps: [
                    { usage: { completionTokens: 200 } },
                    { usage: { completionTokens: 200 } },
                    { usage: { completionTokens: 150 } }
                ]
            });
            expect(condition(context)).toBe(true); // 550 >= 500
        });
    });

    describe('toolResultMatches', () => {
        it('should match tool results by name', () => {
            const condition = toolResultMatches('lint_file', (result: any) =>
                result?.errorCount === 0
            );
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 0 } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should check the most recent result', () => {
            const condition = toolResultMatches('lint_file', (result: any) =>
                result?.errorCount === 0
            );
            const context = createContext({
                steps: [
                    {
                        toolResults: [
                            { toolName: 'lint_file', result: { errorCount: 5 } }
                        ]
                    },
                    {
                        toolResults: [
                            { toolName: 'lint_file', result: { errorCount: 0 } }
                        ]
                    }
                ]
            });
            expect(condition(context)).toBe(true);
        });

        it('should return false when tool not found', () => {
            const condition = toolResultMatches('lint_file', () => true);
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'other_tool', result: {} }
                    ]
                }]
            });
            expect(condition(context)).toBe(false);
        });

        it('should return false when no steps', () => {
            const condition = toolResultMatches('lint_file', () => true);
            expect(condition(createContext())).toBe(false);
        });
    });

    describe('anyToolResultMatches', () => {
        it('should match any tool result', () => {
            const condition = anyToolResultMatches((toolName, result: any) =>
                result?.success === true
            );
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'some_tool', result: { success: true } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should provide tool name to predicate', () => {
            const condition = anyToolResultMatches((toolName, result) =>
                toolName === 'specific_tool'
            );
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'specific_tool', result: {} }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });
    });

    describe('toolCallCountExceeded', () => {
        it('should count tool calls', () => {
            const condition = toolCallCountExceeded('write_file', 3);
            const context = createContext({
                steps: [
                    { toolCalls: [{ toolName: 'write_file', args: {} }] },
                    { toolCalls: [{ toolName: 'write_file', args: {} }] },
                    { toolCalls: [{ toolName: 'write_file', args: {} }] }
                ]
            });
            expect(condition(context)).toBe(true);
        });

        it('should not count other tools', () => {
            const condition = toolCallCountExceeded('write_file', 3);
            const context = createContext({
                steps: [
                    { toolCalls: [{ toolName: 'read_file', args: {} }] },
                    { toolCalls: [{ toolName: 'read_file', args: {} }] },
                    { toolCalls: [{ toolName: 'write_file', args: {} }] }
                ]
            });
            expect(condition(context)).toBe(false);
        });
    });

    describe('lintPasses', () => {
        it('should return true when lint has zero errors and warnings', () => {
            const condition = lintPasses();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 0, warningCount: 0 } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should return true when lint has zero errors and no warning count', () => {
            const condition = lintPasses();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 0 } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should return false when lint has errors', () => {
            const condition = lintPasses();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 2, warningCount: 0 } }
                    ]
                }]
            });
            expect(condition(context)).toBe(false);
        });

        it('should return false when lint has warnings', () => {
            const condition = lintPasses();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 0, warningCount: 3 } }
                    ]
                }]
            });
            expect(condition(context)).toBe(false);
        });
    });

    describe('simulationPasses', () => {
        it('should return true when simulation succeeds', () => {
            const condition = simulationPasses();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'run_simulation', result: { success: true } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should also check passed property', () => {
            const condition = simulationPasses();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'run_simulation', result: { passed: true } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should return false when simulation fails', () => {
            const condition = simulationPasses();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'run_simulation', result: { success: false } }
                    ]
                }]
            });
            expect(condition(context)).toBe(false);
        });
    });

    describe('fileWritten', () => {
        it('should return true when file is written', () => {
            const condition = fileWritten();
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'write_file', result: { success: true, path: 'test.sv' } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should check specific file path', () => {
            const condition = fileWritten('specific.sv');
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'write_file', result: { success: true, path: 'specific.sv' } }
                    ]
                }]
            });
            expect(condition(context)).toBe(true);
        });

        it('should return false for wrong file path', () => {
            const condition = fileWritten('specific.sv');
            const context = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'write_file', result: { success: true, path: 'other.sv' } }
                    ]
                }]
            });
            expect(condition(context)).toBe(false);
        });
    });

    describe('neverStop and alwaysStop', () => {
        it('neverStop should always return false', () => {
            const condition = neverStop();
            expect(condition(createContext())).toBe(false);
            expect(condition(createContext({ usage: { totalTokens: 999999 } }))).toBe(false);
        });

        it('alwaysStop should always return true', () => {
            const condition = alwaysStop();
            expect(condition(createContext())).toBe(true);
        });
    });

    describe('durationExceeded', () => {
        it('should return true when duration exceeded', () => {
            const startTime = Date.now() - 5000; // 5 seconds ago
            const condition = durationExceeded(1000, startTime); // 1 second limit
            expect(condition(createContext())).toBe(true);
        });

        it('should return false within duration', () => {
            const startTime = Date.now();
            const condition = durationExceeded(10000, startTime); // 10 second limit
            expect(condition(createContext())).toBe(false);
        });
    });

    describe('createModeStopCondition', () => {
        it('should create condition for lint_fix mode', () => {
            const condition = createModeStopCondition({ mode: 'lint_fix', stepLimit: 10 });

            // Should stop when lint passes
            const passingContext = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 0, warningCount: 0 } }
                    ]
                }]
            });
            expect(condition(passingContext)).toBe(true);

            // Should not stop when lint has errors
            const failingContext = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 2 } }
                    ]
                }]
            });
            expect(condition(failingContext)).toBe(false);
        });

        it('should create condition for testbench mode', () => {
            const condition = createModeStopCondition({ mode: 'testbench', stepLimit: 10 });

            // Should stop when simulation passes
            const passingContext = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'run_simulation', result: { success: true } }
                    ]
                }]
            });
            expect(condition(passingContext)).toBe(true);
        });

        it('should create basic condition for general mode', () => {
            const condition = createModeStopCondition({ mode: 'general', stepLimit: 10 });
            // General mode uses stepCountIs which we can't easily test here
            // but we can verify it returns a function
            expect(typeof condition).toBe('function');
        });
    });

    describe('composition patterns', () => {
        it('should combine conditions with OR and AND', () => {
            // Stop when either: (token budget AND step limit) OR lint passes
            const complexCondition = stopWhenAny(
                stopWhenAll(
                    tokenBudgetExhausted(1000),
                    () => true // simulating step limit
                ),
                lintPasses()
            );

            // Should stop when lint passes
            const lintPassContext = createContext({
                steps: [{
                    toolResults: [
                        { toolName: 'lint_file', result: { errorCount: 0 } }
                    ]
                }]
            });
            expect(complexCondition(lintPassContext)).toBe(true);

            // Should stop when token budget exceeded (via accumulated steps)
            const budgetContext = createContext({
                steps: [
                    { usage: { totalTokens: 800 } },
                    { usage: { totalTokens: 700 } }
                ]
            });
            expect(complexCondition(budgetContext)).toBe(true); // 1500 >= 1000

            // Should not stop when only token budget hit (not AND condition)
            const onlyBudgetCondition = stopWhenAll(
                tokenBudgetExhausted(1000),
                () => false // step limit not hit
            );
            expect(onlyBudgetCondition(budgetContext)).toBe(false);
        });
    });
});
