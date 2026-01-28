/**
 * GateFlow Timeout Protection
 * Configurable timeouts for tool execution
 */

import { ToolTimeoutError } from '../error/classes.js';

// ============================================================================
// Tool Categories and Timeouts
// ============================================================================

export type ToolCategory =
    | 'file'
    | 'edit'
    | 'search'
    | 'verification'
    | 'waveform'
    | 'project'
    | 'context'
    | 'skills'
    | 'mcp'
    | 'setup';

export interface TimeoutConfig {
    default: number;
    byCategory: Record<ToolCategory, number>;
}

/**
 * Default tool timeouts by category (in milliseconds)
 */
export const TOOL_TIMEOUTS: TimeoutConfig = {
    default: 30000, // 30 seconds
    byCategory: {
        file: 10000,           // 10s - File read/write operations
        edit: 15000,           // 15s - Edit operations
        search: 30000,         // 30s - Search operations
        verification: 120000,  // 2min - Lint/simulation
        waveform: 60000,       // 60s - Waveform analysis
        project: 30000,        // 30s - Project operations
        context: 5000,         // 5s - Context discovery
        skills: 60000,         // 60s - Skill execution
        mcp: 30000,            // 30s - MCP operations
        setup: 300000,         // 5min - Tool setup/installation
    },
};

/**
 * Tool name to category mapping
 */
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
    // File operations
    read_file: 'file',
    write_file: 'file',
    list_files: 'file',
    find_all_sv_files: 'file',

    // Edit operations
    edit_lines: 'edit',
    search_replace: 'edit',

    // Search operations
    search_code: 'search',
    find_module: 'search',
    get_dependencies: 'search',

    // Verification
    lint_file: 'verification',
    run_simulation: 'verification',

    // Waveform
    analyze_waveform: 'waveform',
    open_waveform: 'waveform',
    find_vcd_files: 'waveform',

    // Project
    get_project_stats: 'project',

    // Context
    describe_tool: 'context',
    read_context_output: 'context',
    search_history: 'context',

    // Skills
    search_skills: 'skills',
    get_skill: 'skills',
    run_skill_script: 'skills',

    // MCP
    check_mcp_status: 'mcp',
    get_mcp_tool: 'mcp',

    // Setup
    check_tool_status: 'setup',
    setup_verible: 'setup',
    setup_slang: 'setup',
};

// ============================================================================
// Timeout Functions
// ============================================================================

/**
 * Get timeout for a specific tool
 */
export function getToolTimeout(toolName: string, config?: Partial<TimeoutConfig>): number {
    const category = TOOL_CATEGORIES[toolName];
    const timeouts = { ...TOOL_TIMEOUTS, ...config };

    if (category) {
        return timeouts.byCategory[category] ?? timeouts.default;
    }

    return timeouts.default;
}

/**
 * Execute an operation with a timeout
 * @throws ToolTimeoutError if operation times out
 */
export async function withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;

        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new ToolTimeoutError(operationName, timeoutMs));
            }
        }, timeoutMs);

        operation()
            .then((result) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(result);
                }
            })
            .catch((error) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
    });
}

/**
 * Execute an operation with abort signal support
 * Useful for long-running operations that can be cancelled
 */
export async function withAbortableTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    operationName: string,
    externalSignal?: AbortSignal
): Promise<T> {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    // Link to external abort signal, propagating its reason
    const abortHandler = () => {
        const reason = externalSignal?.reason ?? { type: 'unknown' };
        controller.abort(reason);
    };

    if (externalSignal) {
        if (externalSignal.aborted) {
            throw new Error('Operation aborted');
        }
        externalSignal.addEventListener('abort', abortHandler);
    }

    try {
        return await new Promise<T>((resolve, reject) => {
            timeoutId = setTimeout(() => {
                // Use Error object for abort reason to prevent crashes when consumers access .stack
                const abortError = new Error(`${operationName} timed out after ${timeoutMs}ms`);
                (abortError as Error & { type: string }).type = 'timeout';
                controller.abort(abortError);
                reject(new ToolTimeoutError(operationName, timeoutMs));
            }, timeoutMs);

            operation(controller.signal)
                .then(resolve)
                .catch(reject);
        });
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        if (externalSignal) {
            externalSignal.removeEventListener('abort', abortHandler);
        }
    }
}

/**
 * Create a timeout wrapper for a tool executor
 */
export function createTimeoutWrapper<TArgs, TResult>(
    toolName: string,
    executor: (args: TArgs) => Promise<TResult>,
    timeoutOverride?: number
): (args: TArgs) => Promise<TResult> {
    const timeoutMs = timeoutOverride ?? getToolTimeout(toolName);

    return async (args: TArgs): Promise<TResult> => {
        return withTimeout(() => executor(args), timeoutMs, toolName);
    };
}

// ============================================================================
// Timeout Configuration Builder
// ============================================================================

export class TimeoutConfigBuilder {
    private config: TimeoutConfig = { ...TOOL_TIMEOUTS };

    /**
     * Set default timeout
     */
    setDefault(ms: number): this {
        this.config.default = ms;
        return this;
    }

    /**
     * Set timeout for a category
     */
    setCategory(category: ToolCategory, ms: number): this {
        this.config.byCategory[category] = ms;
        return this;
    }

    /**
     * Multiply all timeouts by a factor
     */
    scale(factor: number): this {
        this.config.default *= factor;
        for (const category of Object.keys(this.config.byCategory) as ToolCategory[]) {
            this.config.byCategory[category] *= factor;
        }
        return this;
    }

    /**
     * Build the configuration
     */
    build(): TimeoutConfig {
        return { ...this.config };
    }
}
