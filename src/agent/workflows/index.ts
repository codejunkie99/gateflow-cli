/**
 * Workflow Patterns Module
 *
 * Provides reusable workflow patterns for building structured agent workflows:
 * - Sequential Processing (Chains)
 * - Parallel Processing
 * - Evaluator-Optimizer Loops
 * - Routing
 *
 * @example
 * import { executeChain, parallelReview, evaluatorOptimizer } from './workflows';
 */

export {
    // Types
    type StepResult,
    type ChainStep,
    type EvaluationResult,
    type EvaluatorOptimizerConfig,
    type RouteClassification,
    type RouteHandler,

    // Sequential Processing
    executeChain,
    generateWithQualityCheck,

    // Parallel Processing
    executeParallel,
    parallelReview,

    // Evaluator-Optimizer
    evaluatorOptimizer,
    translateWithFeedback,

    // Routing
    routeByClassification,
    routeByComplexity,

    // Composed Workflows
    codeReviewWorkflow
} from './patterns.js';

// GateFlow-specific workflows
export {
    lintFixWorkflow,
    moduleGenerationWorkflow,
    testbenchWorkflow,
    type LintFixResult,
    type ModuleGenerationResult,
    type TestbenchResult
} from './gateflow-workflows.js';

// Workflow Router (auto-selects patterns)
export {
    classifyWorkflow,
    executeWorkflow,
    routeAndExecuteWorkflow,
    type WorkflowType,
    type WorkflowSelection,
    type WorkflowResult,
    type WorkflowContext
} from './workflow-router.js';
