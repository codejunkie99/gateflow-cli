/**
 * GateFlow Observability Module
 * Production logging, metrics, and health checks
 */

// Logger
export {
    LogLevel,
    type LogEntry,
    type LoggerConfig,
    StructuredLogger,
    createLogger,
    parseLogLevel,
    getLogger,
    setLogger,
    initLogger,
    withCorrelation,
} from './logger.js';

// Metrics
export {
    type Counter,
    type Gauge,
    type Histogram,
    type HistogramData,
    MetricsRegistry,
    registry,
    metrics,
    getMetricsRegistry,
} from './metrics.js';

// Health
export {
    type HealthState,
    type HealthCheck,
    type HealthStatus,
    type HealthCheckFn,
    HealthChecker,
    verilatorCheck,
    fileSystemCheck,
    apiCheck,
    memoryCheck,
    livenessCheck,
    initHealthChecker,
    getHealthChecker,
    runHealthCheck,
    formatHealthStatus,
} from './health.js';
