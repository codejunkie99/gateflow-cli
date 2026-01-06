/**
 * Waveform Module
 * VCD waveform viewing for GateFlow (terminal and web-based)
 */

// Terminal viewer
export { VCDParser } from './parser.js';
export { WaveformRenderer } from './renderer.js';
export { Navigator } from './navigator.js';
export { HierarchyBrowser } from './hierarchy.js';
export { WaveformViewer } from './viewer.js';

// MCP server
export { WaveformMCPServer, startMCPServer } from './mcp-server.js';

// Web viewer
export {
    WaveformWebviewProvider,
    createWaveformWebviewProvider,
    startStandaloneServer,
} from './web/index.js';

// Store (unified data layer)
export {
    WaveformStore,
    getGlobalWaveformStore,
    VCDProvider,
} from './store/index.js';

// Types
export type {
    WaveformData,
    WaveformSignal,
    WaveformScope,
    DisplaySignal,
    ViewState,
    VCDHeader,
    VCDVariable,
    VCDVarType,
    VCDParserOptions,
    ValueFormat,
    RenderOptions,
    RenderedSignal,
    HierarchyNode,
} from './types.js';

export type {
    WebviewLike,
    WebviewPanelLike,
    StandaloneServerOptions,
} from './web/index.js';

export type {
    WaveformMetadata,
    SignalMetadata,
    SignalData,
    TimeRange,
} from './store/index.js';
