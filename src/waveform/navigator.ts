/**
 * Navigator
 * Manages view state for waveform navigation (zoom, pan, cursor)
 */

import type { ViewState, WaveformData, WaveformSignal } from './types.js';

export interface NavigatorOptions {
    initialZoom?: number;
    minZoom?: number;
    maxZoom?: number;
}

export class Navigator {
    private state: ViewState;
    private data: WaveformData | null = null;
    private minZoom: number;
    private maxZoom: number;
    private signalList: WaveformSignal[] = [];

    constructor(options: NavigatorOptions = {}) {
        this.minZoom = options.minZoom ?? 0.01;
        this.maxZoom = options.maxZoom ?? 100;

        this.state = {
            timeStart: 0,
            timeEnd: 1000,
            zoom: options.initialZoom ?? 1,
            selectedIndex: 0,
            cursorTime: null,
        };
    }

    setData(data: WaveformData): void {
        this.data = data;
        this.signalList = data.signals;

        // Calculate initial view range
        const timeRange = this.getTimeRange();
        this.state.timeStart = timeRange.start;
        this.state.timeEnd = timeRange.end;
        this.state.zoom = 1;
        this.state.selectedIndex = 0;
    }

    setSignalList(signals: WaveformSignal[]): void {
        this.signalList = signals;
        if (this.state.selectedIndex >= signals.length) {
            this.state.selectedIndex = Math.max(0, signals.length - 1);
        }
    }

    getState(): ViewState {
        return { ...this.state };
    }

    getSelectedSignal(): WaveformSignal | null {
        return this.signalList[this.state.selectedIndex] ?? null;
    }

    getVisibleSignals(maxVisible: number): WaveformSignal[] {
        const start = Math.max(0, this.state.selectedIndex - Math.floor(maxVisible / 2));
        const end = Math.min(this.signalList.length, start + maxVisible);
        return this.signalList.slice(start, end);
    }

    getTimeRange(): { start: number; end: number; duration: number } {
        if (!this.data || this.data.signals.length === 0) {
            return { start: 0, end: 1000, duration: 1000 };
        }

        let minTime = Infinity;
        let maxTime = -Infinity;

        for (const signal of this.data.signals) {
            for (const [time] of signal.values) {
                if (time < minTime) minTime = time;
                if (time > maxTime) maxTime = time;
            }
        }

        if (minTime === Infinity) {
            return { start: 0, end: 1000, duration: 1000 };
        }

        return {
            start: minTime,
            end: maxTime,
            duration: maxTime - minTime,
        };
    }

    // Navigation methods
    selectNext(): void {
        if (this.state.selectedIndex < this.signalList.length - 1) {
            this.state.selectedIndex++;
        }
    }

    selectPrevious(): void {
        if (this.state.selectedIndex > 0) {
            this.state.selectedIndex--;
        }
    }

    selectIndex(index: number): void {
        if (index >= 0 && index < this.signalList.length) {
            this.state.selectedIndex = index;
        }
    }

    panLeft(amount?: number): void {
        const viewDuration = this.state.timeEnd - this.state.timeStart;
        const panAmount = amount ?? viewDuration * 0.1;

        const timeRange = this.getTimeRange();
        const newStart = Math.max(timeRange.start, this.state.timeStart - panAmount);
        const shift = this.state.timeStart - newStart;

        this.state.timeStart = newStart;
        this.state.timeEnd -= shift;
    }

    panRight(amount?: number): void {
        const viewDuration = this.state.timeEnd - this.state.timeStart;
        const panAmount = amount ?? viewDuration * 0.1;

        const timeRange = this.getTimeRange();
        const newEnd = Math.min(timeRange.end, this.state.timeEnd + panAmount);
        const shift = newEnd - this.state.timeEnd;

        this.state.timeEnd = newEnd;
        this.state.timeStart += shift;
    }

    zoomIn(): void {
        if (this.state.zoom >= this.maxZoom) return;

        const centerTime = (this.state.timeStart + this.state.timeEnd) / 2;
        const newZoom = Math.min(this.maxZoom, this.state.zoom * 2);
        this.applyZoom(newZoom, centerTime);
    }

    zoomOut(): void {
        if (this.state.zoom <= this.minZoom) return;

        const centerTime = (this.state.timeStart + this.state.timeEnd) / 2;
        const newZoom = Math.max(this.minZoom, this.state.zoom / 2);
        this.applyZoom(newZoom, centerTime);
    }

    private applyZoom(newZoom: number, centerTime: number): void {
        const timeRange = this.getTimeRange();
        const totalDuration = timeRange.duration || 1000;
        const newViewDuration = totalDuration / newZoom;

        let newStart = centerTime - newViewDuration / 2;
        let newEnd = centerTime + newViewDuration / 2;

        // Clamp to data range
        if (newStart < timeRange.start) {
            newStart = timeRange.start;
            newEnd = newStart + newViewDuration;
        }
        if (newEnd > timeRange.end) {
            newEnd = timeRange.end;
            newStart = Math.max(timeRange.start, newEnd - newViewDuration);
        }

        this.state.zoom = newZoom;
        this.state.timeStart = newStart;
        this.state.timeEnd = newEnd;
    }

    fitAll(): void {
        const timeRange = this.getTimeRange();
        this.state.timeStart = timeRange.start;
        this.state.timeEnd = timeRange.end;
        this.state.zoom = 1;
    }

    goToStart(): void {
        const timeRange = this.getTimeRange();
        const viewDuration = this.state.timeEnd - this.state.timeStart;

        this.state.timeStart = timeRange.start;
        this.state.timeEnd = timeRange.start + viewDuration;
    }

    goToEnd(): void {
        const timeRange = this.getTimeRange();
        const viewDuration = this.state.timeEnd - this.state.timeStart;

        this.state.timeEnd = timeRange.end;
        this.state.timeStart = Math.max(timeRange.start, timeRange.end - viewDuration);
    }

    // Cursor methods
    setCursor(time: number): void {
        this.state.cursorTime = time;
    }

    clearCursor(): void {
        this.state.cursorTime = null;
    }

    toggleCursorAtCenter(): void {
        if (this.state.cursorTime !== null) {
            this.state.cursorTime = null;
        } else {
            this.state.cursorTime = (this.state.timeStart + this.state.timeEnd) / 2;
        }
    }

    centerOnCursor(): void {
        if (this.state.cursorTime === null) return;

        const viewDuration = this.state.timeEnd - this.state.timeStart;
        const timeRange = this.getTimeRange();

        let newStart = this.state.cursorTime - viewDuration / 2;
        let newEnd = this.state.cursorTime + viewDuration / 2;

        // Clamp
        if (newStart < timeRange.start) {
            newStart = timeRange.start;
            newEnd = newStart + viewDuration;
        }
        if (newEnd > timeRange.end) {
            newEnd = timeRange.end;
            newStart = Math.max(timeRange.start, newEnd - viewDuration);
        }

        this.state.timeStart = newStart;
        this.state.timeEnd = newEnd;
    }

    moveCursorLeft(): void {
        if (this.state.cursorTime === null) return;

        const viewDuration = this.state.timeEnd - this.state.timeStart;
        const step = viewDuration * 0.05;

        this.state.cursorTime = Math.max(this.state.timeStart, this.state.cursorTime - step);
    }

    moveCursorRight(): void {
        if (this.state.cursorTime === null) return;

        const viewDuration = this.state.timeEnd - this.state.timeStart;
        const step = viewDuration * 0.05;

        this.state.cursorTime = Math.min(this.state.timeEnd, this.state.cursorTime + step);
    }

    // Utility
    timeToColumn(time: number, width: number): number {
        const viewDuration = this.state.timeEnd - this.state.timeStart;
        return Math.floor(((time - this.state.timeStart) / viewDuration) * width);
    }

    columnToTime(column: number, width: number): number {
        const viewDuration = this.state.timeEnd - this.state.timeStart;
        return this.state.timeStart + (column / width) * viewDuration;
    }
}
