/**
 * Waveform Renderer
 * Renders waveform signals as Unicode strings for terminal display
 */

import type { WaveformSignal, RenderOptions, RenderedSignal, ValueFormat } from './types.js';

// Unicode characters for waveform drawing
const CHARS = {
    LOW: '_',
    HIGH: '\u203E', // overline
    HIGH_ALT: '-', // fallback
    RISE: '/',
    FALL: '\\',
    VERT: '|',
    X: 'X',
    Z: 'Z',
    BOX_LEFT: '[',
    BOX_RIGHT: ']',
};

export class WaveformRenderer {
    private useUnicode: boolean;

    constructor(useUnicode = true) {
        this.useUnicode = useUnicode;
    }

    renderSignal(
        signal: WaveformSignal,
        timeStart: number,
        timeEnd: number,
        options: RenderOptions
    ): RenderedSignal {
        const { width, valueFormat } = options;
        const timeRange = timeEnd - timeStart;
        const timePerChar = timeRange / width;

        let waveform: string;
        let currentValue: string;

        if (signal.width === 1) {
            waveform = this.renderBitSignal(signal, timeStart, timePerChar, width);
        } else {
            waveform = this.renderBusSignal(signal, timeStart, timePerChar, width, valueFormat);
        }

        // Get current value at timeEnd
        currentValue = this.getValueAtTime(signal, timeEnd, valueFormat);

        return {
            label: signal.name,
            value: currentValue,
            waveform,
        };
    }

    private renderBitSignal(
        signal: WaveformSignal,
        timeStart: number,
        timePerChar: number,
        width: number
    ): string {
        // Ensure width is a valid positive integer
        const safeWidth = Math.max(1, Math.min(1000, Math.floor(width) || 60));
        const result: string[] = new Array(safeWidth).fill(' ');

        // Build time-indexed value lookup
        const values = signal.values;
        if (values.length === 0) return result.join('');

        let valueIndex = 0;
        let prevValue: number | string = values[0][1];

        for (let col = 0; col < width; col++) {
            const colTime = timeStart + col * timePerChar;
            const nextColTime = colTime + timePerChar;

            // Find value at this time
            while (valueIndex < values.length - 1 && values[valueIndex + 1][0] <= colTime) {
                valueIndex++;
            }

            const currentVal = values[valueIndex][1];

            // Check for transition in this column
            let hasTransition = false;
            let transitionTo: number | string = currentVal;

            for (let i = valueIndex + 1; i < values.length && values[i][0] < nextColTime; i++) {
                hasTransition = true;
                transitionTo = values[i][1];
            }

            if (hasTransition) {
                result[col] = CHARS.VERT;
            } else if (currentVal === 0) {
                result[col] = CHARS.LOW;
            } else if (currentVal === 1) {
                result[col] = this.useUnicode ? CHARS.HIGH : CHARS.HIGH_ALT;
            } else if (currentVal === 'x' || currentVal === 'X') {
                result[col] = CHARS.X;
            } else if (currentVal === 'z' || currentVal === 'Z') {
                result[col] = CHARS.Z;
            }

            prevValue = transitionTo;
        }

        return result.join('');
    }

    private renderBusSignal(
        signal: WaveformSignal,
        timeStart: number,
        timePerChar: number,
        width: number,
        format: ValueFormat
    ): string {
        // Ensure width is a valid positive integer
        const safeWidth = Math.max(1, Math.min(1000, Math.floor(width) || 60));
        const result: string[] = new Array(safeWidth).fill(' ');
        const values = signal.values;

        if (values.length === 0) return result.join('');

        // Find segments where value is constant
        const segments: Array<{ start: number; end: number; value: number | string }> = [];
        let segStart = 0;

        for (let i = 0; i < values.length; i++) {
            const time = values[i][0];
            const startCol = Math.floor((time - timeStart) / timePerChar);

            if (i > 0 && startCol > segStart) {
                segments.push({
                    start: segStart,
                    end: startCol,
                    value: values[i - 1][1],
                });
            }
            segStart = startCol;
        }

        // Add final segment
        if (values.length > 0) {
            segments.push({
                start: segStart,
                end: width,
                value: values[values.length - 1][1],
            });
        }

        // Render each segment
        for (const seg of segments) {
            if (seg.start < 0 || seg.start >= width) continue;

            const startCol = Math.max(0, seg.start);
            const endCol = Math.min(width, seg.end);
            const segWidth = endCol - startCol;

            if (segWidth <= 0) continue;

            // Draw segment borders
            result[startCol] = CHARS.BOX_LEFT;
            if (endCol - 1 < width && endCol - 1 > startCol) {
                result[endCol - 1] = CHARS.BOX_RIGHT;
            }

            // Draw value label if there's room
            const valueStr = this.formatValue(seg.value, signal.width, format);
            const labelStart = startCol + 1;
            const labelSpace = endCol - startCol - 2;

            if (labelSpace > 0) {
                const label = valueStr.length > labelSpace ? valueStr.slice(0, labelSpace) : valueStr;
                for (let i = 0; i < label.length && labelStart + i < width; i++) {
                    result[labelStart + i] = label[i];
                }
            }
        }

        return result.join('');
    }

    private getValueAtTime(signal: WaveformSignal, time: number, format: ValueFormat): string {
        const values = signal.values;
        if (values.length === 0) return '?';

        // Find the value at or before the given time
        let value = values[0][1];
        for (const [t, v] of values) {
            if (t <= time) {
                value = v;
            } else {
                break;
            }
        }

        return this.formatValue(value, signal.width, format);
    }

    formatValue(value: number | string, width: number, format: ValueFormat): string {
        if (typeof value === 'string') {
            // Binary string from VCD
            if (value.includes('x') || value.includes('X')) return 'x';
            if (value.includes('z') || value.includes('Z')) return 'z';

            const numValue = parseInt(value, 2);
            return this.formatNumber(numValue, width, format);
        }

        if (typeof value === 'number') {
            if (value === 0 || value === 1) {
                return value.toString();
            }
            return this.formatNumber(value, width, format);
        }

        return String(value);
    }

    private formatNumber(value: number, width: number, format: ValueFormat): string {
        const actualFormat = format === 'auto' ? (width > 4 ? 'hex' : 'binary') : format;

        switch (actualFormat) {
            case 'hex':
                const hexDigits = Math.ceil(width / 4);
                return '0x' + value.toString(16).toUpperCase().padStart(hexDigits, '0');
            case 'binary':
                return value.toString(2).padStart(width, '0');
            case 'decimal':
                return value.toString(10);
            default:
                return value.toString(16).toUpperCase();
        }
    }

    // Render time ruler
    renderTimeRuler(timeStart: number, timeEnd: number, width: number, unit: string): string {
        // Ensure width is a valid positive integer
        const safeWidth = Math.max(1, Math.min(1000, Math.floor(width) || 60));
        const result: string[] = new Array(safeWidth).fill(' ');
        const timeRange = timeEnd - timeStart;
        const tickInterval = this.calculateTickInterval(timeRange, width);

        let firstTick = Math.ceil(timeStart / tickInterval) * tickInterval;

        for (let time = firstTick; time <= timeEnd; time += tickInterval) {
            const col = Math.floor(((time - timeStart) / timeRange) * width);
            if (col >= 0 && col < width) {
                const label = `${time}${unit}`;
                for (let i = 0; i < label.length && col + i < width; i++) {
                    result[col + i] = label[i];
                }
            }
        }

        return result.join('');
    }

    private calculateTickInterval(timeRange: number, width: number): number {
        const targetTicks = Math.floor(width / 15); // One tick per ~15 chars
        const rawInterval = timeRange / targetTicks;

        // Round to nice number
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
        const normalized = rawInterval / magnitude;

        let nice: number;
        if (normalized <= 1) nice = 1;
        else if (normalized <= 2) nice = 2;
        else if (normalized <= 5) nice = 5;
        else nice = 10;

        return nice * magnitude;
    }
}
