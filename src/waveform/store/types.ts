/**
 * Waveform Store Types
 * Core type definitions for the unified waveform data layer
 */

// ============================================================================
// Time Types
// ============================================================================

/**
 * Time range for queries and data windows
 * Using bigint to support very long simulations
 */
export interface TimeRange {
    start: bigint;
    end: bigint;
}

// ============================================================================
// Signal Types
// ============================================================================

/**
 * Variable types supported in VCD/FST
 */
export type SignalType =
    | 'wire'
    | 'reg'
    | 'integer'
    | 'real'
    | 'parameter'
    | 'event'
    | 'supply0'
    | 'supply1'
    | 'tri'
    | 'triand'
    | 'trior'
    | 'tri0'
    | 'tri1'
    | 'wand'
    | 'wor';

/**
 * Signal metadata (always available after file open)
 */
export interface SignalMetadata {
    /** Internal unique identifier */
    id: string;
    /** Short signal name (e.g., "clk") */
    name: string;
    /** Full hierarchical path (e.g., "tb.dut.clk") */
    fullPath: string;
    /** Bit width (1 for single bit, >1 for vectors) */
    width: number;
    /** Variable type */
    type: SignalType;
    /** MSB index for vectors (optional) */
    msb?: number;
    /** LSB index for vectors (optional) */
    lsb?: number;
}

/**
 * Single value change at a point in time
 */
export interface SignalValue {
    /** Timestamp when value changed */
    time: bigint;
    /**
     * Value at this time:
     * - number for single-bit (0, 1)
     * - string for vectors ("10101010"), unknown ("x"), high-Z ("z")
     */
    value: number | string;
}

/**
 * Signal data with values for a time range
 */
export interface SignalData {
    /** Signal metadata */
    metadata: SignalMetadata;
    /** Value changes in time order */
    values: SignalValue[];
    /** Time range covered by this data */
    timeRange: TimeRange;
    /** True if this is a partial window (not all data) */
    isPartial: boolean;
}

// ============================================================================
// Hierarchy Types
// ============================================================================

/**
 * Scope types (module, function, task, etc.)
 */
export type ScopeType =
    | 'module'
    | 'task'
    | 'function'
    | 'begin'
    | 'fork'
    | 'generate'
    | 'struct'
    | 'union'
    | 'class'
    | 'interface'
    | 'package'
    | 'program';

/**
 * Hierarchical scope node
 */
export interface ScopeNode {
    /** Scope name */
    name: string;
    /** Full hierarchical path */
    fullPath: string;
    /** Scope type */
    type: ScopeType;
    /** Child scopes */
    children: ScopeNode[];
    /** Signals directly in this scope */
    signals: SignalMetadata[];
}

// ============================================================================
// Metadata Types
// ============================================================================

/**
 * Timescale information
 */
export interface Timescale {
    /** Numeric value (1, 10, 100) */
    value: number;
    /** Unit (s, ms, us, ns, ps, fs) */
    unit: 's' | 'ms' | 'us' | 'ns' | 'ps' | 'fs';
}

/**
 * Waveform file metadata
 */
export interface WaveformMetadata {
    /** File format */
    format: 'vcd' | 'fst';
    /** Absolute file path */
    filePath: string;
    /** File size in bytes */
    fileSize: number;
    /** Simulation timescale */
    timescale: Timescale;
    /** Total simulation time range */
    timeRange: TimeRange;
    /** Total number of signals */
    signalCount: number;
    /** Root hierarchy node */
    hierarchy: ScopeNode;
    /** VCD version string (if available) */
    version?: string;
    /** VCD date string (if available) */
    date?: string;
    /** VCD comment (if available) */
    comment?: string;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Options for querying signal data
 */
export interface QueryOptions {
    /** Start time (inclusive) */
    timeStart?: bigint;
    /** End time (inclusive) */
    timeEnd?: bigint;
    /** Maximum number of value changes to return */
    limit?: number;
    /** Number of value changes to skip */
    offset?: number;
}

/**
 * Edge type for transition searches
 */
export type EdgeType = 'rising' | 'falling' | 'any';

/**
 * Clock analysis result
 */
export interface ClockAnalysis {
    /** Signal that appears to be a clock */
    signal: SignalMetadata;
    /** Detected frequency in Hz */
    frequencyHz: number;
    /** Period in simulation time units */
    period: bigint;
    /** Duty cycle (0.0 - 1.0) */
    dutyCycle: number;
    /** Number of edges analyzed */
    edgeCount: number;
    /** Confidence score (0.0 - 1.0) */
    confidence: number;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Abstract interface for waveform format providers
 * Implementations: VCDProvider, FSTProvider
 */
export interface WaveformProvider {
    /** Format this provider handles */
    readonly format: 'vcd' | 'fst';

    // --- Lifecycle ---

    /**
     * Open a waveform file
     * @param filePath Absolute path to the file
     */
    open(filePath: string): Promise<void>;

    /**
     * Close the file and release resources
     */
    close(): Promise<void>;

    /**
     * Check if a file is currently open
     */
    isOpen(): boolean;

    // --- Metadata ---

    /**
     * Get file metadata
     * @throws Error if no file is open
     */
    getMetadata(): WaveformMetadata;

    /**
     * Get the signal hierarchy tree
     */
    getHierarchy(): ScopeNode;

    /**
     * Get all signals as a flat list
     */
    getSignals(): SignalMetadata[];

    /**
     * Find a signal by path or ID
     * @param pathOrId Signal path (e.g., "tb.dut.clk") or internal ID
     */
    findSignal(pathOrId: string): SignalMetadata | null;

    // --- Data Retrieval ---

    /**
     * Get value changes for a signal
     * @param signalId Signal ID
     * @param options Query options (time range, limit)
     */
    getSignalData(signalId: string, options?: QueryOptions): Promise<SignalData>;

    /**
     * Get signal value at a specific time
     * Returns the value that was active at that time
     * @param signalId Signal ID
     * @param time Timestamp to query
     */
    getSignalValue(signalId: string, time: bigint): Promise<SignalValue | null>;

    /**
     * Get data for multiple signals efficiently
     * @param signalIds Array of signal IDs
     * @param options Query options
     */
    getMultipleSignals(signalIds: string[], options?: QueryOptions): Promise<Map<string, SignalData>>;
}

// ============================================================================
// Store Configuration
// ============================================================================

/**
 * Configuration for WaveformStore
 */
export interface WaveformStoreConfig {
    /** Maximum cache size in bytes (default: 100MB) */
    cacheSize?: number;
    /** Maximum number of cache entries (default: 1000) */
    cacheEntries?: number;
    /** Enable prefetching adjacent time windows (default: true) */
    prefetchEnabled?: boolean;
    /** Prefetch window size in time units (default: 10% of view) */
    prefetchSize?: number;
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache statistics
 */
export interface CacheStats {
    /** Number of cache hits */
    hits: number;
    /** Number of cache misses */
    misses: number;
    /** Current cache size in bytes */
    size: number;
    /** Number of entries in cache */
    entries: number;
    /** Hit rate (0.0 - 1.0) */
    hitRate: number;
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
    /** Cached data */
    data: T;
    /** Size of this entry in bytes (estimated) */
    size: number;
    /** Last access timestamp */
    accessTime: number;
    /** Cache key */
    key: string;
}
