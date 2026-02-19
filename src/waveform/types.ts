/**
 * Waveform Types
 * Types for VCD parsing and waveform display
 */

export interface WaveformSignal {
    name: string;
    width: number;
    values: [number, number | string][]; // [timestamp, value]
    id: string;
}

export interface WaveformScope {
    name: string;
    children: WaveformScope[];
    signals: string[]; // IDs of signals in this scope
}

export interface WaveformData {
    timescale: string;
    signals: WaveformSignal[];
    rootScope: WaveformScope;
}

interface DisplaySignal {
    signal: WaveformSignal;
    fullPath: string;
    currentValue: string;
    selected: boolean;
}

export interface ViewState {
    timeStart: number;
    timeEnd: number;
    zoom: number;
    selectedIndex: number;
    cursorTime: number | null;
}

// VCD Parser Types
export interface VCDHeader {
    version: string;
    date: string;
    timescale: { value: number; unit: string };
}

export type VCDVarType = 'wire' | 'reg' | 'integer' | 'real' | 'parameter' | 'event';

export interface VCDVariable {
    type: VCDVarType;
    size: number;
    id: string;
    name: string;
    fullPath: string;
}

export interface VCDParserOptions {
    maxSignals?: number;
    maxTimestamps?: number;
    signalFilter?: RegExp;
}

// Renderer Types
export type ValueFormat = 'hex' | 'binary' | 'decimal' | 'auto';

export interface RenderOptions {
    width: number;
    showValues: boolean;
    valueFormat: ValueFormat;
}

export interface RenderedSignal {
    label: string;
    value: string;
    waveform: string;
}

// Hierarchy Types
export interface HierarchyNode {
    name: string;
    fullPath: string;
    type: 'scope' | 'signal';
    expanded: boolean;
    children: HierarchyNode[];
    signal?: WaveformSignal;
    depth: number;
}
