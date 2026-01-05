/**
 * Thinking Chain for Visible Reasoning
 * Shows user step-by-step how agent is solving the problem
 * Hooks into AI SDK 6's onStepFinish callback
 */
import type { StepResult } from 'ai';
import type { EventBus } from '../../events/index.js';
import type { ThoughtCategory } from '../../events/types.js';
export interface ReasoningStep {
    stepNumber: number;
    type: ThoughtCategory;
    thought: string;
    data?: any;
    confidence: number;
    timestamp: number;
}
export declare class ThinkingChain {
    private bus;
    private options;
    private steps;
    private startTime;
    private currentStepNumber;
    constructor(bus: EventBus, options?: {
        showByDefault?: boolean;
        showConfidence?: boolean;
    });
    /**
     * Called from AI SDK's onStepFinish callback
     */
    onStepFinish(step: StepResult<any>): void;
    /**
     * Categorize step based on tool calls and content
     */
    private categorizeStep;
    /**
     * Summarize step for display
     */
    private summarizeStep;
    /**
     * Extract structured data from step
     */
    private extractStepData;
    /**
     * Estimate confidence based on step content
     */
    private estimateConfidence;
    /**
     * Add an analysis step
     */
    addAnalysisStep(thought: string, data?: any, confidence?: number): this;
    /**
     * Add a planning step
     */
    addPlanningStep(thought: string, data?: any, confidence?: number): this;
    /**
     * Add a decomposition step
     */
    addDecompositionStep(thought: string, data?: any, confidence?: number): this;
    /**
     * Add a coordination step
     */
    addCoordinationStep(thought: string, data?: any, confidence?: number): this;
    /**
     * Add a generating step
     */
    addGeneratingStep(thought: string, data?: any, confidence?: number): this;
    /**
     * Add a validating step
     */
    addValidatingStep(thought: string, data?: any, confidence?: number): this;
    /**
     * Add a fixing step
     */
    addFixingStep(thought: string, data?: any, confidence?: number): this;
    /**
     * Generic add step
     */
    private addStep;
    /**
     * Emit step to event bus
     */
    private emitStep;
    /**
     * Get all steps
     */
    getSteps(): ReasoningStep[];
    /**
     * Get summary
     */
    getSummary(): {
        totalSteps: number;
        stepsByCategory: Record<string, number>;
        duration: number;
        averageConfidence: number;
    };
    /**
     * Clear chain for new operation
     */
    clear(): void;
    /**
     * Export for analysis/logging
     */
    export(): {
        startTime: Date;
        endTime?: Date;
        steps: ReasoningStep[];
        summary: any;
    };
}
