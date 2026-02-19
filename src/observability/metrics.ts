/**
 * GateFlow Metrics Registry
 * Prometheus-compatible metrics collection for observability
 */

// ============================================================================
// Metric Types
// ============================================================================

interface Counter {
    /** Increment by 1 */
    inc(labels?: Record<string, string>): void;
    /** Increment by value */
    inc(value: number, labels?: Record<string, string>): void;
    /** Get current value */
    get(labels?: Record<string, string>): number;
    /** Reset counter */
    reset(): void;
}

interface Gauge {
    /** Set gauge value */
    set(value: number, labels?: Record<string, string>): void;
    /** Increment gauge */
    inc(labels?: Record<string, string>): void;
    /** Decrement gauge */
    dec(labels?: Record<string, string>): void;
    /** Get current value */
    get(labels?: Record<string, string>): number;
}

interface Histogram {
    /** Record an observation */
    observe(value: number, labels?: Record<string, string>): void;
    /** Start a timer, returns function to stop and record */
    startTimer(labels?: Record<string, string>): () => number;
    /** Get histogram data */
    get(labels?: Record<string, string>): HistogramData;
}

interface HistogramData {
    count: number;
    sum: number;
    buckets: Map<number, number>;
}

// ============================================================================
// Metric Implementation
// ============================================================================

class CounterImpl implements Counter {
    private values = new Map<string, number>();

    constructor(
        public readonly name: string,
        public readonly help: string,
        public readonly labelNames: string[] = []
    ) {}

    inc(valueOrLabels?: number | Record<string, string>, labels?: Record<string, string>): void {
        let value = 1;
        let actualLabels: Record<string, string> | undefined;

        if (typeof valueOrLabels === 'number') {
            value = valueOrLabels;
            actualLabels = labels;
        } else {
            actualLabels = valueOrLabels;
        }

        const key = this.labelsToKey(actualLabels);
        const current = this.values.get(key) ?? 0;
        this.values.set(key, current + value);
    }

    get(labels?: Record<string, string>): number {
        const key = this.labelsToKey(labels);
        return this.values.get(key) ?? 0;
    }

    reset(): void {
        this.values.clear();
    }

    toPrometheus(): string {
        const lines: string[] = [];
        lines.push(`# HELP ${this.name} ${this.help}`);
        lines.push(`# TYPE ${this.name} counter`);

        for (const [key, value] of this.values) {
            const labelStr = key ? `{${key}}` : '';
            lines.push(`${this.name}${labelStr} ${value}`);
        }

        return lines.join('\n');
    }

    private labelsToKey(labels?: Record<string, string>): string {
        if (!labels || Object.keys(labels).length === 0) return '';
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }
}

class GaugeImpl implements Gauge {
    private values = new Map<string, number>();

    constructor(
        public readonly name: string,
        public readonly help: string,
        public readonly labelNames: string[] = []
    ) {}

    set(value: number, labels?: Record<string, string>): void {
        const key = this.labelsToKey(labels);
        this.values.set(key, value);
    }

    inc(labels?: Record<string, string>): void {
        const key = this.labelsToKey(labels);
        const current = this.values.get(key) ?? 0;
        this.values.set(key, current + 1);
    }

    dec(labels?: Record<string, string>): void {
        const key = this.labelsToKey(labels);
        const current = this.values.get(key) ?? 0;
        this.values.set(key, current - 1);
    }

    get(labels?: Record<string, string>): number {
        const key = this.labelsToKey(labels);
        return this.values.get(key) ?? 0;
    }

    toPrometheus(): string {
        const lines: string[] = [];
        lines.push(`# HELP ${this.name} ${this.help}`);
        lines.push(`# TYPE ${this.name} gauge`);

        for (const [key, value] of this.values) {
            const labelStr = key ? `{${key}}` : '';
            lines.push(`${this.name}${labelStr} ${value}`);
        }

        return lines.join('\n');
    }

    private labelsToKey(labels?: Record<string, string>): string {
        if (!labels || Object.keys(labels).length === 0) return '';
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }
}

class HistogramImpl implements Histogram {
    private data = new Map<string, HistogramData>();
    private bucketBoundaries: number[];

    constructor(
        public readonly name: string,
        public readonly help: string,
        buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        public readonly labelNames: string[] = []
    ) {
        this.bucketBoundaries = [...buckets].sort((a, b) => a - b);
    }

    observe(value: number, labels?: Record<string, string>): void {
        const key = this.labelsToKey(labels);
        let data = this.data.get(key);

        if (!data) {
            data = {
                count: 0,
                sum: 0,
                buckets: new Map(this.bucketBoundaries.map(b => [b, 0])),
            };
            this.data.set(key, data);
        }

        data.count++;
        data.sum += value;

        for (const boundary of this.bucketBoundaries) {
            if (value <= boundary) {
                data.buckets.set(boundary, (data.buckets.get(boundary) ?? 0) + 1);
            }
        }
    }

    startTimer(labels?: Record<string, string>): () => number {
        const start = performance.now();
        return () => {
            const duration = (performance.now() - start) / 1000; // Convert to seconds
            this.observe(duration, labels);
            return duration;
        };
    }

    get(labels?: Record<string, string>): HistogramData {
        const key = this.labelsToKey(labels);
        return this.data.get(key) ?? {
            count: 0,
            sum: 0,
            buckets: new Map(),
        };
    }

    toPrometheus(): string {
        const lines: string[] = [];
        lines.push(`# HELP ${this.name} ${this.help}`);
        lines.push(`# TYPE ${this.name} histogram`);

        for (const [key, data] of this.data) {
            const labelStr = key ? `,${key}` : '';

            // Bucket counts (cumulative)
            let cumulative = 0;
            for (const boundary of this.bucketBoundaries) {
                cumulative += data.buckets.get(boundary) ?? 0;
                lines.push(`${this.name}_bucket{le="${boundary}"${labelStr}} ${cumulative}`);
            }
            lines.push(`${this.name}_bucket{le="+Inf"${labelStr}} ${data.count}`);

            // Sum and count
            const baseLabelStr = key ? `{${key}}` : '';
            lines.push(`${this.name}_sum${baseLabelStr} ${data.sum}`);
            lines.push(`${this.name}_count${baseLabelStr} ${data.count}`);
        }

        return lines.join('\n');
    }

    private labelsToKey(labels?: Record<string, string>): string {
        if (!labels || Object.keys(labels).length === 0) return '';
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }
}

// ============================================================================
// Metrics Registry
// ============================================================================

class MetricsRegistry {
    private counters = new Map<string, CounterImpl>();
    private gauges = new Map<string, GaugeImpl>();
    private histograms = new Map<string, HistogramImpl>();

    /**
     * Create a counter metric
     */
    createCounter(name: string, help: string, labelNames?: string[]): Counter {
        if (this.counters.has(name)) {
            return this.counters.get(name)!;
        }
        const counter = new CounterImpl(name, help, labelNames);
        this.counters.set(name, counter);
        return counter;
    }

    /**
     * Create a gauge metric
     */
    createGauge(name: string, help: string, labelNames?: string[]): Gauge {
        if (this.gauges.has(name)) {
            return this.gauges.get(name)!;
        }
        const gauge = new GaugeImpl(name, help, labelNames);
        this.gauges.set(name, gauge);
        return gauge;
    }

    /**
     * Create a histogram metric
     */
    createHistogram(
        name: string,
        help: string,
        buckets?: number[],
        labelNames?: string[]
    ): Histogram {
        if (this.histograms.has(name)) {
            return this.histograms.get(name)!;
        }
        const histogram = new HistogramImpl(name, help, buckets, labelNames);
        this.histograms.set(name, histogram);
        return histogram;
    }

    /**
     * Get a counter by name
     */
    getCounter(name: string): Counter | undefined {
        return this.counters.get(name);
    }

    /**
     * Get a gauge by name
     */
    getGauge(name: string): Gauge | undefined {
        return this.gauges.get(name);
    }

    /**
     * Get a histogram by name
     */
    getHistogram(name: string): Histogram | undefined {
        return this.histograms.get(name);
    }

    /**
     * Export all metrics in Prometheus format
     */
    toPrometheus(): string {
        const sections: string[] = [];

        for (const counter of this.counters.values()) {
            sections.push(counter.toPrometheus());
        }

        for (const gauge of this.gauges.values()) {
            sections.push(gauge.toPrometheus());
        }

        for (const histogram of this.histograms.values()) {
            sections.push(histogram.toPrometheus());
        }

        return sections.join('\n\n');
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        for (const counter of this.counters.values()) {
            counter.reset();
        }
        // Gauges and histograms don't have reset methods in this implementation
    }

    /**
     * Get all metric names
     */
    getMetricNames(): { counters: string[]; gauges: string[]; histograms: string[] } {
        return {
            counters: [...this.counters.keys()],
            gauges: [...this.gauges.keys()],
            histograms: [...this.histograms.keys()],
        };
    }
}

// ============================================================================
// Global Registry and Pre-defined Metrics
// ============================================================================

const registry = new MetricsRegistry();

/**
 * Pre-defined metrics for GateFlow
 */
export const metrics = {
    // Tool metrics
    toolExecutions: registry.createCounter(
        'gateflow_tool_executions_total',
        'Total number of tool executions',
        ['tool', 'status']
    ),
    toolDuration: registry.createHistogram(
        'gateflow_tool_duration_seconds',
        'Tool execution duration in seconds',
        [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
        ['tool']
    ),
    toolErrors: registry.createCounter(
        'gateflow_tool_errors_total',
        'Total number of tool errors',
        ['tool', 'error_code']
    ),

    // API metrics
    apiRequests: registry.createCounter(
        'gateflow_api_requests_total',
        'Total API requests',
        ['model', 'status']
    ),
    apiLatency: registry.createHistogram(
        'gateflow_api_latency_seconds',
        'API request latency in seconds',
        [0.5, 1, 2, 5, 10, 30],
        ['model']
    ),
    apiTokens: registry.createCounter(
        'gateflow_api_tokens_total',
        'Total tokens used',
        ['model', 'type']
    ),

    // Agent metrics
    activeAgents: registry.createGauge(
        'gateflow_active_agents',
        'Number of currently active agents'
    ),
    agentExecutions: registry.createCounter(
        'gateflow_agent_executions_total',
        'Total agent task executions',
        ['agent', 'status']
    ),
    agentDuration: registry.createHistogram(
        'gateflow_agent_duration_seconds',
        'Agent execution duration in seconds',
        [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
        ['agent', 'status']
    ),
    agentSteps: registry.createCounter(
        'gateflow_agent_steps_total',
        'Total agent steps executed',
        ['agent', 'status']
    ),

    // Event metrics
    eventQueueSize: registry.createGauge(
        'gateflow_event_queue_size',
        'Current event queue size'
    ),
    eventsEmitted: registry.createCounter(
        'gateflow_events_emitted_total',
        'Total events emitted',
        ['type']
    ),

    // Circuit breaker metrics
    circuitBreakerState: registry.createGauge(
        'gateflow_circuit_breaker_state',
        'Circuit breaker state (0=closed, 1=half_open, 2=open)',
        ['name']
    ),
    circuitBreakerTrips: registry.createCounter(
        'gateflow_circuit_breaker_trips_total',
        'Total circuit breaker trips',
        ['name']
    ),

    // Session metrics
    sessionDuration: registry.createHistogram(
        'gateflow_session_duration_seconds',
        'Agent session duration in seconds',
        [60, 300, 600, 1800, 3600]
    ),

    // Timeout metrics
    taskTimeouts: registry.createCounter(
        'gateflow_task_timeouts_total',
        'Total number of task timeouts',
        ['agent']
    ),
    timeoutDuration: registry.createHistogram(
        'gateflow_timeout_duration_seconds',
        'Duration at which tasks timed out',
        [30, 60, 120, 180, 300, 600],
        ['agent']
    ),
};

/**
 * Get the global metrics registry
 */
function getMetricsRegistry(): MetricsRegistry {
    return registry;
}
