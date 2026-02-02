/**
 * Tool Executor
 * Executes GateFlow tools by delegating to the main gateflow-cli package.
 *
 * This is a bridge that imports from the parent gateflow-cli package.
 * In production, gateflow-cli should be installed as a dependency.
 */
export interface ToolExecutor {
    execute(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
export declare function createToolExecutor(projectRoot: string): ToolExecutor;
