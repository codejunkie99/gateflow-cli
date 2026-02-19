/**
 * VCD Provider
 * WaveformProvider implementation for VCD (Value Change Dump) files
 */

import { readFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type {
    WaveformProvider,
    WaveformMetadata,
    SignalMetadata,
    SignalData,
    SignalValue,
    SignalType,
    ScopeNode,
    ScopeType,
    Timescale,
    TimeRange,
    QueryOptions,
} from './types.js';
import { getGlobalEventBus } from '../../events/index.js';

// ============================================================================
// Types
// ============================================================================

type ParserState = 'header' | 'definitions' | 'values';

interface VCDHeader {
    version: string;
    date: string;
    timescale: Timescale;
    comment?: string;
}

interface InternalSignal {
    metadata: SignalMetadata;
    values: SignalValue[];
}

// ============================================================================
// VCD Provider Configuration
// ============================================================================

interface VCDProviderConfig {
    /** Maximum signals to parse (default: 10000) */
    maxSignals?: number;
    /** Maximum timestamps to parse (default: unlimited for FST-style, 100000 for full load) */
    maxTimestamps?: number;
    /** Signal filter regex */
    signalFilter?: RegExp;
    /** File size threshold for streaming (default: 50MB) */
    streamingThreshold?: number;
}

const DEFAULT_CONFIG: Required<VCDProviderConfig> = {
    maxSignals: 10000,
    maxTimestamps: 1000000,
    signalFilter: /.*/,
    streamingThreshold: 50 * 1024 * 1024, // 50MB
};

// ============================================================================
// VCD Provider Implementation
// ============================================================================

export class VCDProvider implements WaveformProvider {
    readonly format = 'vcd' as const;

    private config: Required<VCDProviderConfig>;
    private filePath: string | null = null;
    private fileSize: number = 0;
    private metadata: WaveformMetadata | null = null;
    private signals: Map<string, InternalSignal> = new Map();
    private signalsByPath: Map<string, string> = new Map(); // fullPath -> id
    private hierarchy: ScopeNode | null = null;
    private isLoaded: boolean = false;

    constructor(config: VCDProviderConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    async open(filePath: string): Promise<void> {
        const bus = getGlobalEventBus();

        // Emit loading start
        bus.emit({
            type: 'sim_stage',
            stage: 'parse_vcd',
            status: 'started',
            message: `Loading VCD: ${filePath}`
        });

        try {
            const stats = await stat(filePath);
            this.fileSize = stats.size;
            this.filePath = filePath;

            // Decide parsing strategy based on file size
            if (this.fileSize > this.config.streamingThreshold) {
                await this.parseStreaming(filePath);
            } else {
                await this.parseFull(filePath);
            }

            this.isLoaded = true;

            // Emit success
            bus.emit({
                type: 'sim_stage',
                stage: 'parse_vcd',
                status: 'completed',
                message: `Loaded ${this.signals.size} signals`
            });

            bus.emit({
                type: 'waveform_loaded',
                path: filePath,
                signalCount: this.signals.size,
                timeRange: this.metadata!.timeRange
            });

        } catch (error) {
            bus.emit({
                type: 'sim_stage',
                stage: 'parse_vcd',
                status: 'failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    async close(): Promise<void> {
        this.filePath = null;
        this.fileSize = 0;
        this.metadata = null;
        this.signals.clear();
        this.signalsByPath.clear();
        this.hierarchy = null;
        this.isLoaded = false;
    }

    isOpen(): boolean {
        return this.isLoaded;
    }

    // ========================================================================
    // Metadata
    // ========================================================================

    getMetadata(): WaveformMetadata {
        this.ensureLoaded();
        return this.metadata!;
    }

    getHierarchy(): ScopeNode {
        this.ensureLoaded();
        return this.hierarchy!;
    }

    getSignals(): SignalMetadata[] {
        this.ensureLoaded();
        return Array.from(this.signals.values()).map(s => s.metadata);
    }

    findSignal(pathOrId: string): SignalMetadata | null {
        this.ensureLoaded();

        // Try direct ID lookup
        const byId = this.signals.get(pathOrId);
        if (byId) return byId.metadata;

        // Try path lookup
        const id = this.signalsByPath.get(pathOrId);
        if (id) {
            const signal = this.signals.get(id);
            return signal?.metadata ?? null;
        }

        return null;
    }

    // ========================================================================
    // Data Retrieval
    // ========================================================================

    async getSignalData(signalId: string, options?: QueryOptions): Promise<SignalData> {
        this.ensureLoaded();

        const signal = this.signals.get(signalId);
        if (!signal) {
            throw new Error(`Signal not found: ${signalId}`);
        }

        let values = signal.values;
        let isPartial = false;

        // Apply time range filter
        if (options?.timeStart !== undefined || options?.timeEnd !== undefined) {
            const start = options.timeStart ?? 0n;
            const end = options.timeEnd ?? BigInt(Number.MAX_SAFE_INTEGER);

            values = values.filter(v => v.time >= start && v.time <= end);
            isPartial = true;
        }

        // Apply offset
        if (options?.offset !== undefined && options.offset > 0) {
            values = values.slice(options.offset);
            isPartial = true;
        }

        // Apply limit
        if (options?.limit !== undefined && options.limit > 0) {
            values = values.slice(0, options.limit);
            isPartial = true;
        }

        const timeRange: TimeRange = values.length > 0
            ? { start: values[0].time, end: values[values.length - 1].time }
            : this.metadata!.timeRange;

        return {
            metadata: signal.metadata,
            values,
            timeRange,
            isPartial
        };
    }

    async getSignalValue(signalId: string, time: bigint): Promise<SignalValue | null> {
        this.ensureLoaded();

        const signal = this.signals.get(signalId);
        if (!signal) return null;

        // Binary search for the value at or before the given time
        const values = signal.values;
        if (values.length === 0) return null;

        let left = 0;
        let right = values.length - 1;
        let result: SignalValue | null = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const midTime = values[mid].time;

            if (midTime === time) {
                return values[mid];
            } else if (midTime < time) {
                result = values[mid]; // This is a candidate
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        return result;
    }

    async getMultipleSignals(signalIds: string[], options?: QueryOptions): Promise<Map<string, SignalData>> {
        const result = new Map<string, SignalData>();

        for (const id of signalIds) {
            try {
                const data = await this.getSignalData(id, options);
                result.set(id, data);
            } catch {
                // Skip signals that don't exist
            }
        }

        return result;
    }

    // ========================================================================
    // Parsing - Full Load
    // ========================================================================

    private async parseFull(filePath: string): Promise<void> {
        const content = await readFile(filePath, 'utf-8');
        this.parseContent(content);
    }

    private parseContent(content: string): void {
        const bus = getGlobalEventBus();
        const lines = content.split('\n');
        const totalLines = lines.length;

        let state: ParserState = 'header';
        const header: VCDHeader = {
            version: '',
            date: '',
            timescale: { value: 1, unit: 'ns' }
        };

        const scopeStack: string[] = [];
        const rootScope: ScopeNode = {
            name: 'root',
            fullPath: '',
            type: 'module',
            children: [],
            signals: []
        };
        const scopeMap = new Map<string, ScopeNode>();
        scopeMap.set('', rootScope);

        let currentTime = 0n;
        let lineBuffer = '';
        let timestampCount = 0;
        let minTime = BigInt(Number.MAX_SAFE_INTEGER);
        let maxTime = 0n;
        let lastProgressUpdate = 0;

        for (let i = 0; i < lines.length; i++) {
            // Progress update every 5%
            const progress = Math.floor((i / totalLines) * 100);
            if (progress >= lastProgressUpdate + 5) {
                lastProgressUpdate = progress;
                bus.emit({
                    type: 'sim_progress',
                    stage: 'parse_vcd',
                    percent: progress,
                    message: `Parsing VCD: ${progress}%`
                });
            }

            const rawLine = lines[i];
            const line = (lineBuffer + rawLine).trim();

            // Handle multi-line statements
            if (line.startsWith('$') && !line.includes('$end') && !line.endsWith('$end')) {
                lineBuffer = line + ' ';
                continue;
            }
            lineBuffer = '';

            if (!line) continue;

            if (state === 'header' || state === 'definitions') {
                if (line.startsWith('$version')) {
                    header.version = this.extractValue(line, '$version');
                } else if (line.startsWith('$date')) {
                    header.date = this.extractValue(line, '$date');
                } else if (line.startsWith('$comment')) {
                    header.comment = this.extractValue(line, '$comment');
                } else if (line.startsWith('$timescale')) {
                    header.timescale = this.parseTimescale(line);
                } else if (line.startsWith('$scope')) {
                    const match = line.match(/\$scope\s+(\w+)\s+(\S+)/);
                    if (match) {
                        const scopeType = match[1] as ScopeType;
                        const scopeName = match[2];
                        scopeStack.push(scopeName);
                        const fullPath = scopeStack.join('.');
                        const parentPath = scopeStack.slice(0, -1).join('.');
                        const parent = scopeMap.get(parentPath) ?? rootScope;

                        const newScope: ScopeNode = {
                            name: scopeName,
                            fullPath,
                            type: scopeType,
                            children: [],
                            signals: []
                        };
                        parent.children.push(newScope);
                        scopeMap.set(fullPath, newScope);
                    }
                    state = 'definitions';
                } else if (line.startsWith('$upscope')) {
                    scopeStack.pop();
                } else if (line.startsWith('$var')) {
                    const varDef = this.parseVariable(line, scopeStack);
                    if (varDef && this.signals.size < this.config.maxSignals) {
                        if (this.config.signalFilter.test(varDef.fullPath)) {
                            const scopePath = scopeStack.join('.');
                            const scope = scopeMap.get(scopePath) ?? rootScope;
                            scope.signals.push(varDef);

                            this.signals.set(varDef.id, {
                                metadata: varDef,
                                values: []
                            });
                            this.signalsByPath.set(varDef.fullPath, varDef.id);
                        }
                    }
                } else if (line.startsWith('$enddefinitions')) {
                    state = 'values';
                }
            } else if (state === 'values') {
                if (line.startsWith('#')) {
                    // Timestamp
                    currentTime = BigInt(line.slice(1));
                    if (currentTime < minTime) minTime = currentTime;
                    if (currentTime > maxTime) maxTime = currentTime;

                    timestampCount++;
                    if (timestampCount > this.config.maxTimestamps) {
                        break;
                    }
                } else if (line.startsWith('$')) {
                    // Skip other commands in value section
                    continue;
                } else {
                    // Value change
                    this.parseValueChange(line, currentTime);
                }
            }
        }

        // Fix time range if no timestamps found
        if (minTime > maxTime) {
            minTime = 0n;
            maxTime = 0n;
        }

        // Build metadata
        this.hierarchy = rootScope;
        this.metadata = {
            format: 'vcd',
            filePath: this.filePath!,
            fileSize: this.fileSize,
            timescale: header.timescale,
            timeRange: { start: minTime, end: maxTime },
            signalCount: this.signals.size,
            hierarchy: rootScope,
            version: header.version || undefined,
            date: header.date || undefined,
            comment: header.comment
        };
    }

    // ========================================================================
    // Parsing - Streaming (for large files)
    // ========================================================================

    private async parseStreaming(filePath: string): Promise<void> {
        const bus = getGlobalEventBus();

        // First pass: parse header and definitions only
        const headerResult = await this.parseHeaderOnly(filePath);

        // Emit progress
        bus.emit({
            type: 'sim_progress',
            stage: 'parse_vcd',
            percent: 50,
            message: 'Parsing value changes...'
        });

        // Second pass: stream value changes
        await this.streamValueChanges(filePath, headerResult);
    }

    private async parseHeaderOnly(filePath: string): Promise<{
        header: VCDHeader;
        rootScope: ScopeNode;
        scopeMap: Map<string, ScopeNode>;
        endDefLine: number;
    }> {
        const bus = getGlobalEventBus();
        const header: VCDHeader = {
            version: '',
            date: '',
            timescale: { value: 1, unit: 'ns' }
        };

        const scopeStack: string[] = [];
        const rootScope: ScopeNode = {
            name: 'root',
            fullPath: '',
            type: 'module',
            children: [],
            signals: []
        };
        const scopeMap = new Map<string, ScopeNode>();
        scopeMap.set('', rootScope);

        let state: ParserState = 'header';
        let lineBuffer = '';
        let lineNumber = 0;
        let endDefLine = 0;

        const rl = createInterface({
            input: createReadStream(filePath, { encoding: 'utf-8' }),
            crlfDelay: Infinity
        });

        for await (const rawLine of rl) {
            lineNumber++;
            const line = (lineBuffer + rawLine).trim();

            if (line.startsWith('$') && !line.includes('$end') && !line.endsWith('$end')) {
                lineBuffer = line + ' ';
                continue;
            }
            lineBuffer = '';

            if (!line) continue;

            if (line.startsWith('$version')) {
                header.version = this.extractValue(line, '$version');
            } else if (line.startsWith('$date')) {
                header.date = this.extractValue(line, '$date');
            } else if (line.startsWith('$comment')) {
                header.comment = this.extractValue(line, '$comment');
            } else if (line.startsWith('$timescale')) {
                header.timescale = this.parseTimescale(line);
            } else if (line.startsWith('$scope')) {
                const match = line.match(/\$scope\s+(\w+)\s+(\S+)/);
                if (match) {
                    const scopeType = match[1] as ScopeType;
                    const scopeName = match[2];
                    scopeStack.push(scopeName);
                    const fullPath = scopeStack.join('.');
                    const parentPath = scopeStack.slice(0, -1).join('.');
                    const parent = scopeMap.get(parentPath) ?? rootScope;

                    const newScope: ScopeNode = {
                        name: scopeName,
                        fullPath,
                        type: scopeType,
                        children: [],
                        signals: []
                    };
                    parent.children.push(newScope);
                    scopeMap.set(fullPath, newScope);
                }
                state = 'definitions';
            } else if (line.startsWith('$upscope')) {
                scopeStack.pop();
            } else if (line.startsWith('$var')) {
                const varDef = this.parseVariable(line, scopeStack);
                if (varDef && this.signals.size < this.config.maxSignals) {
                    if (this.config.signalFilter.test(varDef.fullPath)) {
                        const scopePath = scopeStack.join('.');
                        const scope = scopeMap.get(scopePath) ?? rootScope;
                        scope.signals.push(varDef);

                        this.signals.set(varDef.id, {
                            metadata: varDef,
                            values: []
                        });
                        this.signalsByPath.set(varDef.fullPath, varDef.id);
                    }
                }
            } else if (line.startsWith('$enddefinitions')) {
                endDefLine = lineNumber;
                break;
            }
        }

        bus.emit({
            type: 'sim_progress',
            stage: 'parse_vcd',
            percent: 25,
            message: `Found ${this.signals.size} signals`
        });

        return { header, rootScope, scopeMap, endDefLine };
    }

    private async streamValueChanges(filePath: string, headerResult: {
        header: VCDHeader;
        rootScope: ScopeNode;
        scopeMap: Map<string, ScopeNode>;
        endDefLine: number;
    }): Promise<void> {
        const bus = getGlobalEventBus();
        let currentTime = 0n;
        let minTime = BigInt(Number.MAX_SAFE_INTEGER);
        let maxTime = 0n;
        let timestampCount = 0;
        let lineNumber = 0;
        let lastProgressUpdate = 0;

        const rl = createInterface({
            input: createReadStream(filePath, { encoding: 'utf-8' }),
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            lineNumber++;

            // Skip header section
            if (lineNumber <= headerResult.endDefLine) continue;

            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('$')) continue;

            if (trimmed.startsWith('#')) {
                currentTime = BigInt(trimmed.slice(1));
                if (currentTime < minTime) minTime = currentTime;
                if (currentTime > maxTime) maxTime = currentTime;

                timestampCount++;

                // Progress update
                const progress = 50 + Math.min(50, Math.floor((timestampCount / 100000) * 50));
                if (progress >= lastProgressUpdate + 5) {
                    lastProgressUpdate = progress;
                    bus.emit({
                        type: 'sim_progress',
                        stage: 'parse_vcd',
                        percent: progress,
                        message: `Processing timestamps: ${timestampCount}`
                    });
                }

                if (timestampCount > this.config.maxTimestamps) {
                    break;
                }
            } else {
                this.parseValueChange(trimmed, currentTime);
            }
        }

        // Fix time range
        if (minTime > maxTime) {
            minTime = 0n;
            maxTime = 0n;
        }

        // Build metadata
        this.hierarchy = headerResult.rootScope;
        this.metadata = {
            format: 'vcd',
            filePath: this.filePath!,
            fileSize: this.fileSize,
            timescale: headerResult.header.timescale,
            timeRange: { start: minTime, end: maxTime },
            signalCount: this.signals.size,
            hierarchy: headerResult.rootScope,
            version: headerResult.header.version || undefined,
            date: headerResult.header.date || undefined,
            comment: headerResult.header.comment
        };
    }

    // ========================================================================
    // Parsing Helpers
    // ========================================================================

    private extractValue(line: string, keyword: string): string {
        const regex = new RegExp(`\\${keyword}\\s+(.+?)\\s*\\$end`, 's');
        const match = line.match(regex);
        return match ? match[1].trim() : '';
    }

    private parseTimescale(line: string): Timescale {
        const match = line.match(/\$timescale\s+(\d+)\s*([a-z]+)/i);
        if (match) {
            const unit = match[2].toLowerCase();
            const validUnits = ['s', 'ms', 'us', 'ns', 'ps', 'fs'];
            return {
                value: parseInt(match[1], 10),
                unit: validUnits.includes(unit) ? unit as Timescale['unit'] : 'ns'
            };
        }
        return { value: 1, unit: 'ns' };
    }

    private parseVariable(line: string, scopeStack: string[]): SignalMetadata | null {
        // $var wire 1 ! clk $end
        // $var reg 8 " data [7:0] $end
        const match = line.match(/\$var\s+(\w+)\s+(\d+)\s+(\S+)\s+(.+?)\s*\$end/);
        if (!match) return null;

        const [, typeStr, sizeStr, id, nameWithBits] = match;

        // Parse name and bit range
        const bitMatch = nameWithBits.match(/^(.+?)\s*\[(\d+):(\d+)\]\s*$/);
        let name: string;
        let msb: number | undefined;
        let lsb: number | undefined;

        if (bitMatch) {
            name = bitMatch[1].trim();
            msb = parseInt(bitMatch[2], 10);
            lsb = parseInt(bitMatch[3], 10);
        } else {
            name = nameWithBits.trim();
        }

        const fullPath = [...scopeStack, name].join('.');

        return {
            id,
            name,
            fullPath,
            width: parseInt(sizeStr, 10),
            type: typeStr.toLowerCase() as SignalType,
            msb,
            lsb
        };
    }

    private parseValueChange(line: string, time: bigint): void {
        let id: string;
        let value: number | string;

        if (line.startsWith('b') || line.startsWith('B')) {
            // Binary value: bXXXX id
            const match = line.match(/^[bB]([01xXzZ_]+)\s+(\S+)/);
            if (!match) return;
            value = match[1].replace(/_/g, ''); // Remove underscores
            id = match[2];
        } else if (line.startsWith('r') || line.startsWith('R')) {
            // Real value: rX.XX id
            const match = line.match(/^[rR]([^\s]+)\s+(\S+)/);
            if (!match) return;
            value = match[1]; // Keep as string for precision
            id = match[2];
        } else {
            // Scalar value: 0id, 1id, xid, zid
            const firstChar = line[0];
            if ('01xXzZ'.includes(firstChar)) {
                value = firstChar === '0' ? 0 : firstChar === '1' ? 1 : firstChar.toLowerCase();
                id = line.slice(1).trim();
            } else {
                return;
            }
        }

        const signal = this.signals.get(id);
        if (signal) {
            signal.values.push({ time, value });
        }
    }

    private ensureLoaded(): void {
        if (!this.isLoaded) {
            throw new Error('No VCD file loaded. Call open() first.');
        }
    }
}
