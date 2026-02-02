/**
 * Error Emission Helpers
 * Standardizes error events emitted to the UI layer.
 */

import type { EventBus } from '../events/index.js';
import {
    GateFlowErrorCode,
    isGateFlowError,
    isRetryableCode,
} from './types.js';
import {
    GateFlowAPIError,
    RateLimitError,
    AuthenticationError,
    PermissionDeniedError,
    ContextLengthExceededError,
    APITimeoutError,
    APIConnectionError,
} from './classes.js';

export interface EmitErrorOptions {
    /** Explicit message override */
    message?: string;
    /** Underlying error object */
    error?: unknown;
    /** Optional context tag (prefixes message) */
    context?: string;
    /** Explicit error code override */
    code?: GateFlowErrorCode | number;
    /** Explicit recoverable override */
    recoverable?: boolean;
}

function normalizeMessage(options: EmitErrorOptions): string {
    const base =
        options.message ??
        (options.error instanceof Error
            ? options.error.message
            : options.error !== undefined
                ? String(options.error)
                : 'Unknown error');

    if (options.context) {
        return `[${options.context}] ${base}`;
    }

    return base;
}

function inferCodeFromError(error: unknown): GateFlowErrorCode | undefined {
    if (isGateFlowError(error)) {
        return error.code;
    }
    if (error instanceof GateFlowAPIError) {
        return error.code;
    }
    if (error instanceof RateLimitError) return GateFlowErrorCode.API_RATE_LIMITED;
    if (error instanceof AuthenticationError) return GateFlowErrorCode.API_AUTHENTICATION;
    if (error instanceof PermissionDeniedError) return GateFlowErrorCode.TOOL_PERMISSION_DENIED;
    if (error instanceof ContextLengthExceededError) return GateFlowErrorCode.API_CONTEXT_LENGTH_EXCEEDED;
    if (error instanceof APITimeoutError) return GateFlowErrorCode.API_TIMEOUT;
    if (error instanceof APIConnectionError) return GateFlowErrorCode.API_CONNECTION_FAILED;

    if (error && typeof error === 'object') {
        const errObj = error as Record<string, unknown>;
        const status = errObj.status ?? errObj.statusCode;
        if (status === 429) return GateFlowErrorCode.API_RATE_LIMITED;
        if (status === 401) return GateFlowErrorCode.API_AUTHENTICATION;
        if (status === 403) return GateFlowErrorCode.TOOL_PERMISSION_DENIED;
        if (status === 408) return GateFlowErrorCode.API_TIMEOUT;
        if (status && typeof status === 'number' && status >= 500) {
            return GateFlowErrorCode.API_INVALID_RESPONSE;
        }
    }

    return undefined;
}

function inferRecoverable(error: unknown, code?: GateFlowErrorCode): boolean | undefined {
    if (isGateFlowError(error)) {
        return error.retryable;
    }
    if (code !== undefined) {
        return isRetryableCode(code);
    }
    if (error instanceof RateLimitError) return true;
    if (error instanceof APITimeoutError) return true;
    if (error instanceof APIConnectionError) return true;
    return undefined;
}

export function emitError(bus: EventBus, options: EmitErrorOptions): void {
    const message = normalizeMessage(options);
    const inferredCode = inferCodeFromError(options.error);
    const code =
        typeof options.code === 'number'
            ? options.code
            : options.code ?? inferredCode;
    const recoverable = options.recoverable ?? inferRecoverable(options.error, code as GateFlowErrorCode | undefined);

    bus.emit({
        type: 'error',
        message,
        code,
        recoverable,
    });
}
