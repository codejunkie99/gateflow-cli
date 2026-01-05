/**
 * Modular Prompt Builder
 * Composable prompt system replacing monolithic strings
 */
export interface PromptComponent {
    type: 'base' | 'role' | 'constraint' | 'task' | 'format' | 'context' | 'example';
    content: string;
    priority?: number;
    conditional?: boolean;
    condition?: () => boolean;
}
export interface PromptOptions {
    includeThinkingInstructions?: boolean;
    includeCodeExamples?: boolean;
    maxLength?: number;
    temperature?: number;
}
export declare class PromptBuilder {
    private components;
    private metadata;
    /**
     * Add base layer - always included
     */
    addBase(agentName?: string): this;
    /**
     * Add specialized role
     */
    addRole(role: string, expertise: string, tone?: string): this;
    /**
     * Add one or multiple constraints
     */
    addConstraint(constraint: string | string[]): this;
    /**
     * Add constraint that's conditional
     */
    addConditionalConstraint(constraint: string, condition: () => boolean, priority?: number): this;
    /**
     * Add task description
     */
    addTask(task: string): this;
    /**
     * Add output format specification
     */
    setOutputFormat(format: {
        format: 'json' | 'text' | 'markdown';
        description: string;
        schema?: any;
    }): this;
    /**
     * Add context (files, code, previous results)
     */
    addContext(context: {
        files?: Array<{
            path: string;
            summary: string;
        }>;
        code?: string;
        previousErrors?: string[];
        projectStats?: any;
    }): this;
    /**
     * Add code example
     */
    addExample(title: string, code: string, explanation?: string): this;
    /**
     * Add thinking instructions (Chain-of-Thought)
     */
    enableThinking(options?: {
        showReasoning?: boolean;
        confidenceThreshold?: number;
    }): this;
    /**
     * Build final prompt from all components
     */
    build(options?: PromptOptions): string;
    /**
     * Export as structured object for debugging/analysis
     */
    export(): {
        version: string;
        createdAt: Date;
        components: PromptComponent[];
        componentCount: number;
        estimatedTokens: number;
    };
    /**
     * Reset builder for new prompt
     */
    reset(): this;
}
