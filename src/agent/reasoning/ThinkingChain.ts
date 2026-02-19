/**
 * Thinking Chain for Visible Reasoning
 * Shows user step-by-step how agent is solving the problem
 * Hooks into AI SDK 6's onStepFinish callback
 */

import type { StepResult } from 'ai';
import type { EventBus } from '../../events/index.js';
import type { ThoughtCategory, ThoughtEvent } from '../../events/types.js';

interface ReasoningStep {
    stepNumber: number;
    type: ThoughtCategory;
    thought: string;
    data?: any;                     // Structured data (plan, errors, etc.)
    confidence: number;               // 0-1
    timestamp: number;
}

export class ThinkingChain {
    private steps: ReasoningStep[] = [];
    private startTime: number = 0;
    private currentStepNumber: number = 0;

    constructor(
        private bus: EventBus,
        private options: {
            showByDefault?: boolean;      // Show even if --verbose not set
            showConfidence?: boolean;    // Include confidence scores
        } = {}
    ) {
        this.startTime = Date.now();
    }

    // ==================== AI SDK 6 Integration ====================

    /**
     * Called from AI SDK's onStepFinish callback
     */
    onStepFinish(step: StepResult<any>): void {
        const category = this.categorizeStep(step);
        const thought = this.summarizeStep(step);
        const confidence = this.estimateConfidence(step);
        
        this.addStep(category, thought, this.extractStepData(step), confidence);
    }

    /**
     * Categorize step based on tool calls and content
     */
    private categorizeStep(step: StepResult<any>): ThoughtCategory {
        if (step.toolCalls && step.toolCalls.length > 0) {
            const toolName = step.toolCalls[0].toolName;
            if (toolName.includes('read') || toolName.includes('find') || toolName.includes('search')) {
                return 'analyzing';
            }
            if (toolName.includes('write') || toolName.includes('edit') || toolName.includes('generate')) {
                return 'generating';
            }
            if (toolName.includes('lint') || toolName.includes('sim') || toolName.includes('verify')) {
                return 'validating';
            }
        }
        
        if (step.text && step.text.length > 0) {
            const text = step.text.toLowerCase();
            if (text.includes('plan') || text.includes('decompose') || text.includes('break down')) {
                return 'planning';
            }
            if (text.includes('fix') || text.includes('error') || text.includes('correct')) {
                return 'fixing';
            }
        }
        
        return 'planning';
    }

    /**
     * Summarize step for display
     */
    private summarizeStep(step: StepResult<any>): string {
        if (step.toolCalls && step.toolCalls.length > 0) {
            const calls = step.toolCalls.map(call => {
                const input = call.input as Record<string, any>;
                if (input.path) return `${call.toolName}(${input.path})`;
                if (input.name) return `${call.toolName}(${input.name})`;
                return call.toolName;
            });
            return `Using tools: ${calls.join(', ')}`;
        }
        
        if (step.text) {
            // Extract first sentence or first 100 chars
            const firstSentence = step.text.split(/[.!?]/)[0];
            return firstSentence.length > 100 
                ? firstSentence.substring(0, 100) + '...'
                : firstSentence;
        }
        
        return 'Processing step...';
    }

    /**
     * Extract structured data from step
     */
    private extractStepData(step: StepResult<any>): Record<string, unknown> | undefined {
        const data: Record<string, unknown> = {};
        
        if (step.toolCalls) {
            data.toolCalls = step.toolCalls.map(call => ({
                toolName: call.toolName,
                input: call.input
            }));
        }
        
        if (step.text) {
            data.textLength = step.text.length;
        }
        
        return Object.keys(data).length > 0 ? data : undefined;
    }

    /**
     * Estimate confidence based on step content
     */
    private estimateConfidence(step: StepResult<any>): number {
        // Default confidence
        let confidence = 0.7;
        
        // Higher confidence if we have tool results
        if (step.toolResults && step.toolResults.length > 0) {
            const allSuccessful = step.toolResults.every((r: any) => !r.error);
            if (allSuccessful) confidence = 0.9;
        }
        
        // Lower confidence if there are errors
        if (step.toolResults) {
            const hasErrors = step.toolResults.some((r: any) => r.error);
            if (hasErrors) confidence = 0.5;
        }
        
        return confidence;
    }

    // ==================== Add Steps Manually ====================

    /**
     * Add an analysis step
     */
    addAnalysisStep(thought: string, data?: any, confidence: number = 0.8): this {
        return this.addStep('analyzing', thought, data, confidence);
    }

    /**
     * Add a planning step
     */
    addPlanningStep(thought: string, data?: any, confidence: number = 0.9): this {
        return this.addStep('planning', thought, data, confidence);
    }

    /**
     * Add a decomposition step
     */
    addDecompositionStep(thought: string, data?: any, confidence: number = 0.85): this {
        return this.addStep('decomposing', thought, data, confidence);
    }

    /**
     * Add a coordination step
     */
    addCoordinationStep(thought: string, data?: any, confidence: number = 0.9): this {
        return this.addStep('coordinating', thought, data, confidence);
    }

    /**
     * Add a generating step
     */
    addGeneratingStep(thought: string, data?: any, confidence: number = 0.7): this {
        return this.addStep('generating', thought, data, confidence);
    }

    /**
     * Add a validating step
     */
    addValidatingStep(thought: string, data?: any, confidence: number = 0.6): this {
        return this.addStep('validating', thought, data, confidence);
    }

    /**
     * Add a fixing step
     */
    addFixingStep(thought: string, data?: any, confidence: number = 0.8): this {
        return this.addStep('fixing', thought, data, confidence);
    }

    /**
     * Generic add step
     */
    private addStep(
        type: ThoughtCategory,
        thought: string,
        data?: any,
        confidence: number = 0.8
    ): this {
        this.currentStepNumber++;
        const step: ReasoningStep = {
            stepNumber: this.currentStepNumber,
            type,
            thought,
            data,
            confidence,
            timestamp: Date.now()
        };
        this.steps.push(step);
        
        // Emit to event bus for UI rendering (always visible per plan)
        this.emitStep(step);
        
        return this;
    }

    /**
     * Emit step to event bus
     */
    private emitStep(step: ReasoningStep): void {
        const event: ThoughtEvent = {
            type: 'thought',
            stepNumber: step.stepNumber,
            category: step.type,
            thought: step.thought,
            confidence: this.options.showConfidence ? step.confidence : undefined,
            timestamp: step.timestamp
        };
        
        if (step.data) {
            event.data = step.data;
        }
        
        this.bus.emit(event);
    }

    // ==================== Export ====================

    /**
     * Get all steps
     */
    getSteps(): ReasoningStep[] {
        return [...this.steps];
    }

    /**
     * Get summary
     */
    getSummary(): {
        totalSteps: number;
        stepsByCategory: Record<string, number>;
        duration: number;
        averageConfidence: number;
    } {
        const stepsByCategory: Record<string, number> = {};
        for (const step of this.steps) {
            stepsByCategory[step.type] = (stepsByCategory[step.type] || 0) + 1;
        }
        
        const avgConfidence = this.steps.length > 0
            ? this.steps.reduce((sum, s) => sum + s.confidence, 0) / this.steps.length
            : 0;
        
        return {
            totalSteps: this.steps.length,
            stepsByCategory,
            duration: Date.now() - this.startTime,
            averageConfidence: avgConfidence
        };
    }

    /**
     * Clear chain for new operation
     */
    clear(): void {
        this.steps = [];
        this.currentStepNumber = 0;
        this.startTime = Date.now();
    }

    /**
     * Export for analysis/logging
     */
    export(): {
        startTime: Date;
        endTime?: Date;
        steps: ReasoningStep[];
        summary: any;
    } {
        return {
            startTime: new Date(this.startTime),
            endTime: new Date(Date.now()),
            steps: this.getSteps(),
            summary: this.getSummary()
        };
    }
}

