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
    
    
    
    
    
    

    // Sequential Processing
    
    

    // Parallel Processing
    
    

    // Evaluator-Optimizer
    
    

    // Routing
    
    

    // Composed Workflows
    
} from './patterns.js';

// GateFlow-specific workflows
;

// Workflow Router (auto-selects patterns)
export {
    classifyWorkflow,
    executeWorkflow,
    
    type WorkflowType,
    
    
    type WorkflowContext
} from './workflow-router.js';
