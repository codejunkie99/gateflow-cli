/**
 * MCP Waveform Server
 * Exposes waveform data via Model Context Protocol
 * Supports VCD and FST formats via WaveformStore
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import { WaveformStore, type SignalMetadata, type EdgeType } from './store/index.js';

export class WaveformMCPServer {
    private server: Server;
    private store: WaveformStore;

    constructor() {
        this.store = new WaveformStore({
            cacheSize: 100 * 1024 * 1024, // 100MB cache
        });

        this.server = new Server(
            {
                name: 'gateflow-waveform',
                version: '2.0.0',
            },
            {
                capabilities: {
                    resources: {},
                    tools: {},
                },
            }
        );

        this.setupResourceHandlers();
        this.setupToolHandlers();

        this.server.onerror = (error) => {
            console.error('[MCP Error]', error);
        };
    }

    private setupResourceHandlers(): void {
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            const resources = [];

            if (this.store.isOpen()) {
                const metadata = this.store.getMetadata();
                resources.push(
                    {
                        uri: 'waveform://metadata',
                        name: 'Waveform Metadata',
                        description: `${metadata.format.toUpperCase()} file metadata`,
                        mimeType: 'application/json',
                    },
                    {
                        uri: 'waveform://signals',
                        name: 'Signal List',
                        description: `${metadata.signalCount} signals available`,
                        mimeType: 'application/json',
                    }
                );

                // Add signal resources (limit to first 50)
                const signals = this.store.getSignals().slice(0, 50);
                for (const signal of signals) {
                    resources.push({
                        uri: `waveform://signal/${encodeURIComponent(signal.fullPath)}`,
                        name: signal.name,
                        description: `${signal.fullPath} (${signal.width}-bit ${signal.type})`,
                        mimeType: 'application/json',
                    });
                }
            }

            return { resources };
        });

        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const uri = request.params.uri;

            if (!this.store.isOpen()) {
                throw new Error('No waveform loaded. Use load_waveform tool first.');
            }

            const metadata = this.store.getMetadata();

            if (uri === 'waveform://metadata') {
                return {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            format: metadata.format,
                            filePath: metadata.filePath,
                            fileSize: metadata.fileSize,
                            timescale: metadata.timescale,
                            signalCount: metadata.signalCount,
                            timeRange: {
                                start: metadata.timeRange.start.toString(),
                                end: metadata.timeRange.end.toString(),
                            },
                            version: metadata.version,
                            date: metadata.date,
                        }, null, 2),
                    }],
                };
            }

            if (uri === 'waveform://signals') {
                const signals = this.store.getSignals();
                return {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(
                            signals.map(s => ({
                                id: s.id,
                                name: s.name,
                                fullPath: s.fullPath,
                                width: s.width,
                                type: s.type,
                            })),
                            null, 2
                        ),
                    }],
                };
            }

            if (uri.startsWith('waveform://signal/')) {
                const signalPath = decodeURIComponent(uri.replace('waveform://signal/', ''));
                const signal = this.store.findSignal(signalPath);

                if (!signal) {
                    throw new Error(`Signal not found: ${signalPath}`);
                }

                const data = await this.store.getSignalData(signal.id, { limit: 100 });

                return {
                    contents: [{
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify({
                            ...signal,
                            values: data.values.map(v => ({
                                time: v.time.toString(),
                                value: v.value,
                            })),
                            totalValues: data.values.length,
                            isPartial: data.isPartial,
                        }, null, 2),
                    }],
                };
            }

            throw new Error(`Unknown resource: ${uri}`);
        });
    }

    private setupToolHandlers(): void {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'load_waveform',
                    description: 'Load a waveform file (VCD or FST format)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to the waveform file (.vcd or .fst)',
                            },
                        },
                        required: ['path'],
                    },
                },
                {
                    name: 'list_signals',
                    description: 'List all signals in the loaded waveform',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            pattern: {
                                type: 'string',
                                description: 'Optional filter pattern (e.g., "tb.dut.*")',
                            },
                        },
                    },
                },
                {
                    name: 'get_signal_value',
                    description: 'Get signal value at a specific time',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            signal: {
                                type: 'string',
                                description: 'Signal name or path',
                            },
                            time: {
                                type: 'number',
                                description: 'Time in simulation units',
                            },
                        },
                        required: ['signal', 'time'],
                    },
                },
                {
                    name: 'get_signal_range',
                    description: 'Get signal values over a time range',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            signal: { type: 'string', description: 'Signal name or path' },
                            start: { type: 'number', description: 'Start time' },
                            end: { type: 'number', description: 'End time' },
                            limit: { type: 'number', description: 'Max values to return (default 100)' },
                        },
                        required: ['signal', 'start', 'end'],
                    },
                },
                {
                    name: 'find_transitions',
                    description: 'Find signal transitions (rising/falling edges)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            signal: { type: 'string', description: 'Signal name or path' },
                            edge: { type: 'string', enum: ['rising', 'falling', 'any'], description: 'Edge type' },
                            start: { type: 'number', description: 'Start time (optional)' },
                            end: { type: 'number', description: 'End time (optional)' },
                        },
                        required: ['signal'],
                    },
                },
                {
                    name: 'analyze_clocks',
                    description: 'Automatically detect and analyze clock signals',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'get_waveform_ascii',
                    description: 'Get ASCII art waveform representation',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            signals: { type: 'array', items: { type: 'string' }, description: 'Signal names' },
                            start: { type: 'number', description: 'Start time' },
                            end: { type: 'number', description: 'End time' },
                            width: { type: 'number', description: 'Width in characters (default 60)' },
                        },
                    },
                },
                {
                    name: 'get_cache_stats',
                    description: 'Get cache statistics',
                    inputSchema: { type: 'object', properties: {} },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                switch (name) {
                    case 'load_waveform':
                        return await this.handleLoadWaveform(args as { path: string });
                    case 'list_signals':
                        return this.handleListSignals(args as { pattern?: string });
                    case 'get_signal_value':
                        return await this.handleGetSignalValue(args as { signal: string; time: number });
                    case 'get_signal_range':
                        return await this.handleGetSignalRange(args as { signal: string; start: number; end: number; limit?: number });
                    case 'find_transitions':
                        return await this.handleFindTransitions(args as { signal: string; edge?: string; start?: number; end?: number });
                    case 'analyze_clocks':
                        return await this.handleAnalyzeClocks();
                    case 'get_waveform_ascii':
                        return await this.handleGetWaveformASCII(args as { signals?: string[]; start?: number; end?: number; width?: number });
                    case 'get_cache_stats':
                        return this.handleGetCacheStats();
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error) {
                return {
                    content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
                    isError: true,
                };
            }
        });
    }

    // Tool Handlers

    private async handleLoadWaveform(args: { path: string }) {
        const resolvedPath = path.resolve(args.path);

        const metadata = await this.store.open(resolvedPath);

        return {
            content: [{
                type: 'text',
                text: `Loaded ${metadata.format.toUpperCase()} file: ${resolvedPath}\n` +
                    `Timescale: ${metadata.timescale.value}${metadata.timescale.unit}\n` +
                    `Signals: ${metadata.signalCount}\n` +
                    `Time range: ${metadata.timeRange.start} - ${metadata.timeRange.end}\n` +
                    `File size: ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB`,
            }],
        };
    }

    private handleListSignals(args: { pattern?: string }) {
        this.ensureLoaded();

        const signals = args.pattern
            ? this.store.findSignals(args.pattern)
            : this.store.getSignals();

        const signalList = signals.slice(0, 100).map(s =>
            `${s.fullPath} [${s.width}-bit ${s.type}]`
        ).join('\n');

        const suffix = signals.length > 100 ? `\n... and ${signals.length - 100} more` : '';

        return {
            content: [{ type: 'text', text: `Signals (${signals.length}):\n${signalList}${suffix}` }],
        };
    }

    private async handleGetSignalValue(args: { signal: string; time: number }) {
        this.ensureLoaded();

        const signal = this.findSignalOrThrow(args.signal);
        const value = await this.store.getSignalValue(signal.id, BigInt(args.time));

        if (!value) {
            return {
                content: [{ type: 'text', text: `${signal.fullPath} has no value at time ${args.time}` }],
            };
        }

        const formatted = this.formatValue(value.value, signal.width);

        return {
            content: [{
                type: 'text',
                text: `${signal.fullPath} at ${args.time}: ${formatted}`,
            }],
        };
    }

    private async handleGetSignalRange(args: { signal: string; start: number; end: number; limit?: number }) {
        this.ensureLoaded();

        const signal = this.findSignalOrThrow(args.signal);
        const data = await this.store.getSignalData(signal.id, {
            timeStart: BigInt(args.start),
            timeEnd: BigInt(args.end),
            limit: args.limit ?? 100,
        });

        const formatted = data.values.map(v =>
            `  ${v.time}: ${this.formatValue(v.value, signal.width)}`
        ).join('\n');

        return {
            content: [{
                type: 'text',
                text: `${signal.fullPath} from ${args.start} to ${args.end}:\n${formatted || '  (no transitions in range)'}` +
                    (data.isPartial ? '\n  (output limited)' : ''),
            }],
        };
    }

    private async handleFindTransitions(args: { signal: string; edge?: string; start?: number; end?: number }) {
        this.ensureLoaded();

        const signal = this.findSignalOrThrow(args.signal);
        const edge = (args.edge || 'any') as EdgeType;
        const range = args.start !== undefined && args.end !== undefined
            ? { start: BigInt(args.start), end: BigInt(args.end) }
            : undefined;

        const transitions = await this.store.findTransitions(signal.id, edge, range);

        const formatted = transitions.slice(0, 50).map(t => `  ${t}`).join('\n');

        return {
            content: [{
                type: 'text',
                text: `${edge} transitions for ${signal.fullPath} (${transitions.length} found):\n${formatted}` +
                    (transitions.length > 50 ? `\n  ... and ${transitions.length - 50} more` : ''),
            }],
        };
    }

    private async handleAnalyzeClocks() {
        this.ensureLoaded();

        const clocks = await this.store.analyzeClocks();

        if (clocks.length === 0) {
            return {
                content: [{ type: 'text', text: 'No clock signals detected.' }],
            };
        }

        const metadata = this.store.getMetadata();
        const formatted = clocks.map(c => {
            const freqStr = c.frequencyHz >= 1e9
                ? `${(c.frequencyHz / 1e9).toFixed(2)} GHz`
                : c.frequencyHz >= 1e6
                    ? `${(c.frequencyHz / 1e6).toFixed(2)} MHz`
                    : c.frequencyHz >= 1e3
                        ? `${(c.frequencyHz / 1e3).toFixed(2)} kHz`
                        : `${c.frequencyHz.toFixed(2)} Hz`;

            return `${c.signal.fullPath}:\n` +
                `    Frequency: ${freqStr}\n` +
                `    Period: ${c.period} ${metadata.timescale.unit}\n` +
                `    Duty cycle: ${(c.dutyCycle * 100).toFixed(1)}%\n` +
                `    Confidence: ${(c.confidence * 100).toFixed(0)}%`;
        }).join('\n\n');

        return {
            content: [{ type: 'text', text: `Clock Analysis:\n\n${formatted}` }],
        };
    }

    private async handleGetWaveformASCII(args: { signals?: string[]; start?: number; end?: number; width?: number }) {
        this.ensureLoaded();

        const metadata = this.store.getMetadata();
        const width = args.width || 60;
        const start = args.start !== undefined ? BigInt(args.start) : metadata.timeRange.start;
        const end = args.end !== undefined ? BigInt(args.end) : metadata.timeRange.end;

        const allSignals = this.store.getSignals();
        const signalsToRender = args.signals && args.signals.length > 0
            ? args.signals.map(s => this.findSignalOrThrow(s))
            : allSignals.slice(0, 10);

        const lines: string[] = [];
        lines.push('═'.repeat(width + 16));
        lines.push(` Time: ${start} - ${end} ${metadata.timescale.unit}`);
        lines.push('═'.repeat(width + 16));

        for (const signal of signalsToRender) {
            const data = await this.store.getSignalData(signal.id, {
                timeStart: start,
                timeEnd: end,
            });

            const name = signal.name.slice(0, 12).padEnd(12);
            const waveform = this.renderSignalASCII(signal, data.values, start, end, width);
            lines.push(`${name} │ ${waveform}`);
        }

        lines.push('═'.repeat(width + 16));

        return {
            content: [{ type: 'text', text: lines.join('\n') }],
        };
    }

    private handleGetCacheStats() {
        const stats = this.store.getCacheStats();

        return {
            content: [{
                type: 'text',
                text: `Cache Statistics:\n` +
                    `  Entries: ${stats.entries}\n` +
                    `  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n` +
                    `  Hits: ${stats.hits}\n` +
                    `  Misses: ${stats.misses}\n` +
                    `  Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`,
            }],
        };
    }

    // Helpers

    private ensureLoaded(): void {
        if (!this.store.isOpen()) {
            throw new Error('No waveform loaded. Use load_waveform tool first.');
        }
    }

    private findSignalOrThrow(nameOrPath: string): SignalMetadata {
        const signal = this.store.findSignal(nameOrPath);
        if (!signal) {
            // Try pattern match
            const matches = this.store.findSignals(nameOrPath);
            if (matches.length > 0) {
                return matches[0];
            }
            throw new Error(`Signal not found: ${nameOrPath}`);
        }
        return signal;
    }

    private formatValue(value: number | string, width: number): string {
        if (typeof value === 'string') {
            if (value.toLowerCase().includes('x')) return 'X';
            if (value.toLowerCase().includes('z')) return 'Z';
            const num = parseInt(value, 2);
            if (isNaN(num)) return value;
            if (width > 4) {
                return '0x' + num.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
            }
            return num.toString();
        }
        if (width === 1) return value.toString();
        if (width > 4) {
            return '0x' + value.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
        }
        return value.toString();
    }

    private renderSignalASCII(
        signal: SignalMetadata,
        values: Array<{ time: bigint; value: number | string }>,
        start: bigint,
        end: bigint,
        width: number
    ): string {
        const result: string[] = new Array(width).fill(' ');
        const timeRange = Number(end - start);
        const timePerChar = timeRange / width;

        const getValueAt = (time: bigint): number | string => {
            let value: number | string = 0;
            for (const v of values) {
                if (v.time <= time) {
                    value = v.value;
                } else {
                    break;
                }
            }
            return value;
        };

        if (signal.width === 1) {
            for (let col = 0; col < width; col++) {
                const colTime = start + BigInt(Math.floor(col * timePerChar));
                const value = getValueAt(colTime);

                if (value === 0 || value === '0') {
                    result[col] = '_';
                } else if (value === 1 || value === '1') {
                    result[col] = '‾';
                } else if (String(value).toLowerCase() === 'x') {
                    result[col] = 'X';
                } else if (String(value).toLowerCase() === 'z') {
                    result[col] = 'Z';
                }
            }
        } else {
            let lastValue: string | null = null;
            let boxStart = 0;

            for (let col = 0; col < width; col++) {
                const colTime = start + BigInt(Math.floor(col * timePerChar));
                const value = this.formatValue(getValueAt(colTime), signal.width);

                if (value !== lastValue) {
                    if (lastValue !== null && col - boxStart > 2) {
                        result[boxStart] = '[';
                        const label = lastValue.slice(0, col - boxStart - 2);
                        for (let i = 0; i < label.length; i++) {
                            result[boxStart + 1 + i] = label[i];
                        }
                        result[col - 1] = ']';
                    }
                    boxStart = col;
                    lastValue = value;
                }
            }

            if (lastValue !== null && width - boxStart > 2) {
                result[boxStart] = '[';
                const label = lastValue.slice(0, width - boxStart - 2);
                for (let i = 0; i < label.length; i++) {
                    result[boxStart + 1 + i] = label[i];
                }
                result[width - 1] = ']';
            }
        }

        return result.join('');
    }

    async run(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('[GateFlow MCP] Waveform server v2.0 started');
    }
}

export async function startMCPServer(): Promise<void> {
    const server = new WaveformMCPServer();
    await server.run();
}
