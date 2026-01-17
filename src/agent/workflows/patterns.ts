/**
 * Workflow Patterns for AI SDK 6
 *
 * Reusable patterns for building structured agent workflows:
 * - Sequential Processing (Chains) - Steps executed in order
 * - Parallel Processing - Independent tasks run simultaneously
 * - Evaluator-Optimizer Loops - Results checked and improved iteratively
 * - Routing - Directing work based on context
 *
 * These patterns can be composed to build complex, reliable workflows.
 *
 * @see https://sdk.vercel.ai/docs/agents/workflows
 */

import { generateText, generateObject, streamText } from 'ai';
import { z, type ZodSchema } from 'zod';
import { createAnthropicClient } from '../anthropic-client.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from a workflow step
 */
export interface StepResult<T = unknown> {
    /** Output data from the step */
    output: T;
    /** Whether the step succeeded */
    success: boolean;
    /** Optional metadata about execution */
    metadata?: {
        durationMs?: number;
        tokens?: { input?: number; output?: number };
    };
}

/**
 * Configuration for a sequential chain step
 */
export interface ChainStep<TInput, TOutput> {
    /** Step name for logging/debugging */
    name: string;
    /** Execute the step */
    execute: (input: TInput) => Promise<TOutput>;
    /** Optional validation of output before passing to next step */
    validate?: (output: TOutput) => boolean;
}

/**
 * Configuration for evaluation in an optimizer loop
 */
export interface EvaluationResult {
    /** Overall quality score (0-10) */
    qualityScore: number;
    /** Whether all quality criteria are met */
    meetsThreshold: boolean;
    /** Specific issues found */
    issues: string[];
    /** Suggestions for improvement */
    suggestions: string[];
}

/**
 * Configuration for the evaluator-optimizer pattern
 */
export interface EvaluatorOptimizerConfig<T> {
    /** Maximum iterations before giving up */
    maxIterations: number;
    /** Minimum quality score to accept (0-10) */
    qualityThreshold: number;
    /** Generate initial output */
    generate: (input: string) => Promise<T>;
    /** Evaluate the current output */
    evaluate: (output: T, input: string) => Promise<EvaluationResult>;
    /** Improve output based on evaluation feedback */
    improve: (output: T, evaluation: EvaluationResult, input: string) => Promise<T>;
}

/**
 * Route classification result
 */
export interface RouteClassification<T extends string> {
    /** Selected route */
    route: T;
    /** Confidence in the classification (0-1) */
    confidence: number;
    /** Reasoning for the classification */
    reasoning: string;
}

/**
 * Route handler configuration
 */
export interface RouteHandler<TInput, TOutput> {
    /** Handle the routed input */
    handle: (input: TInput) => Promise<TOutput>;
    /** Optional system prompt for this route */
    system?: string;
}

// ============================================================================
// Sequential Processing (Chains)
// ============================================================================

/**
 * Execute a sequence of steps where each step's output becomes the next step's input.
 *
 * @example
 * const result = await executeChain(
 *   initialInput,
 *   [
 *     { name: 'parse', execute: async (input) => parseData(input) },
 *     { name: 'validate', execute: async (data) => validateData(data) },
 *     { name: 'transform', execute: async (data) => transformData(data) },
 *   ]
 * );
 */
export async function executeChain<T>(
    initialInput: T,
    steps: ChainStep<any, any>[]
): Promise<StepResult<T>> {
    let currentOutput: any = initialInput;
    const startTime = Date.now();

    for (const step of steps) {
        try {
            currentOutput = await step.execute(currentOutput);

            if (step.validate && !step.validate(currentOutput)) {
                return {
                    output: currentOutput,
                    success: false,
                    metadata: {
                        durationMs: Date.now() - startTime
                    }
                };
            }
        } catch (error) {
            return {
                output: currentOutput,
                success: false,
                metadata: {
                    durationMs: Date.now() - startTime
                }
            };
        }
    }

    return {
        output: currentOutput,
        success: true,
        metadata: {
            durationMs: Date.now() - startTime
        }
    };
}

/**
 * Create a text generation chain with quality checking.
 * Generates text, evaluates quality, and optionally regenerates if quality is low.
 *
 * @example
 * const { output, qualityMetrics } = await generateWithQualityCheck(
 *   'Write marketing copy for a new product',
 *   {
 *     model: 'claude-sonnet-4-20250514',
 *     qualitySchema: z.object({
 *       hasCallToAction: z.boolean(),
 *       clarity: z.number().min(1).max(10),
 *     }),
 *     qualityThreshold: (metrics) => metrics.hasCallToAction && metrics.clarity >= 7,
 *     improvementPrompt: (original, metrics) =>
 *       `Improve this: ${original}\nIssues: ${JSON.stringify(metrics)}`
 *   }
 * );
 */
export async function generateWithQualityCheck<TQuality extends Record<string, unknown>>(
    prompt: string,
    config: {
        model?: string;
        system?: string;
        qualitySchema: ZodSchema<TQuality>;
        qualityThreshold: (metrics: TQuality) => boolean;
        improvementPrompt: (original: string, metrics: TQuality) => string;
        maxRetries?: number;
    }
): Promise<{ output: string; qualityMetrics: TQuality; iterations: number }> {
    const {
        model = 'claude-sonnet-4-20250514',
        system,
        qualitySchema,
        qualityThreshold,
        improvementPrompt,
        maxRetries = 2
    } = config;

    const client = createAnthropicClient(model);

    // Initial generation
    const { text: initialOutput } = await generateText({
        model: client as any,
        system,
        prompt
    });

    // Quality evaluation
    const { object: qualityMetrics } = await generateObject({
        model: client as any,
        schema: qualitySchema,
        prompt: `Evaluate this output:\n\n${initialOutput}\n\nProvide quality metrics.`
    });

    // Check if quality meets threshold
    if (qualityThreshold(qualityMetrics)) {
        return { output: initialOutput, qualityMetrics, iterations: 1 };
    }

    // Retry loop for improvement
    let currentOutput = initialOutput;
    let currentMetrics = qualityMetrics;

    for (let i = 0; i < maxRetries; i++) {
        const improvedPrompt = improvementPrompt(currentOutput, currentMetrics);

        const { text: improvedOutput } = await generateText({
            model: client as any,
            system,
            prompt: improvedPrompt
        });

        const { object: newMetrics } = await generateObject({
            model: client as any,
            schema: qualitySchema,
            prompt: `Evaluate this output:\n\n${improvedOutput}\n\nProvide quality metrics.`
        });

        currentOutput = improvedOutput;
        currentMetrics = newMetrics;

        if (qualityThreshold(newMetrics)) {
            return { output: currentOutput, qualityMetrics: currentMetrics, iterations: i + 2 };
        }
    }

    // Return best effort after max retries
    return { output: currentOutput, qualityMetrics: currentMetrics, iterations: maxRetries + 1 };
}

// ============================================================================
// Parallel Processing
// ============================================================================

/**
 * Execute multiple tasks in parallel and aggregate results.
 *
 * @example
 * const reviews = await executeParallel([
 *   { name: 'security', execute: () => reviewSecurity(code) },
 *   { name: 'performance', execute: () => reviewPerformance(code) },
 *   { name: 'style', execute: () => reviewStyle(code) },
 * ]);
 */
export async function executeParallel<T>(
    tasks: Array<{ name: string; execute: () => Promise<T> }>
): Promise<Map<string, StepResult<T>>> {
    const startTime = Date.now();
    const results = new Map<string, StepResult<T>>();

    const settled = await Promise.allSettled(
        tasks.map(async (task) => {
            const taskStart = Date.now();
            const output = await task.execute();
            return {
                name: task.name,
                output,
                durationMs: Date.now() - taskStart
            };
        })
    );

    for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        const task = tasks[i];

        if (result.status === 'fulfilled') {
            results.set(task.name, {
                output: result.value.output,
                success: true,
                metadata: { durationMs: result.value.durationMs }
            });
        } else {
            results.set(task.name, {
                output: undefined as T,
                success: false,
                metadata: { durationMs: Date.now() - startTime }
            });
        }
    }

    return results;
}

/**
 * Execute parallel LLM calls for multi-perspective analysis.
 *
 * @example
 * const { reviews, summary } = await parallelReview(code, {
 *   perspectives: [
 *     { name: 'security', system: 'You are a security expert...' },
 *     { name: 'performance', system: 'You are a performance expert...' },
 *   ],
 *   reviewSchema: z.object({ issues: z.array(z.string()), score: z.number() }),
 *   summarize: true
 * });
 */
export async function parallelReview<TReview extends Record<string, unknown>>(
    content: string,
    config: {
        model?: string;
        perspectives: Array<{ name: string; system: string }>;
        reviewSchema: ZodSchema<TReview>;
        summarize?: boolean;
    }
): Promise<{
    reviews: Map<string, TReview>;
    summary?: string;
}> {
    const { model = 'claude-sonnet-4-20250514', perspectives, reviewSchema, summarize } = config;
    const client = createAnthropicClient(model);

    // Parallel review calls
    const reviewPromises = perspectives.map(async (perspective) => {
        const { object } = await generateObject({
            model: client as any,
            schema: reviewSchema,
            system: perspective.system,
            prompt: `Review this content:\n\n${content}`
        });
        return { name: perspective.name, review: object };
    });

    const reviewResults = await Promise.all(reviewPromises);
    const reviews = new Map<string, TReview>();

    for (const { name, review } of reviewResults) {
        reviews.set(name, review);
    }

    // Optional summary
    let summary: string | undefined;
    if (summarize) {
        const reviewSummary = Array.from(reviews.entries())
            .map(([name, review]) => `${name}: ${JSON.stringify(review)}`)
            .join('\n\n');

        const { text } = await generateText({
            model: client as any,
            system: 'You are synthesizing multiple expert reviews into a concise summary.',
            prompt: `Synthesize these reviews into actionable insights:\n\n${reviewSummary}`
        });
        summary = text;
    }

    return { reviews, summary };
}

// ============================================================================
// Evaluator-Optimizer Loop
// ============================================================================

/**
 * Execute an evaluator-optimizer loop for iterative improvement.
 *
 * @example
 * const result = await evaluatorOptimizer({
 *   maxIterations: 3,
 *   qualityThreshold: 8,
 *   generate: async (input) => generateTranslation(input),
 *   evaluate: async (output, input) => evaluateTranslation(output, input),
 *   improve: async (output, evaluation, input) => improveTranslation(output, evaluation)
 * }, originalText);
 */
export async function evaluatorOptimizer<T>(
    config: EvaluatorOptimizerConfig<T>,
    input: string
): Promise<{
    output: T;
    finalEvaluation: EvaluationResult;
    iterations: number;
    history: Array<{ output: T; evaluation: EvaluationResult }>;
}> {
    const { maxIterations, qualityThreshold, generate, evaluate, improve } = config;
    const history: Array<{ output: T; evaluation: EvaluationResult }> = [];

    // Initial generation
    let currentOutput = await generate(input);
    let currentEvaluation = await evaluate(currentOutput, input);
    history.push({ output: currentOutput, evaluation: currentEvaluation });

    let iterations = 1;

    // Improvement loop
    while (
        iterations < maxIterations &&
        !currentEvaluation.meetsThreshold &&
        currentEvaluation.qualityScore < qualityThreshold
    ) {
        currentOutput = await improve(currentOutput, currentEvaluation, input);
        currentEvaluation = await evaluate(currentOutput, input);
        history.push({ output: currentOutput, evaluation: currentEvaluation });
        iterations++;
    }

    return {
        output: currentOutput,
        finalEvaluation: currentEvaluation,
        iterations,
        history
    };
}

/**
 * Create a translation workflow with evaluation feedback loop.
 *
 * @example
 * const { translation, quality } = await translateWithFeedback(
 *   'Hello, world!',
 *   'Spanish',
 *   { maxIterations: 3, qualityThreshold: 8 }
 * );
 */
export async function translateWithFeedback(
    text: string,
    targetLanguage: string,
    config?: {
        model?: string;
        maxIterations?: number;
        qualityThreshold?: number;
    }
): Promise<{
    translation: string;
    quality: EvaluationResult;
    iterations: number;
}> {
    const {
        model = 'claude-sonnet-4-20250514',
        maxIterations = 3,
        qualityThreshold = 8
    } = config ?? {};

    const client = createAnthropicClient(model);

    const EvaluationSchema = z.object({
        qualityScore: z.number().min(1).max(10),
        preservesTone: z.boolean(),
        preservesNuance: z.boolean(),
        culturallyAccurate: z.boolean(),
        issues: z.array(z.string()),
        suggestions: z.array(z.string())
    });

    const result = await evaluatorOptimizer<string>(
        {
            maxIterations,
            qualityThreshold,

            generate: async () => {
                const { text: translation } = await generateText({
                    model: client as any,
                    system: 'You are an expert literary translator.',
                    prompt: `Translate this text to ${targetLanguage}, preserving tone and cultural nuances:\n\n${text}`
                });
                return translation;
            },

            evaluate: async (translation) => {
                const { object } = await generateObject({
                    model: client as any,
                    schema: EvaluationSchema,
                    system: 'You are an expert in evaluating literary translations.',
                    prompt: `Evaluate this translation:

Original: ${text}
Translation: ${translation}

Consider:
1. Overall quality (1-10)
2. Preservation of tone
3. Preservation of nuance
4. Cultural accuracy`
                });

                return {
                    qualityScore: object.qualityScore,
                    meetsThreshold:
                        object.qualityScore >= qualityThreshold &&
                        object.preservesTone &&
                        object.preservesNuance &&
                        object.culturallyAccurate,
                    issues: object.issues,
                    suggestions: object.suggestions
                };
            },

            improve: async (translation, evaluation) => {
                const { text: improved } = await generateText({
                    model: client as any,
                    system: 'You are an expert literary translator improving a translation.',
                    prompt: `Improve this translation based on feedback:

Original: ${text}
Current translation: ${translation}

Issues to address:
${evaluation.issues.map(i => `- ${i}`).join('\n')}

Suggestions:
${evaluation.suggestions.map(s => `- ${s}`).join('\n')}

Provide an improved translation.`
                });
                return improved;
            }
        },
        text
    );

    return {
        translation: result.output,
        quality: result.finalEvaluation,
        iterations: result.iterations
    };
}

// ============================================================================
// Routing
// ============================================================================

/**
 * Route input to the appropriate handler based on classification.
 *
 * @example
 * const response = await routeByClassification(
 *   customerQuery,
 *   {
 *     routes: ['general', 'refund', 'technical'] as const,
 *     classificationPrompt: 'Classify this customer query...',
 *     handlers: {
 *       general: { handle: handleGeneralQuery, system: 'General support agent' },
 *       refund: { handle: handleRefundQuery, system: 'Refund specialist' },
 *       technical: { handle: handleTechnicalQuery, system: 'Technical support' },
 *     }
 *   }
 * );
 */
export async function routeByClassification<
    TRoutes extends readonly string[],
    TInput,
    TOutput
>(
    input: TInput,
    config: {
        model?: string;
        routes: TRoutes;
        classificationPrompt: string;
        handlers: Record<TRoutes[number], RouteHandler<TInput, TOutput>>;
    }
): Promise<{
    classification: RouteClassification<TRoutes[number]>;
    output: TOutput;
}> {
    const { model = 'claude-sonnet-4-20250514', routes, classificationPrompt, handlers } = config;
    const client = createAnthropicClient(model);

    // Create dynamic schema for routes
    const ClassificationSchema = z.object({
        route: z.enum(routes as unknown as [string, ...string[]]),
        confidence: z.number().min(0).max(1),
        reasoning: z.string()
    });

    // Classify the input
    const { object: classification } = await generateObject({
        model: client as any,
        schema: ClassificationSchema,
        prompt: `${classificationPrompt}\n\nInput: ${JSON.stringify(input)}\n\nAvailable routes: ${routes.join(', ')}`
    });

    // Get the handler for the selected route
    const handler = handlers[classification.route as TRoutes[number]];
    if (!handler) {
        throw new Error(`No handler for route: ${classification.route}`);
    }

    // Execute the handler
    const output = await handler.handle(input);

    return {
        classification: classification as RouteClassification<TRoutes[number]>,
        output
    };
}

/**
 * Route to different models based on complexity.
 * Uses a smaller model for simple tasks and larger model for complex ones.
 *
 * @example
 * const response = await routeByComplexity(
 *   query,
 *   {
 *     simpleModel: 'claude-haiku-...',
 *     complexModel: 'claude-sonnet-...',
 *     complexityThreshold: 0.7
 *   }
 * );
 */
export async function routeByComplexity(
    prompt: string,
    config: {
        classifierModel?: string;
        simpleModel?: string;
        complexModel?: string;
        complexityThreshold?: number;
        system?: string;
    }
): Promise<{
    response: string;
    complexity: { score: number; reasoning: string };
    modelUsed: string;
}> {
    const {
        classifierModel = 'claude-sonnet-4-20250514',
        simpleModel = 'claude-sonnet-4-20250514',
        complexModel = 'claude-sonnet-4-20250514',
        complexityThreshold = 0.7,
        system
    } = config;

    const classifier = createAnthropicClient(classifierModel);

    // Classify complexity
    const { object: complexity } = await generateObject({
        model: classifier as any,
        schema: z.object({
            score: z.number().min(0).max(1).describe('Complexity score from 0 (simple) to 1 (complex)'),
            reasoning: z.string().describe('Brief explanation of complexity assessment')
        }),
        prompt: `Assess the complexity of this request (0 = very simple, 1 = very complex):

${prompt}

Consider:
- Number of steps required
- Domain expertise needed
- Ambiguity in the request
- Potential for errors`
    });

    // Select model based on complexity
    const selectedModel = complexity.score >= complexityThreshold ? complexModel : simpleModel;
    const client = createAnthropicClient(selectedModel);

    // Generate response with selected model
    const { text: response } = await generateText({
        model: client as any,
        system,
        prompt
    });

    return {
        response,
        complexity,
        modelUsed: selectedModel
    };
}

// ============================================================================
// Composed Workflows
// ============================================================================

/**
 * A complete code review workflow combining parallel analysis with summary.
 *
 * @example
 * const review = await codeReviewWorkflow(sourceCode, {
 *   aspects: ['security', 'performance', 'maintainability']
 * });
 */
export async function codeReviewWorkflow(
    code: string,
    config?: {
        model?: string;
        aspects?: string[];
    }
): Promise<{
    reviews: Map<string, {
        issues: string[];
        severity: 'low' | 'medium' | 'high';
        suggestions: string[];
    }>;
    summary: string;
    overallScore: number;
}> {
    const {
        model = 'claude-sonnet-4-20250514',
        aspects = ['security', 'performance', 'maintainability']
    } = config ?? {};

    const ReviewSchema = z.object({
        issues: z.array(z.string()),
        severity: z.enum(['low', 'medium', 'high']),
        suggestions: z.array(z.string())
    });

    const perspectives = aspects.map(aspect => ({
        name: aspect,
        system: `You are an expert code reviewer specializing in ${aspect}. Focus on identifying ${aspect}-related issues and providing actionable suggestions.`
    }));

    const { reviews, summary } = await parallelReview(code, {
        model,
        perspectives,
        reviewSchema: ReviewSchema,
        summarize: true
    });

    // Calculate overall score based on severity
    const severityScores = { low: 9, medium: 6, high: 3 };
    let totalScore = 0;
    let count = 0;

    for (const review of reviews.values()) {
        totalScore += severityScores[review.severity];
        count++;
    }

    const overallScore = count > 0 ? Math.round(totalScore / count) : 10;

    return {
        reviews,
        summary: summary ?? 'No summary available',
        overallScore
    };
}
