/**
 * GateFlow-Specific Workflow Patterns
 *
 * Domain-specific workflows for SystemVerilog development that compose
 * the generic workflow patterns with GateFlow's specialized tools.
 */

import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { createModelWithVariant } from '../model-provider.js';
import { PromptBuilder } from '../prompts/PromptBuilder.js';
import {
    evaluatorOptimizer,
    executeChain,
    type EvaluationResult,
    type ChainStep
} from './patterns.js';

// ============================================================================
// Types
// ============================================================================

export interface LintFixResult {
    /** Final fixed code */
    code: string;
    /** Original code before fixes */
    originalCode: string;
    /** Number of fix iterations */
    iterations: number;
    /** Remaining errors after all iterations */
    remainingErrors: string[];
    /** All fixes applied */
    fixesApplied: string[];
    /** Whether lint now passes */
    lintPasses: boolean;
}

export interface ModuleGenerationResult {
    /** Generated module code */
    moduleCode: string;
    /** Module name */
    moduleName: string;
    /** Ports defined */
    ports: Array<{ name: string; direction: 'input' | 'output' | 'inout'; width?: number }>;
    /** Quality evaluation */
    quality: {
        score: number;
        synthesizable: boolean;
        wellDocumented: boolean;
        followsConventions: boolean;
    };
    /** Iterations to reach quality */
    iterations: number;
}

export interface TestbenchResult {
    /** Generated testbench code */
    testbenchCode: string;
    /** DUT module name */
    dutName: string;
    /** Test scenarios included */
    testScenarios: string[];
    /** Coverage estimate */
    coverageEstimate: 'low' | 'medium' | 'high';
    /** Quality evaluation */
    quality: EvaluationResult;
}

// ============================================================================
// Lint-Fix Workflow (Evaluator-Optimizer Pattern)
// ============================================================================

/**
 * Iteratively fix lint errors using the evaluator-optimizer pattern.
 *
 * @example
 * const result = await lintFixWorkflow(brokenCode, lintErrors, {
 *   maxIterations: 5,
 *   lintFunction: async (code) => runVerilator(code)
 * });
 */
export async function lintFixWorkflow(
    code: string,
    initialErrors: string[],
    config: {
        model?: string;
        maxIterations?: number;
        lintFunction: (code: string) => Promise<{ errors: string[]; warnings: string[] }>;
    }
): Promise<LintFixResult> {
    const {
        model = 'claude-sonnet-4-20250514',
        maxIterations = 5,
        lintFunction
    } = config;

    const { model: client, variantOptions } = createModelWithVariant(model);
    const fixesApplied: string[] = [];
    const originalCode = code;

    const result = await evaluatorOptimizer<string>(
        {
            maxIterations,
            qualityThreshold: 10, // 10 = no errors

            generate: async () => {
                const systemPrompt = new PromptBuilder()
                    .addRaw(`You are an expert SystemVerilog engineer fixing lint errors.
Fix the code to resolve the errors. Return ONLY the fixed code, no explanations.`)
                    .build();
                const prompt = new PromptBuilder()
                    .addRaw(`Fix these lint errors in the code:

Errors:
${initialErrors.map(e => `- ${e}`).join('\n')}

Code:
\`\`\`systemverilog
${code}
\`\`\``)
                    .build();

                // Initial fix attempt
                const { text: fixedCode } = await generateText({
                    model: client as any,
                    system: systemPrompt,
                    prompt,
                    ...variantOptions
                });

                // Extract code from markdown if present
                const codeMatch = fixedCode.match(/```(?:systemverilog|sv|verilog)?\n?([\s\S]*?)```/);
                const extracted = codeMatch ? codeMatch[1].trim() : fixedCode.trim();
                fixesApplied.push('Initial fix attempt');
                return extracted;
            },

            evaluate: async (fixedCode) => {
                const lintResult = await lintFunction(fixedCode);
                const totalIssues = lintResult.errors.length;

                return {
                    qualityScore: totalIssues === 0 ? 10 : Math.max(1, 10 - totalIssues),
                    meetsThreshold: totalIssues === 0,
                    issues: lintResult.errors,
                    suggestions: lintResult.warnings
                };
            },

            improve: async (currentCode, evaluation) => {
                const systemPrompt = new PromptBuilder()
                    .addRaw(`You are an expert SystemVerilog engineer fixing lint errors.
Fix the remaining errors. Return ONLY the fixed code, no explanations.`)
                    .build();
                const prompt = new PromptBuilder()
                    .addRaw(`Fix these remaining lint errors:

Errors:
${evaluation.issues.map(e => `- ${e}`).join('\n')}

Current code:
\`\`\`systemverilog
${currentCode}
\`\`\``)
                    .build();

                const { text: improvedCode } = await generateText({
                    model: client as any,
                    system: systemPrompt,
                    prompt,
                    ...variantOptions
                });

                const codeMatch = improvedCode.match(/```(?:systemverilog|sv|verilog)?\n?([\s\S]*?)```/);
                const extracted = codeMatch ? codeMatch[1].trim() : improvedCode.trim();
                fixesApplied.push(`Fix iteration: ${evaluation.issues.length} errors`);
                return extracted;
            }
        },
        code
    );

    return {
        code: result.output,
        originalCode,
        iterations: result.iterations,
        remainingErrors: result.finalEvaluation.issues,
        fixesApplied,
        lintPasses: result.finalEvaluation.meetsThreshold
    };
}

// ============================================================================
// Module Generation Workflow (Chain + Evaluator Pattern)
// ============================================================================

/**
 * Generate a SystemVerilog module with quality checking and improvement.
 *
 * @example
 * const result = await moduleGenerationWorkflow({
 *   moduleName: 'fifo',
 *   description: 'A synchronous FIFO with configurable depth',
 *   ports: [{ name: 'clk', direction: 'input' }, ...]
 * });
 */
export async function moduleGenerationWorkflow(
    spec: {
        moduleName: string;
        description: string;
        ports?: Array<{ name: string; direction: 'input' | 'output' | 'inout'; width?: number }>;
        parameters?: Array<{ name: string; defaultValue: string }>;
    },
    config?: {
        model?: string;
        maxIterations?: number;
        qualityThreshold?: number;
    }
): Promise<ModuleGenerationResult> {
    const {
        model = 'claude-sonnet-4-20250514',
        maxIterations = 3,
        qualityThreshold = 8
    } = config ?? {};

    const { model: client, variantOptions } = createModelWithVariant(model);

    const QualitySchema = z.object({
        score: z.number().min(1).max(10),
        synthesizable: z.boolean(),
        wellDocumented: z.boolean(),
        followsConventions: z.boolean(),
        issues: z.array(z.string()),
        suggestions: z.array(z.string())
    });

    // Build port specification
    const portSpec = spec.ports
        ? spec.ports.map(p => {
            const width = p.width && p.width > 1 ? `[${p.width - 1}:0]` : '';
            return `${p.direction} ${width} ${p.name}`.trim();
        }).join(', ')
        : 'to be determined based on description';

    const paramSpec = spec.parameters
        ? spec.parameters.map(p => `parameter ${p.name} = ${p.defaultValue}`).join(', ')
        : '';

    const result = await evaluatorOptimizer<string>(
        {
            maxIterations,
            qualityThreshold,

            generate: async () => {
                const systemPrompt = new PromptBuilder()
                    .addRaw(`You are an expert SystemVerilog engineer. Generate synthesizable, well-documented modules.
Follow IEEE 1800-2017 standard. Use meaningful signal names and include comments.`)
                    .build();
                const prompt = new PromptBuilder()
                    .addRaw(`Generate a SystemVerilog module with these specifications:

Module name: ${spec.moduleName}
Description: ${spec.description}
Ports: ${portSpec}
${paramSpec ? `Parameters: ${paramSpec}` : ''}

Return ONLY the module code, no explanations.`)
                    .build();

                const { text: moduleCode } = await generateText({
                    model: client as any,
                    system: systemPrompt,
                    prompt,
                    ...variantOptions
                });

                const codeMatch = moduleCode.match(/```(?:systemverilog|sv|verilog)?\n?([\s\S]*?)```/);
                return codeMatch ? codeMatch[1].trim() : moduleCode.trim();
            },

            evaluate: async (code) => {
                const systemPrompt = new PromptBuilder()
                    .addRaw('You are an expert SystemVerilog reviewer evaluating module quality.')
                    .build();
                const prompt = new PromptBuilder()
                    .addRaw(`Evaluate this SystemVerilog module:

\`\`\`systemverilog
${code}
\`\`\`

Consider:
1. Is it synthesizable? (no unsynthesizable constructs)
2. Is it well documented? (comments, parameter descriptions)
3. Does it follow conventions? (naming, coding style)
4. Overall quality (1-10)`)
                    .build();

                const { object } = await generateObject({
                    model: client as any,
                    schema: QualitySchema,
                    system: systemPrompt,
                    prompt,
                    ...variantOptions
                });

                return {
                    qualityScore: object.score,
                    meetsThreshold:
                        object.score >= qualityThreshold &&
                        object.synthesizable &&
                        object.wellDocumented &&
                        object.followsConventions,
                    issues: object.issues,
                    suggestions: object.suggestions
                };
            },

            improve: async (code, evaluation) => {
                const systemPrompt = new PromptBuilder()
                    .addRaw('You are an expert SystemVerilog engineer improving module quality.')
                    .build();
                const prompt = new PromptBuilder()
                    .addRaw(`Improve this SystemVerilog module based on feedback:

Current code:
\`\`\`systemverilog
${code}
\`\`\`

Issues to fix:
${evaluation.issues.map(i => `- ${i}`).join('\n')}

Suggestions:
${evaluation.suggestions.map(s => `- ${s}`).join('\n')}

Return ONLY the improved code.`)
                    .build();

                const { text: improvedCode } = await generateText({
                    model: client as any,
                    system: systemPrompt,
                    prompt,
                    ...variantOptions
                });

                const codeMatch = improvedCode.match(/```(?:systemverilog|sv|verilog)?\n?([\s\S]*?)```/);
                return codeMatch ? codeMatch[1].trim() : improvedCode.trim();
            }
        },
        spec.description
    );

    // Extract port information from generated code
    const ports = extractPorts(result.output);

    return {
        moduleCode: result.output,
        moduleName: spec.moduleName,
        ports,
        quality: {
            score: result.finalEvaluation.qualityScore,
            synthesizable: result.finalEvaluation.issues.every(i => !i.toLowerCase().includes('synthesiz')),
            wellDocumented: result.finalEvaluation.issues.every(i => !i.toLowerCase().includes('document')),
            followsConventions: result.finalEvaluation.issues.every(i => !i.toLowerCase().includes('convention'))
        },
        iterations: result.iterations
    };
}

/**
 * Extract port information from SystemVerilog code
 */
function extractPorts(code: string): Array<{ name: string; direction: 'input' | 'output' | 'inout'; width?: number }> {
    const ports: Array<{ name: string; direction: 'input' | 'output' | 'inout'; width?: number }> = [];

    // Match port declarations in module header or body
    const portPattern = /\b(input|output|inout)\s+(?:logic\s+)?(?:\[(\d+):(\d+)\]\s+)?(\w+)/g;
    let match: RegExpExecArray | null;

    while ((match = portPattern.exec(code)) !== null) {
        const direction = match[1] as 'input' | 'output' | 'inout';
        const msb = match[2] ? parseInt(match[2], 10) : undefined;
        const lsb = match[3] ? parseInt(match[3], 10) : undefined;
        const name = match[4];

        ports.push({
            name,
            direction,
            width: msb !== undefined && lsb !== undefined ? msb - lsb + 1 : 1
        });
    }

    return ports;
}

// ============================================================================
// Testbench Generation Workflow (Sequential Chain)
// ============================================================================

/**
 * Generate a comprehensive testbench using a sequential chain.
 *
 * @example
 * const result = await testbenchWorkflow(moduleCode, {
 *   moduleName: 'fifo',
 *   testScenarios: ['reset', 'overflow', 'underflow']
 * });
 */
export async function testbenchWorkflow(
    moduleCode: string,
    config: {
        moduleName: string;
        testScenarios?: string[];
        model?: string;
    }
): Promise<TestbenchResult> {
    const {
        moduleName,
        testScenarios: requestedScenarios,
        model = 'claude-sonnet-4-20250514'
    } = config;

    const { model: client, variantOptions } = createModelWithVariant(model);

    // Step 1: Analyze the module
    interface AnalysisResult {
        ports: Array<{ name: string; direction: string; width: number }>;
        parameters: string[];
        functionality: string;
        suggestedScenarios: string[];
    }

    // Step 2: Plan test scenarios
    interface PlanResult {
        scenarios: string[];
        coverageGoals: string[];
    }

    // Step 3: Generate testbench
    interface GenerationResult {
        code: string;
        scenarios: string[];
    }

    // Define the chain
    const steps: ChainStep<any, any>[] = [
        {
            name: 'analyze',
            execute: async (_: string): Promise<AnalysisResult> => {
                const systemPrompt = new PromptBuilder()
                    .addRaw('You are analyzing a SystemVerilog module for testbench generation.')
                    .build();
                const prompt = new PromptBuilder()
                    .addRaw(`Analyze this module and suggest test scenarios:

\`\`\`systemverilog
${moduleCode}
\`\`\`

Identify:
1. All ports with directions and widths
2. Parameters
3. Core functionality
4. Recommended test scenarios for thorough verification`)
                    .build();

                const { object } = await generateObject({
                    model: client as any,
                    schema: z.object({
                        ports: z.array(z.object({
                            name: z.string(),
                            direction: z.string(),
                            width: z.number()
                        })),
                        parameters: z.array(z.string()),
                        functionality: z.string(),
                        suggestedScenarios: z.array(z.string())
                    }),
                    system: systemPrompt,
                    prompt,
                    ...variantOptions
                });
                return object;
            }
        },
        {
            name: 'plan',
            execute: async (analysis: AnalysisResult): Promise<PlanResult> => {
                const scenarios = requestedScenarios?.length
                    ? requestedScenarios
                    : analysis.suggestedScenarios;

                return {
                    scenarios,
                    coverageGoals: [
                        'All ports exercised',
                        'Edge cases tested',
                        'Reset behavior verified',
                        ...scenarios.map(s => `Scenario: ${s}`)
                    ]
                };
            }
        },
        {
            name: 'generate',
            execute: async (plan: PlanResult): Promise<GenerationResult> => {
                const systemPrompt = new PromptBuilder()
                    .addRaw(`You are an expert SystemVerilog verification engineer.
Generate comprehensive, self-checking testbenches with clear assertions.`)
                    .build();
                const prompt = new PromptBuilder()
                    .addRaw(`Generate a testbench for module "${moduleName}":

Module code:
\`\`\`systemverilog
${moduleCode}
\`\`\`

Required test scenarios:
${plan.scenarios.map(s => `- ${s}`).join('\n')}

Coverage goals:
${plan.coverageGoals.map(g => `- ${g}`).join('\n')}

Include:
1. Clock and reset generation
2. DUT instantiation
3. Test tasks for each scenario
4. Self-checking assertions
5. Coverage points

Return ONLY the testbench code.`)
                    .build();

                const { text: tbCode } = await generateText({
                    model: client as any,
                    system: systemPrompt,
                    prompt,
                    ...variantOptions
                });

                const codeMatch = tbCode.match(/```(?:systemverilog|sv|verilog)?\n?([\s\S]*?)```/);
                return {
                    code: codeMatch ? codeMatch[1].trim() : tbCode.trim(),
                    scenarios: plan.scenarios
                };
            }
        }
    ];

    const chainResult = await executeChain(moduleCode, steps);

    if (!chainResult.success) {
        throw new Error('Testbench generation chain failed');
    }

    // The chain transforms string -> AnalysisResult -> PlanResult -> GenerationResult
    const generationResult = chainResult.output as unknown as GenerationResult;

    // Evaluate the testbench quality
    const systemPrompt = new PromptBuilder()
        .addRaw('You are evaluating SystemVerilog testbench quality.')
        .build();
    const prompt = new PromptBuilder()
        .addRaw(`Evaluate this testbench:

\`\`\`systemverilog
${generationResult.code}
\`\`\`

Consider:
1. Coverage of test scenarios
2. Self-checking capability
3. Code quality
4. Completeness`)
        .build();
    const { object: evaluation } = await generateObject({
        model: client as any,
        schema: z.object({
            qualityScore: z.number().min(1).max(10),
            coverageEstimate: z.enum(['low', 'medium', 'high']),
            issues: z.array(z.string()),
            suggestions: z.array(z.string())
        }),
        system: systemPrompt,
        prompt,
        ...variantOptions
    });

    return {
        testbenchCode: generationResult.code,
        dutName: moduleName,
        testScenarios: generationResult.scenarios,
        coverageEstimate: evaluation.coverageEstimate,
        quality: {
            qualityScore: evaluation.qualityScore,
            meetsThreshold: evaluation.qualityScore >= 7,
            issues: evaluation.issues,
            suggestions: evaluation.suggestions
        }
    };
}
