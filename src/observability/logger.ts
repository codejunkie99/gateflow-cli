/**
 * GateFlow Structured Logger
 * Structured logging with correlation IDs for production tracing
 */

import { randomUUID } from 'crypto';

// ============================================================================
// Log Levels
// ============================================================================

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.FATAL]: 'FATAL',
};

// ============================================================================
// Log Entry Interface
// ============================================================================

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    levelName: string;
    message: string;
    component: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
    error?: {
        name: string;
        message: string;
        stack?: string;
        code?: number | string;
    };
}

// ============================================================================
// Logger Configuration
// ============================================================================

export interface LoggerConfig {
    /** Minimum log level */
    level: LogLevel;
    /** Output format */
    format: 'json' | 'text';
    /** Output destination */
    output: 'console' | 'file' | 'both';
    /** File path (if output includes file) */
    filePath?: string;
    /** Maximum file size before rotation (bytes) */
    maxFileSize?: number;
    /** Number of rotated files to keep */
    rotateCount?: number;
    /** Include timestamps */
    timestamps: boolean;
    /** Include component name */
    includeComponent: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
    level: LogLevel.INFO,
    format: 'text',
    output: 'console',
    timestamps: true,
    includeComponent: true,
};

// ============================================================================
// Structured Logger Implementation
// ============================================================================

export class StructuredLogger {
    private config: LoggerConfig;
    private correlationId: string | null = null;

    constructor(
        private component: string,
        config?: Partial<LoggerConfig>
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Correlation ID Management
    // ========================================================================

    /**
     * Set the correlation ID for tracing requests
     */
    setCorrelationId(id: string): void {
        this.correlationId = id;
    }

    /**
     * Clear the correlation ID
     */
    clearCorrelationId(): void {
        this.correlationId = null;
    }

    /**
     * Get the current correlation ID
     */
    getCorrelationId(): string | null {
        return this.correlationId;
    }

    /**
     * Generate a new correlation ID
     */
    generateCorrelationId(): string {
        const id = randomUUID();
        this.correlationId = id;
        return id;
    }

    // ========================================================================
    // Log Methods
    // ========================================================================

    debug(message: string, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.DEBUG, message, metadata);
    }

    info(message: string, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.INFO, message, metadata);
    }

    warn(message: string, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.WARN, message, metadata);
    }

    error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.ERROR, message, metadata, error);
    }

    fatal(message: string, error?: Error, metadata?: Record<string, unknown>): void {
        this.log(LogLevel.FATAL, message, metadata, error);
    }

    // ========================================================================
    // Child Logger
    // ========================================================================

    /**
     * Create a child logger with a sub-component name
     */
    child(subComponent: string): StructuredLogger {
        const childLogger = new StructuredLogger(
            `${this.component}:${subComponent}`,
            this.config
        );
        if (this.correlationId) {
            childLogger.setCorrelationId(this.correlationId);
        }
        return childLogger;
    }

    // ========================================================================
    // Core Logging
    // ========================================================================

    private log(
        level: LogLevel,
        message: string,
        metadata?: Record<string, unknown>,
        error?: Error
    ): void {
        // Check log level
        if (level < this.config.level) {
            return;
        }

        // Create log entry
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            levelName: LOG_LEVEL_NAMES[level],
            message,
            component: this.component,
            correlationId: this.correlationId ?? undefined,
            metadata,
        };

        // Add error details if present
        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: (error as any).code,
            };
        }

        // Output the log
        this.output(entry);
    }

    private output(entry: LogEntry): void {
        const formatted = this.format(entry);

        switch (this.config.output) {
            case 'console':
                this.outputToConsole(entry, formatted);
                break;
            case 'file':
                this.outputToFile(formatted);
                break;
            case 'both':
                this.outputToConsole(entry, formatted);
                this.outputToFile(formatted);
                break;
        }
    }

    private format(entry: LogEntry): string {
        if (this.config.format === 'json') {
            return JSON.stringify(entry);
        }

        // Text format
        const parts: string[] = [];

        if (this.config.timestamps) {
            parts.push(`[${entry.timestamp}]`);
        }

        parts.push(`[${entry.levelName}]`);

        if (this.config.includeComponent) {
            parts.push(`[${entry.component}]`);
        }

        if (entry.correlationId) {
            parts.push(`[${entry.correlationId.slice(0, 8)}]`);
        }

        parts.push(entry.message);

        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            parts.push(JSON.stringify(entry.metadata));
        }

        if (entry.error) {
            parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);
            if (entry.error.stack) {
                parts.push(`\n  Stack: ${entry.error.stack}`);
            }
        }

        return parts.join(' ');
    }

    private outputToConsole(entry: LogEntry, formatted: string): void {
        switch (entry.level) {
            case LogLevel.DEBUG:
                console.debug(formatted);
                break;
            case LogLevel.INFO:
                console.info(formatted);
                break;
            case LogLevel.WARN:
                console.warn(formatted);
                break;
            case LogLevel.ERROR:
            case LogLevel.FATAL:
                console.error(formatted);
                break;
        }
    }

    private outputToFile(formatted: string): void {
        // File output would require fs operations
        // For now, this is a placeholder
        if (this.config.filePath) {
            // In a real implementation, we would write to file
            // with rotation support
        }
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a logger for a component
 */
export function createLogger(
    component: string,
    config?: Partial<LoggerConfig>
): StructuredLogger {
    return new StructuredLogger(component, config);
}

/**
 * Parse log level from string
 */
export function parseLogLevel(level: string): LogLevel {
    const upper = level.toUpperCase();
    switch (upper) {
        case 'DEBUG':
            return LogLevel.DEBUG;
        case 'INFO':
            return LogLevel.INFO;
        case 'WARN':
        case 'WARNING':
            return LogLevel.WARN;
        case 'ERROR':
            return LogLevel.ERROR;
        case 'FATAL':
            return LogLevel.FATAL;
        default:
            return LogLevel.INFO;
    }
}

// ============================================================================
// Global Logger
// ============================================================================

let globalLogger: StructuredLogger | null = null;

/**
 * Get the global logger
 */
export function getLogger(): StructuredLogger {
    if (!globalLogger) {
        globalLogger = new StructuredLogger('GateFlow');
    }
    return globalLogger;
}

/**
 * Set the global logger
 */
export function setLogger(logger: StructuredLogger): void {
    globalLogger = logger;
}

/**
 * Initialize global logger with configuration
 */
export function initLogger(config?: Partial<LoggerConfig>): StructuredLogger {
    globalLogger = new StructuredLogger('GateFlow', config);
    return globalLogger;
}

// ============================================================================
// Correlation Context
// ============================================================================

/**
 * Execute a function with a correlation ID
 */
export async function withCorrelation<T>(
    logger: StructuredLogger,
    fn: () => Promise<T>
): Promise<T> {
    const correlationId = logger.generateCorrelationId();
    try {
        return await fn();
    } finally {
        logger.clearCorrelationId();
    }
}
