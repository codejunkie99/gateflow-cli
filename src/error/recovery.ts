/**
 * Error Recovery Pipeline
 * Handles errors with user confirmation before retry
 */

import type { EventBus } from '../events/index.js';

export enum ErrorType {
    API_ERROR = 'api_error',
    RATE_LIMIT = 'rate_limit',
    PARSE_ERROR = 'parse_error',
    TOOL_ERROR = 'tool_error',
    VALIDATION_ERROR = 'validation_error',
    NETWORK_ERROR = 'network_error',
    TIMEOUT = 'timeout'
}

export enum RecoveryAction {
    RETRY_WITH_BACKOFF = 'retry_with_backoff',
    FALLBACK_MODEL = 'fallback_model',
    SKIP_AND_CONTINUE = 'skip_and_continue',
    ASK_USER = 'ask_user',
    ABORT = 'abort'
}

export interface ErrorContext {
    operation: string;
    attempt: number;
    maxRetries: number;
    error: Error;
    metadata?: Record<string, any>;
}

export class ErrorRecoveryPipeline {
    constructor(private bus: EventBus) {}

    /**
     * Analyze error and determine recovery action
     */
    async handle(error: Error, context: ErrorContext): Promise<RecoveryAction> {
        const errorType = this.classifyError(error);
        
        // Emit error event
        this.bus.emit({
            type: 'error',
            message: error.message,
            code: this.getErrorCode(errorType),
            recoverable: this.isRecoverable(errorType)
        });

        // For certain errors, ask user before retry
        if (this.shouldAskUser(errorType, context)) {
            return await this.askUserForRecovery(errorType, context);
        }

        // Auto-retry for transient errors
        if (this.isTransientError(errorType) && context.attempt < context.maxRetries) {
            return RecoveryAction.RETRY_WITH_BACKOFF;
        }

        // Abort for non-recoverable errors
        return RecoveryAction.ABORT;
    }

    /**
     * Classify error type
     */
    private classifyError(error: Error): ErrorType {
        const message = error.message.toLowerCase();
        const stack = error.stack?.toLowerCase() || '';

        if (message.includes('rate limit') || message.includes('429')) {
            return ErrorType.RATE_LIMIT;
        }
        if (message.includes('timeout') || message.includes('timed out')) {
            return ErrorType.TIMEOUT;
        }
        if (message.includes('network') || message.includes('connection')) {
            return ErrorType.NETWORK_ERROR;
        }
        if (message.includes('parse') || message.includes('json')) {
            return ErrorType.PARSE_ERROR;
        }
        if (message.includes('api') || message.includes('anthropic') || message.includes('openai')) {
            return ErrorType.API_ERROR;
        }
        if (message.includes('tool') || message.includes('executor')) {
            return ErrorType.TOOL_ERROR;
        }
        if (message.includes('validation') || message.includes('schema')) {
            return ErrorType.VALIDATION_ERROR;
        }

        return ErrorType.API_ERROR; // Default
    }

    /**
     * Check if error is recoverable
     */
    private isRecoverable(errorType: ErrorType): boolean {
        return [
            ErrorType.API_ERROR,
            ErrorType.RATE_LIMIT,
            ErrorType.NETWORK_ERROR,
            ErrorType.TIMEOUT
        ].includes(errorType);
    }

    /**
     * Check if error is transient (can be retried)
     */
    private isTransientError(errorType: ErrorType): boolean {
        return [
            ErrorType.RATE_LIMIT,
            ErrorType.NETWORK_ERROR,
            ErrorType.TIMEOUT
        ].includes(errorType);
    }

    /**
     * Determine if we should ask user
     */
    private shouldAskUser(errorType: ErrorType, context: ErrorContext): boolean {
        // Always ask user per plan requirements
        if (context.attempt >= context.maxRetries) {
            return false; // Already exceeded retries
        }
        return true; // Ask user before retry
    }

    /**
     * Ask user for recovery action
     */
    private async askUserForRecovery(
        errorType: ErrorType,
        context: ErrorContext
    ): Promise<RecoveryAction> {
        const suggestion = this.getRecoverySuggestion(errorType);
        
        return new Promise((resolve) => {
            this.bus.emit({
                type: 'approval_request',
                id: `error-recovery-${Date.now()}`,
                action: 'Error Recovery',
                details: `Error: ${context.error.message}\n\n${suggestion}`,
                options: ['Retry', 'Skip', 'Abort']
            });

            // Wait for user response (handled by renderer)
            // For now, return ASK_USER - actual implementation would wait for approval_response
            resolve(RecoveryAction.ASK_USER);
        });
    }

    /**
     * Get recovery suggestion for error type
     */
    getRecoverySuggestion(errorType: ErrorType): string {
        switch (errorType) {
            case ErrorType.RATE_LIMIT:
                return 'Rate limit exceeded. Wait a moment and retry?';
            case ErrorType.NETWORK_ERROR:
                return 'Network error detected. Check connection and retry?';
            case ErrorType.TIMEOUT:
                return 'Operation timed out. Retry with longer timeout?';
            case ErrorType.API_ERROR:
                return 'API error occurred. Retry the operation?';
            case ErrorType.PARSE_ERROR:
                return 'Parse error. This may indicate a bug. Continue anyway?';
            case ErrorType.TOOL_ERROR:
                return 'Tool execution failed. Skip this step and continue?';
            case ErrorType.VALIDATION_ERROR:
                return 'Validation error. Check input and retry?';
            default:
                return 'An error occurred. Retry?';
        }
    }

    /**
     * Get error code for exit
     */
    private getErrorCode(errorType: ErrorType): number {
        switch (errorType) {
            case ErrorType.RATE_LIMIT:
                return 429;
            case ErrorType.TIMEOUT:
                return 408;
            case ErrorType.NETWORK_ERROR:
                return 503;
            case ErrorType.API_ERROR:
                return 500;
            default:
                return 1;
        }
    }

    /**
     * Retry with exponential backoff
     */
    async retryWithBackoff<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        initialDelay: number = 1000
    ): Promise<T> {
        let attempt = 0;
        let delay = initialDelay;

        while (attempt < maxRetries) {
            try {
                return await operation();
            } catch (error) {
                attempt++;
                if (attempt >= maxRetries) {
                    throw error;
                }
                
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }

        throw new Error('Max retries exceeded');
    }
}

