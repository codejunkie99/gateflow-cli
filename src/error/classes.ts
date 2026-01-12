/**
 * GateFlow Error Classes
 * Typed error class hierarchy following Anthropic SDK patterns
 */

import { GateFlowErrorCode } from './types.js';

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base error class for all GateFlow API errors
 * Following Anthropic SDK error class pattern
 */
export class GateFlowAPIError extends Error {
    public readonly code: GateFlowErrorCode;
    public readonly timestamp: number;

    constructor(
        public readonly status: number,
        message: string,
        code: GateFlowErrorCode,
        public readonly headers?: Record<string, string>,
        public readonly requestId?: string
    ) {
        super(message);
        this.name = 'GateFlowAPIError';
        this.code = code;
        this.timestamp = Date.now();

        // Maintains proper stack trace for where error was thrown
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            status: this.status,
            message: this.message,
            code: this.code,
            requestId: this.requestId,
            timestamp: this.timestamp,
        };
    }
}

// ============================================================================
// API Error Subclasses (Anthropic SDK Pattern)
// ============================================================================

/**
 * Rate limit exceeded (HTTP 429)
 */
export class RateLimitError extends GateFlowAPIError {
    constructor(
        message: string,
        public readonly retryAfter?: number,
        requestId?: string
    ) {
        super(429, message, GateFlowErrorCode.API_RATE_LIMITED, undefined, requestId);
        this.name = 'RateLimitError';
    }

    /**
     * Get suggested wait time in milliseconds
     */
    getWaitTime(): number {
        return this.retryAfter ?? 60000; // Default to 60s
    }
}

/**
 * Authentication failed (HTTP 401)
 */
export class AuthenticationError extends GateFlowAPIError {
    constructor(message: string, requestId?: string) {
        super(401, message, GateFlowErrorCode.API_AUTHENTICATION, undefined, requestId);
        this.name = 'AuthenticationError';
    }
}

/**
 * Permission denied (HTTP 403)
 */
export class PermissionDeniedError extends GateFlowAPIError {
    constructor(message: string, requestId?: string) {
        super(403, message, GateFlowErrorCode.TOOL_PERMISSION_DENIED, undefined, requestId);
        this.name = 'PermissionDeniedError';
    }
}

/**
 * Bad request (HTTP 400)
 */
export class BadRequestError extends GateFlowAPIError {
    constructor(message: string, code?: GateFlowErrorCode, requestId?: string) {
        super(400, message, code ?? GateFlowErrorCode.TOOL_INVALID_ARGS, undefined, requestId);
        this.name = 'BadRequestError';
    }
}

/**
 * Context length exceeded (HTTP 400 with specific error)
 */
export class ContextLengthExceededError extends GateFlowAPIError {
    constructor(
        message: string,
        public readonly tokenCount?: number,
        public readonly maxTokens?: number,
        requestId?: string
    ) {
        super(400, message, GateFlowErrorCode.API_CONTEXT_LENGTH_EXCEEDED, undefined, requestId);
        this.name = 'ContextLengthExceededError';
    }
}

/**
 * API timeout (HTTP 408)
 */
export class APITimeoutError extends GateFlowAPIError {
    constructor(message: string, public readonly timeoutMs?: number, requestId?: string) {
        super(408, message, GateFlowErrorCode.API_TIMEOUT, undefined, requestId);
        this.name = 'APITimeoutError';
    }
}

/**
 * Internal server error (HTTP 5xx)
 */
export class InternalServerError extends GateFlowAPIError {
    constructor(message: string, status: number = 500, requestId?: string) {
        super(status, message, GateFlowErrorCode.API_INVALID_RESPONSE, undefined, requestId);
        this.name = 'InternalServerError';
    }
}

/**
 * API connection failed
 */
export class APIConnectionError extends GateFlowAPIError {
    constructor(message: string, public readonly cause?: Error) {
        super(0, message, GateFlowErrorCode.API_CONNECTION_FAILED);
        this.name = 'APIConnectionError';
    }
}

// ============================================================================
// Retryable vs Fatal Errors (AI SDK Agents Pattern)
// ============================================================================

/**
 * Error that can be retried after a delay
 */
export class RetryableError extends Error {
    public readonly timestamp: number;

    constructor(
        message: string,
        public readonly options?: {
            retryAfter?: number;
            maxRetries?: number;
            cause?: Error;
        }
    ) {
        super(message);
        this.name = 'RetryableError';
        this.timestamp = Date.now();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Get suggested retry delay in milliseconds
     */
    getRetryDelay(): number {
        return this.options?.retryAfter ?? 1000;
    }

    /**
     * Check if more retries are allowed
     */
    shouldRetry(attemptCount: number): boolean {
        const maxRetries = this.options?.maxRetries ?? 3;
        return attemptCount < maxRetries;
    }
}

/**
 * Fatal error that should not be retried
 */
export class FatalError extends Error {
    public readonly timestamp: number;

    constructor(message: string, public readonly cause?: Error) {
        super(message);
        this.name = 'FatalError';
        this.timestamp = Date.now();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

// ============================================================================
// Tool-Specific Errors
// ============================================================================

/**
 * Tool execution failed
 */
export class ToolExecutionError extends Error {
    public readonly code: GateFlowErrorCode;
    public readonly timestamp: number;

    constructor(
        public readonly toolName: string,
        message: string,
        code: GateFlowErrorCode = GateFlowErrorCode.TOOL_EXECUTION_FAILED,
        public readonly metadata?: Record<string, unknown>
    ) {
        super(`Tool '${toolName}' failed: ${message}`);
        this.name = 'ToolExecutionError';
        this.code = code;
        this.timestamp = Date.now();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Tool timeout error
 */
export class ToolTimeoutError extends ToolExecutionError {
    constructor(
        toolName: string,
        public readonly timeoutMs: number
    ) {
        super(
            toolName,
            `Operation timed out after ${timeoutMs}ms`,
            GateFlowErrorCode.TOOL_TIMEOUT,
            { timeoutMs }
        );
        this.name = 'ToolTimeoutError';
    }
}

/**
 * Tool not found error
 */
export class ToolNotFoundError extends Error {
    public readonly code = GateFlowErrorCode.TOOL_NOT_FOUND;
    public readonly timestamp: number;

    constructor(public readonly toolName: string) {
        super(`Tool '${toolName}' not found`);
        this.name = 'ToolNotFoundError';
        this.timestamp = Date.now();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Invalid tool input error
 */
export class InvalidToolInputError extends Error {
    public readonly code = GateFlowErrorCode.TOOL_INVALID_ARGS;
    public readonly timestamp: number;

    constructor(
        public readonly toolName: string,
        message: string,
        public readonly validationErrors?: string[]
    ) {
        super(`Invalid input for tool '${toolName}': ${message}`);
        this.name = 'InvalidToolInputError';
        this.timestamp = Date.now();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

// ============================================================================
// Type Guards
// ============================================================================

export function isGateFlowAPIError(error: unknown): error is GateFlowAPIError {
    return error instanceof GateFlowAPIError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
    return error instanceof RateLimitError;
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
    return error instanceof AuthenticationError;
}

export function isRetryableError(error: unknown): error is RetryableError {
    return error instanceof RetryableError;
}

export function isFatalError(error: unknown): error is FatalError {
    return error instanceof FatalError;
}

export function isToolExecutionError(error: unknown): error is ToolExecutionError {
    return error instanceof ToolExecutionError;
}

// ============================================================================
// Error Classification Helper
// ============================================================================

/**
 * Classify an error as retryable or fatal
 */
export function classifyError(error: unknown): 'retryable' | 'fatal' | 'unknown' {
    if (error instanceof RetryableError) return 'retryable';
    if (error instanceof FatalError) return 'fatal';
    if (error instanceof RateLimitError) return 'retryable';
    if (error instanceof APITimeoutError) return 'retryable';
    if (error instanceof APIConnectionError) return 'retryable';
    if (error instanceof AuthenticationError) return 'fatal';
    if (error instanceof PermissionDeniedError) return 'fatal';
    if (error instanceof ContextLengthExceededError) return 'fatal';
    if (error instanceof ToolNotFoundError) return 'fatal';
    if (error instanceof InvalidToolInputError) return 'fatal';

    // Default classification based on error message patterns
    if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('connection')) {
            return 'retryable';
        }
        if (msg.includes('authentication') || msg.includes('permission') || msg.includes('invalid')) {
            return 'fatal';
        }
    }

    return 'unknown';
}

/**
 * Wrap an unknown error in the appropriate error class
 */
export function wrapError(error: unknown, context?: string): Error {
    if (error instanceof Error) {
        return error;
    }
    const message = context
        ? `${context}: ${String(error)}`
        : String(error);
    return new Error(message);
}
