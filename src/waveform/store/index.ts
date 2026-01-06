/**
 * Waveform Store Module
 * Unified data layer for waveform access
 */

// Main store
export {
    WaveformStore,
    getGlobalWaveformStore,
    resetGlobalWaveformStore,
} from './store.js';

// Providers
export { VCDProvider, type VCDProviderConfig } from './vcd-provider.js';
// export { FSTProvider } from './fst-provider.js'; // TODO

// Cache
export {
    LRUCache,
    SignalDataCache,
    MetadataCache,
    type LRUCacheConfig,
} from './cache.js';

// Types
export type {
    // Time
    TimeRange,

    // Signals
    SignalType,
    SignalMetadata,
    SignalValue,
    SignalData,

    // Hierarchy
    ScopeType,
    ScopeNode,

    // Metadata
    Timescale,
    WaveformMetadata,

    // Queries
    QueryOptions,
    EdgeType,
    ClockAnalysis,

    // Provider
    WaveformProvider,

    // Config
    WaveformStoreConfig,

    // Cache
    CacheStats,
    CacheEntry,
} from './types.js';
