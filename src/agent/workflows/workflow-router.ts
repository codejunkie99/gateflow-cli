/**
 * Workflow Router
 *
 * Automatically selects and executes the appropriate workflow pattern
 * based on the user's request. Integrates with GateFlowAgent.
 */

import { generateText } from 'ai';
import { z } from 'zod';
import { createModelWithVariant, generateStructured } from '../model-provider.js';
import { PromptBuilder } from '../prompts/PromptBuilder.js';
import {
    executeChain,
    executeParallel,
    evaluatorOptimizer,
    parallelReview,
    codeReviewWorkflow,
    type ChainStep,
    type EvaluationResult
} from './patterns.js';
import {
    lintFixWorkflow,
    moduleGenerationWorkflow,
    testbenchWorkflow,
    type LintFixResult,
    type ModuleGenerationResult,
    type TestbenchResult
} from './gateflow-workflows.js';

// ============================================================================
// Types
// ============================================================================

export type WorkflowType =
    | 'lint_fix'           // Iterative lint fixing
    | 'module_generation'  // Generate SV module with quality checks
    | 'testbench'          // Generate testbench
    | 'code_review'        // Parallel multi-aspect review
    | 'iterative_improve'  // Generic improve-until-good loop
    | 'sequential_steps'   // Step-by-step execution
    | 'parallel_analysis'  // Analyze from multiple angles
    | 'simple_generation'; // One-shot generation (no special pattern)

export interface WorkflowSelection {
    workflow: WorkflowType;
    confidence: number;
    reasoning: string;
    extractedParams: {
        moduleName?: string;
        filePath?: string;
        errors?: string[];
        testScenarios?: string[];
        reviewAspects?: string[];
        qualityThreshold?: number;
    };
}

export interface WorkflowResult {
    workflow: WorkflowType;
    success: boolean;
    output: string;
    details?: LintFixResult | ModuleGenerationResult | TestbenchResult | unknown;
    iterations?: number;
}

export interface WorkflowContext {
    /** Function to run lint on code */
    lintFunction?: (code: string) => Promise<{ errors: string[]; warnings: string[] }>;
    /** Function to read a file */
    readFile?: (path: string) => Promise<string>;
    /** Function to write a file */
    writeFile?: (path: string, content: string) => Promise<void>;
    /** Current project files for context */
    projectFiles?: string[];
    /** Model to use */
    model?: string;
}

// ============================================================================
// Workflow Classification
// ============================================================================

const WorkflowClassificationSchema = z.object({
    workflow: z.enum([
        'lint_fix',
        'module_generation',
        'testbench',
        'code_review',
        'iterative_improve',
        'sequential_steps',
        'parallel_analysis',
        'simple_generation'
    ]),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    extractedParams: z.object({
        moduleName: z.string().optional(),
        filePath: z.string().optional(),
        errors: z.array(z.string()).optional(),
        testScenarios: z.array(z.string()).optional(),
        reviewAspects: z.array(z.string()).optional(),
        qualityThreshold: z.number().optional()
    })
});

/**
 * Classify a user request to determine the best workflow pattern.
 */
export async function classifyWorkflow(
    request: string,
    context?: { hasLintErrors?: boolean; hasCode?: boolean; fileName?: string },
    model: string = 'claude-sonnet-4-20250514'
): Promise<WorkflowSelection> {
    const { model: client, variantOptions, config } = createModelWithVariant(model);
    const modelId = `${config.provider}/${config.model}`;

    const prompt = new PromptBuilder()
        .addRaw('Classify this SystemVerilog development request to select the best workflow pattern.')
        .addRaw(`Request: "${request}"`)
        .addRaw(`Context:
- Has lint errors: ${context?.hasLintErrors ?? 'unknown'}
- Has existing code: ${context?.hasCode ?? 'unknown'}
- File: ${context?.fileName ?? 'none'}`)
        .addRaw(`Available workflows:
1. lint_fix - Fix lint/compile errors iteratively until clean
2. module_generation - Generate a new SV module with quality checks
3. testbench - Generate a testbench for a module
4. code_review - Review code from multiple perspectives (security, performance, style)
5. iterative_improve - Improve something iteratively until quality threshold met
6. sequential_steps - Execute multiple steps in sequence
7. parallel_analysis - Analyze something from multiple angles simultaneously
8. simple_generation - One-shot generation, no special workflow needed`)
        .addRaw(`Select the BEST workflow and extract any relevant parameters from the request.
For module_generation, extract the module name.
For testbench, extract test scenarios if mentioned.
For code_review, extract which aspects to review.`)
        .build();

    const object = await generateStructured({
        model: client,
        modelId,
        schema: WorkflowClassificationSchema,
        prompt,
        ...variantOptions
    });

    return object;
}

// ============================================================================
// Workflow Executor
// ============================================================================

/**
 * Execute the selected workflow with the given parameters.
 */
export async function executeWorkflow(
    request: string,
    selection: WorkflowSelection,
    context: WorkflowContext
): Promise<WorkflowResult> {
    const model = context.model ?? 'claude-sonnet-4-20250514';

    switch (selection.workflow) {
        case 'lint_fix':
            return executeLintFixWorkflow(request, selection, context, model);

        case 'module_generation':
            return executeModuleGenerationWorkflow(request, selection, model);

        case 'testbench':
            return executeTestbenchWorkflow(request, selection, context, model);

        case 'code_review':
            return executeCodeReviewWorkflow(request, selection, context, model);

        case 'iterative_improve':
            return executeIterativeImproveWorkflow(request, selection, model);

        case 'parallel_analysis':
            return executeParallelAnalysisWorkflow(request, selection, model);

        case 'sequential_steps':
            return executeSequentialWorkflow(request, selection, model);

        case 'simple_generation':
        default:
            return executeSimpleGeneration(request, model);
    }
}

// ============================================================================
// Individual Workflow Executors
// ============================================================================

async function executeLintFixWorkflow(
    request: string,
    selection: WorkflowSelection,
    context: WorkflowContext,
    model: string
): Promise<WorkflowResult> {
    const filePath = selection.extractedParams.filePath;
    const errors = selection.extractedParams.errors ?? [];

    if (!context.lintFunction) {
        return {
            workflow: 'lint_fix',
            success: false,
            output: 'Lint function not provided. Cannot execute lint fix workflow.'
        };
    }

    if (!filePath || !context.readFile) {
        return {
            workflow: 'lint_fix',
            success: false,
            output: 'File path or read function not provided.'
        };
    }

    try {
        const code = await context.readFile(filePath);
        const result = await lintFixWorkflow(code, errors, {
            model,
            maxIterations: 5,
            lintFunction: context.lintFunction
        });

        // Write fixed code if successful
        if (result.lintPasses && context.writeFile) {
            await context.writeFile(filePath, result.code);
        }

        return {
            workflow: 'lint_fix',
            success: result.lintPasses,
            output: result.lintPasses
                ? `Fixed ${filePath} in ${result.iterations} iterations.`
                : `Could not fully fix. ${result.remainingErrors.length} errors remain.`,
            details: result,
            iterations: result.iterations
        };
    } catch (error) {
        return {
            workflow: 'lint_fix',
            success: false,
            output: `Lint fix failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

async function executeModuleGenerationWorkflow(
    request: string,
    selection: WorkflowSelection,
    model: string
): Promise<WorkflowResult> {
    const moduleName = selection.extractedParams.moduleName ?? 'generated_module';

    try {
        const result = await moduleGenerationWorkflow({
            moduleName,
            description: request
        }, {
            model,
            maxIterations: 3,
            qualityThreshold: selection.extractedParams.qualityThreshold ?? 7
        });

        return {
            workflow: 'module_generation',
            success: result.quality.score >= 7,
            output: result.moduleCode,
            details: result,
            iterations: result.iterations
        };
    } catch (error) {
        return {
            workflow: 'module_generation',
            success: false,
            output: `Module generation failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

async function executeTestbenchWorkflow(
    request: string,
    selection: WorkflowSelection,
    context: WorkflowContext,
    model: string
): Promise<WorkflowResult> {
    const moduleName = selection.extractedParams.moduleName ?? 'dut';
    const scenarios = selection.extractedParams.testScenarios;

    // Try to get module code from context
    let moduleCode = '';
    if (selection.extractedParams.filePath && context.readFile) {
        try {
            moduleCode = await context.readFile(selection.extractedParams.filePath);
        } catch {
            // Will use request as description
        }
    }

    if (!moduleCode) {
        moduleCode = `// Module to test: ${moduleName}\n// Description: ${request}`;
    }

    try {
        const result = await testbenchWorkflow(moduleCode, {
            moduleName,
            testScenarios: scenarios,
            model
        });

        return {
            workflow: 'testbench',
            success: result.quality.qualityScore >= 6,
            output: result.testbenchCode,
            details: result
        };
    } catch (error) {
        return {
            workflow: 'testbench',
            success: false,
            output: `Testbench generation failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

async function executeCodeReviewWorkflow(
    request: string,
    selection: WorkflowSelection,
    context: WorkflowContext,
    model: string
): Promise<WorkflowResult> {
    let code = '';

    if (selection.extractedParams.filePath && context.readFile) {
        try {
            code = await context.readFile(selection.extractedParams.filePath);
        } catch {
            code = request; // Assume request contains code
        }
    } else {
        code = request;
    }

    const aspects = selection.extractedParams.reviewAspects ??
        ['security', 'performance', 'maintainability'];

    try {
        const result = await codeReviewWorkflow(code, {
            model,
            aspects
        });

        const reviewSummary = Array.from(result.reviews.entries())
            .map(([aspect, r]) => `**${aspect}** (${r.severity}): ${r.issues.length} issues`)
            .join('\n');

        return {
            workflow: 'code_review',
            success: true,
            output: `## Code Review (Score: ${result.overallScore}/10)\n\n${reviewSummary}\n\n### Summary\n${result.summary}`,
            details: {
                reviews: Object.fromEntries(result.reviews),
                overallScore: result.overallScore,
                summary: result.summary
            }
        };
    } catch (error) {
        return {
            workflow: 'code_review',
            success: false,
            output: `Code review failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

async function executeIterativeImproveWorkflow(
    request: string,
    selection: WorkflowSelection,
    model: string
): Promise<WorkflowResult> {
    const { model: client, variantOptions, config } = createModelWithVariant(model);
    const modelId = `${config.provider}/${config.model}`;

    try {
        const result = await evaluatorOptimizer<string>({
            maxIterations: 3,
            qualityThreshold: selection.extractedParams.qualityThreshold ?? 8,

            generate: async () => {
                const { text } = await generateText({
                    model: client,
                    prompt: request,
                    ...variantOptions
                });
                return text;
            },

            evaluate: async (output) => {
                const object = await generateStructured({
                    model: client,
                    modelId,
                    schema: z.object({
                        score: z.number().min(1).max(10),
                        issues: z.array(z.string()),
                        suggestions: z.array(z.string())
                    }),
                    prompt: `Evaluate this output for quality (1-10):\n\n${output}`,
                    ...variantOptions
                });

                return {
                    qualityScore: object.score,
                    meetsThreshold: object.score >= 8,
                    issues: object.issues,
                    suggestions: object.suggestions
                };
            },

            improve: async (output, evaluation) => {
                const { text } = await generateText({
                    model: client,
                    prompt: `Improve this based on feedback:\n\n${output}\n\nIssues: ${evaluation.issues.join(', ')}\nSuggestions: ${evaluation.suggestions.join(', ')}`,
                    ...variantOptions
                });
                return text;
            }
        }, request);

        return {
            workflow: 'iterative_improve',
            success: result.finalEvaluation.meetsThreshold,
            output: result.output,
            iterations: result.iterations
        };
    } catch (error) {
        return {
            workflow: 'iterative_improve',
            success: false,
            output: `Iterative improvement failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

async function executeParallelAnalysisWorkflow(
    request: string,
    selection: WorkflowSelection,
    model: string
): Promise<WorkflowResult> {
    const { model: client, variantOptions } = createModelWithVariant(model);

    const perspectives = ['technical', 'practical', 'alternative'];

    try {
        const results = await executeParallel(
            perspectives.map(perspective => ({
                name: perspective,
                execute: async () => {
                    const { text } = await generateText({
                        model: client,
                        system: `Analyze from a ${perspective} perspective.`,
                        prompt: request,
                        ...variantOptions
                    });
                    return text;
                }
            }))
        );

        const combined = Array.from(results.entries())
            .filter(([_, r]) => r.success)
            .map(([name, r]) => `### ${name.charAt(0).toUpperCase() + name.slice(1)} Perspective\n${r.output}`)
            .join('\n\n');

        return {
            workflow: 'parallel_analysis',
            success: true,
            output: combined
        };
    } catch (error) {
        return {
            workflow: 'parallel_analysis',
            success: false,
            output: `Parallel analysis failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

async function executeSequentialWorkflow(
    request: string,
    selection: WorkflowSelection,
    model: string
): Promise<WorkflowResult> {
    const { model: client, variantOptions, config } = createModelWithVariant(model);
    const modelId = `${config.provider}/${config.model}`;

    try {
        // First, break down into steps
        const plan = await generateStructured({
            model: client,
            modelId,
            schema: z.object({
                steps: z.array(z.object({
                    name: z.string(),
                    description: z.string()
                }))
            }),
            prompt: `Break this request into sequential steps:\n\n${request}`,
            ...variantOptions
        });

        // Execute each step
        const steps: ChainStep<string, string>[] = plan.steps.map(step => ({
            name: step.name,
            execute: async (previousOutput: string) => {
                const { text } = await generateText({
                    model: client,
                    prompt: `${step.description}\n\nPrevious context:\n${previousOutput}`,
                    ...variantOptions
                });
                return text;
            }
        }));

        const result = await executeChain(request, steps);

        return {
            workflow: 'sequential_steps',
            success: result.success,
            output: result.output as string,
            details: { steps: plan.steps.map(s => s.name) }
        };
    } catch (error) {
        return {
            workflow: 'sequential_steps',
            success: false,
            output: `Sequential workflow failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

async function executeSimpleGeneration(
    request: string,
    model: string
): Promise<WorkflowResult> {
    const { model: client, variantOptions } = createModelWithVariant(model);

    try {
        const { text } = await generateText({
            model: client,
            prompt: request,
            ...variantOptions
        });

        return {
            workflow: 'simple_generation',
            success: true,
            output: text
        };
    } catch (error) {
        return {
            workflow: 'simple_generation',
            success: false,
            output: `Generation failed: ${error instanceof Error ? error.message : error}`
        };
    }
}

// ============================================================================
// Main Router Function
// ============================================================================

/**
 * Automatically classify and execute the appropriate workflow for a request.
 *
 * @example
 * const result = await routeAndExecuteWorkflow(
 *   "Fix the lint errors in counter.sv",
 *   {
 *     lintFunction: async (code) => verilator.lint(code),
 *     readFile: async (path) => fs.readFile(path, 'utf-8'),
 *     writeFile: async (path, content) => fs.writeFile(path, content)
 *   }
 * );
 */
export async function routeAndExecuteWorkflow(
    request: string,
    context: WorkflowContext & {
        hasLintErrors?: boolean;
        hasCode?: boolean;
        fileName?: string;
    }
): Promise<WorkflowResult & { selection: WorkflowSelection }> {
    // Classify the request
    const selection = await classifyWorkflow(
        request,
        {
            hasLintErrors: context.hasLintErrors,
            hasCode: context.hasCode,
            fileName: context.fileName
        },
        context.model
    );

    // Execute the selected workflow
    const result = await executeWorkflow(request, selection, context);

    return {
        ...result,
        selection
    };
}
