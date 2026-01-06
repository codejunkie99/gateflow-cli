/**
 * VCD Parser
 * Parses Value Change Dump files into WaveformData
 */

import { readFile } from 'fs/promises';
import type {
    WaveformData,
    WaveformSignal,
    WaveformScope,
    VCDHeader,
    VCDVariable,
    VCDVarType,
    VCDParserOptions,
} from './types.js';

type ParserState = 'header' | 'definitions' | 'values';

export class VCDParser {
    private options: Required<VCDParserOptions>;

    constructor(options: VCDParserOptions = {}) {
        this.options = {
            maxSignals: options.maxSignals ?? 10000,
            maxTimestamps: options.maxTimestamps ?? 100000,
            signalFilter: options.signalFilter ?? /.*/,
        };
    }

    async parseFile(filePath: string): Promise<WaveformData> {
        const content = await readFile(filePath, 'utf-8');
        return this.parseContent(content);
    }

    parseContent(content: string): WaveformData {
        const lines = content.split('\n');

        let state: ParserState = 'header';
        const header: VCDHeader = { version: '', date: '', timescale: { value: 1, unit: 'ns' } };
        const variables = new Map<string, VCDVariable>();
        const signals = new Map<string, WaveformSignal>();
        const scopeStack: string[] = [];
        const rootScope: WaveformScope = { name: 'root', children: [], signals: [] };
        const scopeMap = new Map<string, WaveformScope>();
        scopeMap.set('', rootScope);

        let currentTime = 0;
        let lineBuffer = '';
        let timestampCount = 0;

        for (const rawLine of lines) {
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
                } else if (line.startsWith('$timescale')) {
                    header.timescale = this.parseTimescale(line);
                } else if (line.startsWith('$scope')) {
                    const match = line.match(/\$scope\s+(\w+)\s+(\S+)/);
                    if (match) {
                        const scopeName = match[2];
                        scopeStack.push(scopeName);
                        const fullPath = scopeStack.join('.');
                        const parentPath = scopeStack.slice(0, -1).join('.');
                        const parent = scopeMap.get(parentPath) ?? rootScope;
                        const newScope: WaveformScope = { name: scopeName, children: [], signals: [] };
                        parent.children.push(newScope);
                        scopeMap.set(fullPath, newScope);
                    }
                    state = 'definitions';
                } else if (line.startsWith('$upscope')) {
                    scopeStack.pop();
                } else if (line.startsWith('$var')) {
                    const varDef = this.parseVariable(line, scopeStack);
                    if (varDef && variables.size < this.options.maxSignals) {
                        if (this.options.signalFilter.test(varDef.fullPath)) {
                            variables.set(varDef.id, varDef);
                            const scopePath = scopeStack.join('.');
                            const scope = scopeMap.get(scopePath) ?? rootScope;
                            scope.signals.push(varDef.id);

                            signals.set(varDef.id, {
                                id: varDef.id,
                                name: varDef.name,
                                width: varDef.size,
                                values: [],
                            });
                        }
                    }
                } else if (line.startsWith('$enddefinitions')) {
                    state = 'values';
                }
            } else if (state === 'values') {
                if (line.startsWith('#')) {
                    // Timestamp
                    currentTime = parseInt(line.slice(1), 10);
                    timestampCount++;
                    if (timestampCount > this.options.maxTimestamps) {
                        break;
                    }
                } else if (line.startsWith('$')) {
                    // Skip other commands in value section
                    continue;
                } else {
                    // Value change
                    this.parseValueChange(line, currentTime, signals);
                }
            }
        }

        return {
            timescale: `${header.timescale.value}${header.timescale.unit}`,
            signals: Array.from(signals.values()),
            rootScope,
        };
    }

    private extractValue(line: string, keyword: string): string {
        const match = line.match(new RegExp(`\\${keyword}\\s+(.+?)\\s*\\$end`));
        return match ? match[1].trim() : '';
    }

    private parseTimescale(line: string): { value: number; unit: string } {
        const match = line.match(/\$timescale\s+(\d+)\s*([a-z]+)/i);
        if (match) {
            return { value: parseInt(match[1], 10), unit: match[2] };
        }
        return { value: 1, unit: 'ns' };
    }

    private parseVariable(line: string, scopeStack: string[]): VCDVariable | null {
        // $var wire 1 ! clk $end
        // $var reg 8 " data [7:0] $end
        const match = line.match(/\$var\s+(\w+)\s+(\d+)\s+(\S+)\s+(.+?)\s*\$end/);
        if (!match) return null;

        const [, typeStr, sizeStr, id, nameWithBits] = match;
        const name = nameWithBits.replace(/\s*\[.*\]\s*$/, '').trim();
        const fullPath = [...scopeStack, name].join('.');

        return {
            type: typeStr as VCDVarType,
            size: parseInt(sizeStr, 10),
            id,
            name,
            fullPath,
        };
    }

    private parseValueChange(line: string, time: number, signals: Map<string, WaveformSignal>): void {
        let id: string;
        let value: number | string;

        if (line.startsWith('b') || line.startsWith('B')) {
            // Binary value: bXXXX id
            const match = line.match(/^[bB]([01xXzZ]+)\s+(\S+)/);
            if (!match) return;
            value = match[1];
            id = match[2];
        } else if (line.startsWith('r') || line.startsWith('R')) {
            // Real value: rX.XX id
            const match = line.match(/^[rR]([^\s]+)\s+(\S+)/);
            if (!match) return;
            value = parseFloat(match[1]);
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

        const signal = signals.get(id);
        if (signal) {
            signal.values.push([time, value]);
        }
    }
}
