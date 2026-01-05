/**
 * Error Recovery Pipeline
 * Handles errors with user confirmation before retry
 */
import type { EventBus } from '../events/index.js';
export declare enum ErrorType {
    API_ERROR = "api_error",
    RATE_LIMIT = "rate_limit",
    PARSE_ERROR = "parse_error",
    TOOL_ERROR = "tool_error",
    VALIDATION_ERROR = "validation_error",
    NETWORK_ERROR = "network_error",
    TIMEOUT = "timeout"
}
export declare enum RecoveryAction {
    RETRY_WITH_BACKOFF = "retry_with_backoff",
    FALLBACK_MODEL = "fallback_model",
    SKIP_AND_CONTINUE = "skip_and_continue",
    ASK_USER = "ask_user",
    ABORT = "abort"
}
export interface ErrorContext {
    operation: string;
    attempt: number;
    maxRetries: number;
    error: Error;
    metadata?: Record<string, any>;
}
export declare class ErrorRecoveryPipeline {
    private bus;
    constructor(bus: EventBus);
    /**
     * Analyze error and determine recovery action
     */
    handle(error: Error, context: ErrorContext): Promise<RecoveryAction>;
    /**
     * Classify error type
     */
    private classifyError;
    /**
     * Check if error is recoverable
     */
    private isRecoverable;
    /**
     * Check if error is transient (can be retried)
     */
    private isTransientError;
    /**
     * Determine if we should ask user
     */
    private shouldAskUser;
    /**
     * Ask user for recovery action
     */
    private askUserForRecovery;
    /**
     * Get recovery suggestion for error type
     */
    getRecoverySuggestion(errorType: ErrorType): string;
    /**
     * Get error code for exit
     */
    private getErrorCode;
    /**
     * Retry with exponential backoff
     */
    retryWithBackoff<T>(operation: () => Promise<T>, maxRetries?: number, initialDelay?: number): Promise<T>;
}
