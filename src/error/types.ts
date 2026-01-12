/**
 * GateFlow Error Types
 * Structured error codes and interfaces for production-grade error handling
 */

// ============================================================================
// Error Codes
// ============================================================================

export enum GateFlowErrorCode {
    // Tool errors (1xxx)
    TOOL_EXECUTION_FAILED = 1001,
    TOOL_TIMEOUT = 1002,
    TOOL_INVALID_ARGS = 1003,
    TOOL_NOT_FOUND = 1004,
    TOOL_PERMISSION_DENIED = 1005,

    // File operation errors (2xxx)
    FILE_NOT_FOUND = 2001,
    FILE_ACCESS_DENIED = 2002,
    FILE_WRITE_FAILED = 2003,
    PATH_OUTSIDE_PROJECT = 2004,
    FILE_TOO_LARGE = 2005,
    DIRECTORY_NOT_FOUND = 2006,

    // AI/API errors (3xxx)
    API_RATE_LIMITED = 3001,
    API_TIMEOUT = 3002,
    API_AUTHENTICATION = 3003,
    API_MODEL_UNAVAILABLE = 3004,
    API_CONTEXT_LENGTH_EXCEEDED = 3005,
    API_INVALID_RESPONSE = 3006,
    API_CONNECTION_FAILED = 3007,

    // Verification errors (4xxx)
    VERILATOR_NOT_INSTALLED = 4001,
    LINT_FAILED = 4002,
    SIMULATION_FAILED = 4003,
    COMPILATION_FAILED = 4004,
    VCD_PARSE_FAILED = 4005,

    // System errors (5xxx)
    NETWORK_ERROR = 5001,
    MEMORY_EXHAUSTED = 5002,
    DISK_FULL = 5003,
    PROCESS_SPAWN_FAILED = 5004,

    // Multi-agent errors (6xxx)
    AGENT_ROUTING_FAILED = 6001,
    TASK_DEPENDENCY_CYCLE = 6002,
    AGENT_TIMEOUT = 6003,
    ORCHESTRATION_FAILED = 6004,

    // Plugin errors (7xxx)
    PLUGIN_INIT_FAILED = 7001,
    PLUGIN_HOOK_FAILED = 7002,
    PLUGIN_NOT_FOUND = 7003,
}

// ============================================================================
// Error Interfaces
// ============================================================================

export interface GateFlowError {
    code: GateFlowErrorCode;
    message: string;
    retryable: boolean;
    metadata?: Record<string, unknown>;
    cause?: Error;
    timestamp: number;
    correlationId?: string;
}

export interface AggregatedError {
    errors: GateFlowError[];
    summary: string;
    partialSuccess: boolean;
    successfulOperations: string[];
    failedOperations: string[];
}

// ============================================================================
// Tool Result Types
// ============================================================================

export type ToolResult<T> =
    | { success: true; data: T }
    | { success: false; error: GateFlowError };

// ============================================================================
// Retryability Classification
// ============================================================================

const RETRYABLE_CODES = new Set([
    GateFlowErrorCode.API_RATE_LIMITED,
    GateFlowErrorCode.API_TIMEOUT,
    GateFlowErrorCode.API_CONNECTION_FAILED,
    GateFlowErrorCode.NETWORK_ERROR,
    GateFlowErrorCode.TOOL_TIMEOUT,
]);

const FATAL_CODES = new Set([
    GateFlowErrorCode.API_AUTHENTICATION,
    GateFlowErrorCode.FILE_ACCESS_DENIED,
    GateFlowErrorCode.PATH_OUTSIDE_PROJECT,
    GateFlowErrorCode.TOOL_NOT_FOUND,
]);

// ============================================================================
// Factory Functions
// ============================================================================

export function createGateFlowError(
    code: GateFlowErrorCode,
    message: string,
    options?: {
        metadata?: Record<string, unknown>;
        cause?: Error;
        correlationId?: string;
    }
): GateFlowError {
    return {
        code,
        message,
        retryable: isRetryableCode(code),
        metadata: options?.metadata,
        cause: options?.cause,
        timestamp: Date.now(),
        correlationId: options?.correlationId,
    };
}

export function createToolError(
    code: GateFlowErrorCode,
    message: string,
    toolName: string,
    metadata?: Record<string, unknown>
): GateFlowError {
    return createGateFlowError(code, message, {
        metadata: { toolName, ...metadata },
    });
}

export function createAPIError(
    code: GateFlowErrorCode,
    message: string,
    status?: number,
    requestId?: string
): GateFlowError {
    return createGateFlowError(code, message, {
        metadata: { status, requestId },
    });
}

// ============================================================================
// Error Classification
// ============================================================================

export function isRetryableCode(code: GateFlowErrorCode): boolean {
    return RETRYABLE_CODES.has(code);
}

export function isFatalCode(code: GateFlowErrorCode): boolean {
    return FATAL_CODES.has(code);
}

export function isRetryableError(error: GateFlowError): boolean {
    return error.retryable;
}

export function getErrorCategory(code: GateFlowErrorCode): string {
    if (code >= 1000 && code < 2000) return 'tool';
    if (code >= 2000 && code < 3000) return 'file';
    if (code >= 3000 && code < 4000) return 'api';
    if (code >= 4000 && code < 5000) return 'verification';
    if (code >= 5000 && code < 6000) return 'system';
    if (code >= 6000 && code < 7000) return 'agent';
    if (code >= 7000 && code < 8000) return 'plugin';
    return 'unknown';
}

// ============================================================================
// Error Aggregation
// ============================================================================

export function aggregateErrors(
    errors: GateFlowError[],
    successful: string[] = [],
    failed: string[] = []
): AggregatedError {
    const uniqueMessages = [...new Set(errors.map(e => e.message))];
    const summary = errors.length === 1
        ? errors[0].message
        : `${errors.length} errors: ${uniqueMessages.slice(0, 3).join('; ')}${uniqueMessages.length > 3 ? '...' : ''}`;

    return {
        errors,
        summary,
        partialSuccess: successful.length > 0,
        successfulOperations: successful,
        failedOperations: failed,
    };
}

// ============================================================================
// Error Serialization
// ============================================================================

export function serializeError(error: GateFlowError): string {
    return JSON.stringify({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        metadata: error.metadata,
        timestamp: error.timestamp,
        correlationId: error.correlationId,
        // Don't serialize cause to avoid circular references
    });
}

export function deserializeError(json: string): GateFlowError | null {
    try {
        const parsed = JSON.parse(json);
        if (typeof parsed.code === 'number' && typeof parsed.message === 'string') {
            return {
                code: parsed.code,
                message: parsed.message,
                retryable: parsed.retryable ?? false,
                metadata: parsed.metadata,
                timestamp: parsed.timestamp ?? Date.now(),
                correlationId: parsed.correlationId,
            };
        }
        return null;
    } catch {
        return null;
    }
}
