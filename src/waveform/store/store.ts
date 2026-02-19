/**
 * Waveform Store
 * Unified facade for waveform data access with caching
 */

import * as path from 'path';
import { stat } from 'fs/promises';
import type {
    WaveformProvider,
    WaveformMetadata,
    SignalMetadata,
    SignalData,
    SignalValue,
    ScopeNode,
    TimeRange,
    QueryOptions,
    WaveformStoreConfig,
    CacheStats,
    ClockAnalysis,
    EdgeType,
} from './types.js';
import { SignalDataCache } from './cache.js';
import { VCDProvider } from './vcd-provider.js';
import { getGlobalEventBus } from '../../events/index.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<WaveformStoreConfig> = {
    cacheSize: 100 * 1024 * 1024, // 100MB
    cacheEntries: 1000,
    prefetchEnabled: true,
    prefetchSize: 0.1, // 10% of view
};

// ============================================================================
// Waveform Store
// ============================================================================

/**
 * Main entry point for waveform data access
 * Provides format-agnostic API with intelligent caching
 */
export class WaveformStore {
    private provider: WaveformProvider | null = null;
    private cache: SignalDataCache;
    private config: Required<WaveformStoreConfig>;
    private loadedPath: string | null = null;

    constructor(config?: WaveformStoreConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.cache = new SignalDataCache({
            maxSize: this.config.cacheSize,
            maxEntries: this.config.cacheEntries,
        });
    }

    // ========================================================================
    // File Operations
    // ========================================================================

    /**
     * Open a waveform file
     * Automatically detects format (VCD or FST)
     */
    async open(filePath: string): Promise<WaveformMetadata> {
        const bus = getGlobalEventBus();

        // Resolve to absolute path
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(process.cwd(), filePath);

        // Check file exists
        try {
            await stat(absolutePath);
        } catch {
            throw new Error(`File not found: ${absolutePath}`);
        }

        // Close existing file if open
        if (this.provider) {
            await this.close();
        }

        // Detect format and create provider
        const format = this.detectFormat(absolutePath);
        this.provider = this.createProvider(format);

        // Emit status
        bus.emit({
            type: 'status',
            phase: 'tool',
            label: `Loading ${format.toUpperCase()} file...`
        });

        // Open file
        await this.provider.open(absolutePath);
        this.loadedPath = absolutePath;

        return this.provider.getMetadata();
    }

    /**
     * Close the current file and release resources
     */
    async close(): Promise<void> {
        if (this.provider) {
            await this.provider.close();
            this.provider = null;
        }
        this.loadedPath = null;
        this.cache.clear();
    }

    /**
     * Check if a file is currently open
     */
    isOpen(): boolean {
        return this.provider !== null && this.provider.isOpen();
    }

    /**
     * Get the path of the currently loaded file
     */
    getFilePath(): string | null {
        return this.loadedPath;
    }

    // ========================================================================
    // Metadata Access
    // ========================================================================

    /**
     * Get file metadata
     */
    getMetadata(): WaveformMetadata {
        this.ensureOpen();
        return this.provider!.getMetadata();
    }

    /**
     * Get signal hierarchy
     */
    getHierarchy(): ScopeNode {
        this.ensureOpen();
        return this.provider!.getHierarchy();
    }

    /**
     * Get all signals as flat list
     */
    getSignals(): SignalMetadata[] {
        this.ensureOpen();
        return this.provider!.getSignals();
    }

    /**
     * Find signals by path pattern
     * Supports wildcards: "tb.dut.*" matches all signals in tb.dut
     */
    findSignals(pattern: string): SignalMetadata[] {
        this.ensureOpen();

        const signals = this.provider!.getSignals();

        // Convert pattern to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');

        const regex = new RegExp(`^${regexPattern}$`, 'i');

        return signals.filter(s => regex.test(s.fullPath) || regex.test(s.name));
    }

    /**
     * Find a single signal by exact path or ID
     */
    findSignal(pathOrId: string): SignalMetadata | null {
        this.ensureOpen();
        return this.provider!.findSignal(pathOrId);
    }

    // ========================================================================
    // Data Access (with caching)
    // ========================================================================

    /**
     * Get signal data with caching
     */
    async getSignalData(signalId: string, options?: QueryOptions): Promise<SignalData> {
        this.ensureOpen();

        // Check cache first
        const range = options?.timeStart !== undefined || options?.timeEnd !== undefined
            ? { start: options.timeStart ?? 0n, end: options.timeEnd ?? BigInt(Number.MAX_SAFE_INTEGER) }
            : undefined;

        const cached = this.cache.findCoveringData(signalId, range ?? this.getMetadata().timeRange);
        if (cached && !options?.limit && !options?.offset) {
            // If cached data covers the request, filter and return
            if (range) {
                const filtered = cached.values.filter(v => v.time >= range.start && v.time <= range.end);
                return {
                    ...cached,
                    values: filtered,
                    timeRange: range,
                    isPartial: true
                };
            }
            return cached;
        }

        // Fetch from provider
        const data = await this.provider!.getSignalData(signalId, options);

        // Cache the result (only if it's not a limited query)
        if (!options?.limit && !options?.offset) {
            this.cache.set(signalId, data);
        }

        return data;
    }

    /**
     * Get signal value at a specific time
     */
    async getSignalValue(signalId: string, time: bigint): Promise<SignalValue | null> {
        this.ensureOpen();

        // Try to get from cache first
        const cached = this.cache.get(signalId);
        if (cached) {
            // Binary search in cached values
            const values = cached.values;
            let left = 0;
            let right = values.length - 1;
            let result: SignalValue | null = null;

            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (values[mid].time === time) {
                    return values[mid];
                } else if (values[mid].time < time) {
                    result = values[mid];
                    left = mid + 1;
                } else {
                    right = mid - 1;
                }
            }

            if (result) return result;
        }

        // Fallback to provider
        return this.provider!.getSignalValue(signalId, time);
    }

    /**
     * Get data for multiple signals efficiently
     */
    async getMultipleSignals(signalIds: string[], options?: QueryOptions): Promise<Map<string, SignalData>> {
        this.ensureOpen();

        const result = new Map<string, SignalData>();
        const uncached: string[] = [];

        // Check cache for each signal
        for (const id of signalIds) {
            const cached = this.cache.get(id);
            if (cached && !options?.timeStart && !options?.timeEnd) {
                result.set(id, cached);
            } else {
                uncached.push(id);
            }
        }

        // Fetch uncached signals
        if (uncached.length > 0) {
            const fetched = await this.provider!.getMultipleSignals(uncached, options);
            for (const [id, data] of fetched) {
                result.set(id, data);
                // Cache the full data
                if (!options?.limit && !options?.offset) {
                    this.cache.set(id, data);
                }
            }
        }

        return result;
    }

    /**
     * Get visible window for viewer
     * Returns signal data for the specified time range
     */
    async getVisibleWindow(signalIds: string[], timeRange: TimeRange): Promise<Map<string, SignalData>> {
        return this.getMultipleSignals(signalIds, {
            timeStart: timeRange.start,
            timeEnd: timeRange.end
        });
    }

    // ========================================================================
    // Analysis Helpers
    // ========================================================================

    /**
     * Find signal transitions (edges)
     */
    async findTransitions(
        signalId: string,
        edge: EdgeType = 'any',
        range?: TimeRange
    ): Promise<bigint[]> {
        const data = await this.getSignalData(signalId, range ? {
            timeStart: range.start,
            timeEnd: range.end
        } : undefined);

        const transitions: bigint[] = [];
        const values = data.values;

        for (let i = 1; i < values.length; i++) {
            const prev = values[i - 1].value;
            const curr = values[i].value;

            // Convert to numeric for comparison
            const prevNum = typeof prev === 'number' ? prev : (prev === '1' ? 1 : 0);
            const currNum = typeof curr === 'number' ? curr : (curr === '1' ? 1 : 0);

            if (edge === 'rising' && prevNum === 0 && currNum === 1) {
                transitions.push(values[i].time);
            } else if (edge === 'falling' && prevNum === 1 && currNum === 0) {
                transitions.push(values[i].time);
            } else if (edge === 'any' && prevNum !== currNum) {
                transitions.push(values[i].time);
            }
        }

        return transitions;
    }

    /**
     * Analyze potential clock signals
     */
    async analyzeClocks(): Promise<ClockAnalysis[]> {
        this.ensureOpen();
        const bus = getGlobalEventBus();

        bus.emit({
            type: 'status',
            phase: 'tool',
            label: 'Analyzing clock signals...'
        });

        const signals = this.getSignals();
        const clocks: ClockAnalysis[] = [];

        // Only analyze 1-bit signals with "clk" or "clock" in name
        const clockCandidates = signals.filter(s =>
            s.width === 1 &&
            /clk|clock/i.test(s.name)
        );

        for (const signal of clockCandidates) {
            const data = await this.getSignalData(signal.id);
            const analysis = this.analyzeClockSignal(signal, data);
            if (analysis && analysis.confidence > 0.5) {
                clocks.push(analysis);
            }
        }

        // Sort by confidence
        clocks.sort((a, b) => b.confidence - a.confidence);

        // Emit analysis event
        if (clocks.length > 0) {
            bus.emit({
                type: 'waveform_analysis',
                clocks: clocks.map(c => ({
                    signal: c.signal.fullPath,
                    frequency: c.frequencyHz
                })),
                anomalies: [],
                coverage: { percentage: 100 },
                summary: `Found ${clocks.length} clock signal(s)`
            });
        }

        return clocks;
    }

    private analyzeClockSignal(signal: SignalMetadata, data: SignalData): ClockAnalysis | null {
        const values = data.values;
        if (values.length < 4) return null;

        // Find rising edges
        const risingEdges: bigint[] = [];
        for (let i = 1; i < values.length; i++) {
            const prev = values[i - 1].value;
            const curr = values[i].value;
            if ((prev === 0 || prev === '0') && (curr === 1 || curr === '1')) {
                risingEdges.push(values[i].time);
            }
        }

        if (risingEdges.length < 2) return null;

        // Calculate periods between rising edges
        const periods: bigint[] = [];
        for (let i = 1; i < risingEdges.length; i++) {
            periods.push(risingEdges[i] - risingEdges[i - 1]);
        }

        // Calculate average period and variance
        const avgPeriod = periods.reduce((a, b) => a + b, 0n) / BigInt(periods.length);
        const variance = periods.reduce((sum, p) => {
            const diff = p - avgPeriod;
            return sum + diff * diff;
        }, 0n) / BigInt(periods.length);

        // Calculate confidence based on variance (lower variance = more regular = higher confidence)
        const stdDev = Math.sqrt(Number(variance));
        const confidence = Math.max(0, 1 - stdDev / Number(avgPeriod));

        // Get timescale for frequency calculation
        const metadata = this.getMetadata();
        const timeMultiplier = this.getTimeMultiplier(metadata.timescale.unit);
        const periodSeconds = Number(avgPeriod) * metadata.timescale.value * timeMultiplier;
        const frequencyHz = periodSeconds > 0 ? 1 / periodSeconds : 0;

        // Calculate duty cycle
        let highTime = 0n;
        for (let i = 0; i < values.length - 1; i++) {
            if (values[i].value === 1 || values[i].value === '1') {
                highTime += values[i + 1].time - values[i].time;
            }
        }
        const totalTime = data.timeRange.end - data.timeRange.start;
        const dutyCycle = totalTime > 0n ? Number(highTime) / Number(totalTime) : 0.5;

        return {
            signal,
            frequencyHz,
            period: avgPeriod,
            dutyCycle,
            edgeCount: risingEdges.length,
            confidence
        };
    }

    private getTimeMultiplier(unit: string): number {
        const multipliers: Record<string, number> = {
            's': 1,
            'ms': 1e-3,
            'us': 1e-6,
            'ns': 1e-9,
            'ps': 1e-12,
            'fs': 1e-15
        };
        return multipliers[unit] ?? 1e-9;
    }

    // ========================================================================
    // Cache Management
    // ========================================================================

    /**
     * Get cache statistics
     */
    getCacheStats(): CacheStats {
        return this.cache.getStats();
    }

    /**
     * Clear the cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Detect file format from extension
     */
    private detectFormat(filePath: string): 'vcd' | 'fst' {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.fst') {
            return 'fst';
        }
        return 'vcd'; // Default to VCD
    }

    /**
     * Create provider for the given format
     */
    private createProvider(format: 'vcd' | 'fst'): WaveformProvider {
        switch (format) {
            case 'fst':
                // TODO: Implement FST provider
                throw new Error('FST format not yet supported. Please convert to VCD using vcd2fst.');
            case 'vcd':
            default:
                return new VCDProvider();
        }
    }

    /**
     * Ensure a file is open
     */
    private ensureOpen(): void {
        if (!this.provider || !this.provider.isOpen()) {
            throw new Error('No waveform file open. Call open() first.');
        }
    }
}

// ============================================================================
// Singleton Instance (optional)
// ============================================================================

let globalStore: WaveformStore | null = null;

/**
 * Get global waveform store instance
 */
function getGlobalWaveformStore(): WaveformStore {
    if (!globalStore) {
        globalStore = new WaveformStore();
    }
    return globalStore;
}

/**
 * Reset global store
 */
function resetGlobalWaveformStore(): void {
    if (globalStore) {
        globalStore.close();
    }
    globalStore = null;
}
