/**
 * Agent Module
 * AI agent orchestration with Vercel AI SDK
 *
 * AI SDK 6 Features:
 * - TOOL_APPROVAL_CONFIG: Declarative tool approval configuration
 * - createAgentBundle: Factory for creating agent bundles with approval-aware tools
 * - toolNeedsApproval: Helper to check if a tool requires approval
 *
 * Workflow Patterns:
 * - executeChain: Sequential processing with quality checks
 * - executeParallel: Parallel processing with aggregation
 * - evaluatorOptimizer: Iterative improvement loops
 * - routeByClassification: Context-based routing
 * - lintFixWorkflow, moduleGenerationWorkflow, testbenchWorkflow: GateFlow-specific workflows
 */

export * from './tools.js';
export * from './core.js';
export * from './prompts.js';
export * from './agent-factory.js';
export * from './stop-conditions.js';
export * from './workflows/index.js';
export * from './loop-control.js';
export * from './ui-agents.js';
// Note: grep_context, tail_context, head_context tools are in tools.ts

