/**
 * Waveform Viewer
 * Interactive terminal-based VCD waveform viewer using blessed
 */

import blessed from 'blessed';
import type { Widgets } from 'blessed';
import { WaveformStore, type SignalMetadata, type SignalData } from './store/index.js';
import { WaveformRenderer } from './renderer.js';
import { Navigator } from './navigator.js';
import { HierarchyBrowser } from './hierarchy.js';
import type { WaveformSignal, HierarchyNode, ValueFormat, WaveformData } from './types.js';
import { getGlobalEventBus, type EventBus } from '../events/index.js';

// ============================================================================
// Layout Constants
// ============================================================================

const LAYOUT = {
    // Panel widths
    HIERARCHY_WIDTH_PERCENT: 25,
    WAVE_WIDTH_PERCENT: 75,

    // Fixed heights
    HEADER_HEIGHT: 1,
    STATUS_HEIGHT: 2,
    TIME_RULER_HEIGHT: 1,
    BORDER_HEIGHT: 2,

    // Signal label area
    SIGNAL_LABEL_WIDTH: 15,

    // Borders and padding
    BORDER_WIDTH: 2,
    PANEL_PADDING: 2,

    // Minimum dimensions
    MIN_CANVAS_WIDTH: 20,
    MIN_CANVAS_HEIGHT: 3,
    MAX_CANVAS_WIDTH: 500,
    MAX_CANVAS_HEIGHT: 100,

    // Resize debounce
    RESIZE_DEBOUNCE_MS: 100,
} as const;

// ============================================================================
// Color Scheme
// ============================================================================

const COLORS = {
    primary: 'cyan',
    secondary: 'blue',
    accent: 'green',
    warning: 'yellow',
    error: 'red',
    text: 'white',
    dim: 'gray',
    bg: 'black',
    selected: 'cyan',
    cursor: 'yellow',
    wave: 'cyan',
    busWave: 'green',
    xWave: 'red',
    zWave: 'yellow',
} as const;

// ============================================================================
// Types
// ============================================================================

export interface ViewerOptions {
    valueFormat?: ValueFormat;
    bus?: EventBus;
    /** Use ASCII-only characters for terminals without Unicode */
    asciiMode?: boolean;
}

interface CanvasDimensions {
    width: number;
    height: number;
    screenWidth: number;
    screenHeight: number;
}

// ============================================================================
// Unicode Detection
// ============================================================================

function detectUnicodeSupport(): boolean {
    const term = process.env.TERM || '';
    const lang = process.env.LANG || '';
    const lcAll = process.env.LC_ALL || '';

    // Check for UTF-8 in locale
    const hasUtf8Locale = lang.toLowerCase().includes('utf') ||
        lcAll.toLowerCase().includes('utf');

    // Check for modern terminal types
    const hasModernTerm = term.includes('xterm') ||
        term.includes('256color') ||
        term.includes('kitty') ||
        term.includes('alacritty') ||
        term.includes('iterm') ||
        process.platform === 'darwin'; // macOS Terminal

    // Windows Terminal and modern Windows consoles
    const isWindowsTerminal = !!process.env.WT_SESSION;
    const isModernWindows = process.platform === 'win32' && isWindowsTerminal;

    return hasUtf8Locale || hasModernTerm || isModernWindows;
}

// ============================================================================
// Waveform Viewer
// ============================================================================

export class WaveformViewer {
    private screen: Widgets.Screen;
    private headerBox: Widgets.BoxElement;
    private hierarchyList: Widgets.ListElement;
    private wavePanel: Widgets.BoxElement;
    private timeRuler: Widgets.BoxElement;
    private signalLabels: Widgets.BoxElement;
    private waveCanvas: Widgets.BoxElement;
    private statusBar: Widgets.BoxElement;
    private cursorLine: Widgets.BoxElement;

    // Data layer
    private store: WaveformStore;
    private legacyData: WaveformData | null = null; // For compatibility with Navigator/Hierarchy

    // Components
    private navigator: Navigator;
    private hierarchy: HierarchyBrowser;
    private waveRenderer: WaveformRenderer;
    private valueFormat: ValueFormat;

    // State
    private hierarchyFocused = true;
    private hierarchyIndex = 0;
    private filePath = '';
    private bus: EventBus;
    private useUnicode: boolean;

    // Lifecycle
    private closeResolve: (() => void) | null = null;
    private isClosing = false;
    private resizeTimeout: NodeJS.Timeout | null = null;

    // Cache for signal data
    private signalDataCache: Map<string, SignalData> = new Map();

    constructor(options: ViewerOptions = {}) {
        // Check if running in interactive terminal
        if (!process.stdin.isTTY) {
            throw new Error('Waveform viewer requires an interactive terminal (TTY)');
        }

        // Detect Unicode support
        this.useUnicode = options.asciiMode === true ? false : detectUnicodeSupport();

        // Initialize store
        this.store = new WaveformStore({
            cacheSize: 50 * 1024 * 1024, // 50MB for viewer
        });

        // Initialize components
        this.navigator = new Navigator();
        this.hierarchy = new HierarchyBrowser();
        this.waveRenderer = new WaveformRenderer(this.useUnicode);
        this.valueFormat = options.valueFormat ?? 'hex';
        this.bus = options.bus ?? getGlobalEventBus();

        // Create screen
        this.screen = blessed.screen({
            input: process.stdin,
            output: process.stdout,
            smartCSR: true,
            fullUnicode: this.useUnicode,
            title: 'GateFlow Waveform Viewer',
            terminal: process.env.TERM || 'xterm-256color',
            autoPadding: true,
        });

        // Handle screen destroy
        this.screen.on('destroy', () => {
            this.cleanup();
        });

        // Handle resize with debouncing
        this.screen.on('resize', () => {
            this.handleResize();
        });

        // Create UI elements
        this.headerBox = this.createHeader();
        this.hierarchyList = this.createHierarchyPanel();
        this.wavePanel = this.createWavePanel();
        this.timeRuler = this.createTimeRuler();
        this.signalLabels = this.createSignalLabels();
        this.waveCanvas = this.createWaveCanvas();
        this.cursorLine = this.createCursorLine();
        this.statusBar = this.createStatusBar();

        this.setupKeyBindings();
    }

    // ========================================================================
    // UI Creation
    // ========================================================================

    private createHeader(): Widgets.BoxElement {
        return blessed.box({
            parent: this.screen,
            top: 0,
            left: 0,
            width: '100%',
            height: LAYOUT.HEADER_HEIGHT,
            style: {
                fg: COLORS.text,
                bg: COLORS.secondary,
                bold: true,
            },
            content: ' GateFlow Waveform Viewer',
        });
    }

    private createHierarchyPanel(): Widgets.ListElement {
        return blessed.list({
            parent: this.screen,
            top: LAYOUT.HEADER_HEIGHT,
            left: 0,
            width: `${LAYOUT.HIERARCHY_WIDTH_PERCENT}%`,
            height: `100%-${LAYOUT.HEADER_HEIGHT + LAYOUT.STATUS_HEIGHT}`,
            border: { type: 'line' },
            tags: true,
            style: {
                fg: COLORS.text,
                border: { fg: COLORS.primary },
                selected: { fg: COLORS.bg, bg: COLORS.selected },
                item: { fg: COLORS.text },
            },
            label: ' Signals ',
            keys: true,
            vi: true,
            mouse: true,
            scrollable: true,
            scrollbar: {
                ch: this.useUnicode ? '│' : '|',
                style: { fg: COLORS.primary },
            },
        });
    }

    private createWavePanel(): Widgets.BoxElement {
        return blessed.box({
            parent: this.screen,
            top: LAYOUT.HEADER_HEIGHT,
            left: `${LAYOUT.HIERARCHY_WIDTH_PERCENT}%`,
            width: `${LAYOUT.WAVE_WIDTH_PERCENT}%`,
            height: `100%-${LAYOUT.HEADER_HEIGHT + LAYOUT.STATUS_HEIGHT}`,
            border: { type: 'line' },
            style: {
                fg: COLORS.text,
                border: { fg: COLORS.primary },
            },
            label: ' Waveforms ',
        });
    }

    private createTimeRuler(): Widgets.BoxElement {
        return blessed.box({
            parent: this.wavePanel,
            top: 0,
            left: 0,
            width: '100%-2',
            height: LAYOUT.TIME_RULER_HEIGHT,
            tags: true,
            style: { fg: COLORS.dim },
        });
    }

    private createSignalLabels(): Widgets.BoxElement {
        return blessed.box({
            parent: this.wavePanel,
            top: LAYOUT.TIME_RULER_HEIGHT,
            left: 0,
            width: LAYOUT.SIGNAL_LABEL_WIDTH,
            height: '100%-3',
            tags: true,
            style: { fg: COLORS.text },
        });
    }

    private createWaveCanvas(): Widgets.BoxElement {
        return blessed.box({
            parent: this.wavePanel,
            top: LAYOUT.TIME_RULER_HEIGHT,
            left: LAYOUT.SIGNAL_LABEL_WIDTH,
            width: `100%-${LAYOUT.SIGNAL_LABEL_WIDTH + LAYOUT.BORDER_WIDTH}`,
            height: '100%-3',
            tags: true,
            style: { fg: COLORS.wave },
        });
    }

    private createCursorLine(): Widgets.BoxElement {
        return blessed.box({
            parent: this.wavePanel,
            top: LAYOUT.TIME_RULER_HEIGHT,
            left: LAYOUT.SIGNAL_LABEL_WIDTH,
            width: 1,
            height: '100%-3',
            style: {
                fg: COLORS.cursor,
                bg: COLORS.cursor,
            },
            hidden: true,
        });
    }

    private createStatusBar(): Widgets.BoxElement {
        return blessed.box({
            parent: this.screen,
            bottom: 0,
            left: 0,
            width: '100%',
            height: LAYOUT.STATUS_HEIGHT,
            tags: true,
            style: { fg: COLORS.dim },
            content: this.getHelpText(),
        });
    }

    private getHelpText(): string {
        const ud = this.useUnicode ? '↑↓' : 'jk';
        const lr = this.useUnicode ? '←→' : 'arrows';
        return (
            ` {cyan-fg}${ud}{/} Select  {cyan-fg}${lr}{/} Pan  ` +
            '{cyan-fg}+/-{/} Zoom  {cyan-fg}Space{/} Cursor  ' +
            '{cyan-fg}Tab{/} Switch  {cyan-fg}Enter{/} Expand  ' +
            '{cyan-fg}f{/} Fit  {cyan-fg}q{/} Quit\n' +
            ' {cyan-fg}1/x{/} Hex  {cyan-fg}2/b{/} Bin  {cyan-fg}3/d{/} Dec  ' +
            '{cyan-fg}0{/} Start  {cyan-fg}${/} End  {cyan-fg}c{/} Center'
        );
    }

    // ========================================================================
    // Key Bindings
    // ========================================================================

    private setupKeyBindings(): void {
        this.screen.key(['q', 'escape', 'C-c'], () => this.close());

        // Navigation - arrow keys always work, vim keys (j/k) for up/down only
        this.screen.key(['up', 'k'], () => this.handleUp());
        this.screen.key(['down', 'j'], () => this.handleDown());
        this.screen.key(['left'], () => this.handleLeft());
        this.screen.key(['right'], () => this.handleRight());

        // Zoom
        this.screen.key(['+', '='], () => {
            this.navigator.zoomIn();
            this.render();
        });
        this.screen.key(['-', '_'], () => {
            this.navigator.zoomOut();
            this.render();
        });

        // Cursor/selection
        this.screen.key(['space'], () => {
            this.navigator.toggleCursorAtCenter();
            this.render();
        });
        this.screen.key(['c'], () => {
            this.navigator.centerOnCursor();
            this.render();
        });

        // View controls
        this.screen.key(['f'], () => {
            this.navigator.fitAll();
            this.render();
        });
        this.screen.key(['home', '0'], () => {
            this.navigator.goToStart();
            this.render();
        });
        this.screen.key(['end', '$'], () => {
            this.navigator.goToEnd();
            this.render();
        });

        // Panel switching
        this.screen.key(['tab'], () => {
            this.hierarchyFocused = !this.hierarchyFocused;
            this.render();
        });

        this.screen.key(['enter'], () => this.handleEnter());

        // Hierarchy expand/collapse
        this.screen.key(['e'], () => {
            this.hierarchy.expandAll();
            this.updateHierarchyList();
            this.render();
        });
        this.screen.key(['w'], () => {
            this.hierarchy.collapseAll();
            this.updateHierarchyList();
            this.render();
        });

        // Value format: 1=hex, 2=binary, 3=decimal (h/b/d conflict with vim navigation)
        this.screen.key(['1', 'x'], () => {
            this.valueFormat = 'hex';
            this.render();
        });
        this.screen.key(['2', 'b'], () => {
            this.valueFormat = 'binary';
            this.render();
        });
        this.screen.key(['3', 'd'], () => {
            this.valueFormat = 'decimal';
            this.render();
        });
    }

    // ========================================================================
    // Navigation Handlers
    // ========================================================================

    private handleUp(): void {
        if (this.hierarchyFocused) {
            if (this.hierarchyIndex > 0) {
                this.hierarchyIndex--;
                this.hierarchyList.select(this.hierarchyIndex);
            }
        } else {
            this.navigator.selectPrevious();
        }
        this.render();
    }

    private handleDown(): void {
        if (this.hierarchyFocused) {
            const list = this.hierarchy.getFlatList();
            if (this.hierarchyIndex < list.length - 1) {
                this.hierarchyIndex++;
                this.hierarchyList.select(this.hierarchyIndex);
            }
        } else {
            this.navigator.selectNext();
        }
        this.render();
    }

    private handleLeft(): void {
        // Left arrow always controls waveform (pan or move cursor)
        const state = this.navigator.getState();
        if (state.cursorTime !== null) {
            this.navigator.moveCursorLeft();
        } else {
            this.navigator.panLeft();
        }
        this.render();
    }

    private handleRight(): void {
        // Right arrow always controls waveform (pan or move cursor)
        const state = this.navigator.getState();
        if (state.cursorTime !== null) {
            this.navigator.moveCursorRight();
        } else {
            this.navigator.panRight();
        }
        this.render();
    }

    private handleEnter(): void {
        if (this.hierarchyFocused) {
            const list = this.hierarchy.getFlatList();
            const node = list[this.hierarchyIndex];
            if (node && node.type === 'scope') {
                this.hierarchy.toggle(node);
                this.updateHierarchyList();
                this.render();
            }
        }
    }

    private handleResize(): void {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => {
            this.render();
        }, LAYOUT.RESIZE_DEBOUNCE_MS);
    }

    // ========================================================================
    // File Loading
    // ========================================================================

    async open(vcdPath: string): Promise<void> {
        this.filePath = vcdPath;

        try {
            // Update header
            const fileName = vcdPath.split(/[/\\]/).pop() ?? vcdPath;
            this.headerBox.setContent(` GateFlow Waveform Viewer - ${fileName}`);

            // Emit status
            this.bus.emit({
                type: 'status',
                phase: 'tool',
                label: 'Loading waveform...'
            });

            // Load via store
            const metadata = await this.store.open(vcdPath);

            // Convert store data to legacy format for Navigator/Hierarchy
            this.legacyData = await this.convertToLegacyFormat();

            // Initialize components
            this.navigator.setData(this.legacyData);
            this.hierarchy.buildFromData(this.legacyData);
            this.navigator.setSignalList(this.hierarchy.getVisibleSignals());

            // Emit waveform loaded event
            this.bus.emit({
                type: 'waveform_loaded',
                path: vcdPath,
                signalCount: metadata.signalCount,
                timeRange: metadata.timeRange
            });

            // Ensure raw mode for key capture
            if (process.stdin.setRawMode) {
                process.stdin.setRawMode(true);
            }
            process.stdin.resume();

            // Update UI
            this.updateHierarchyList();
            this.render();
            this.screen.render();

            return new Promise((resolve) => {
                this.closeResolve = resolve;
            });
        } catch (error) {
            this.screen.destroy();
            throw error;
        }
    }

    /**
     * Convert store data to legacy format for compatibility with Navigator/Hierarchy
     */
    private async convertToLegacyFormat(): Promise<WaveformData> {
        const metadata = this.store.getMetadata();
        const storeSignals = this.store.getSignals();

        // Load all signal data
        const signals: WaveformSignal[] = [];
        for (const sig of storeSignals) {
            const data = await this.store.getSignalData(sig.id);
            this.signalDataCache.set(sig.id, data);

            signals.push({
                id: sig.id,
                name: sig.name,
                width: sig.width,
                values: data.values.map(v => [Number(v.time), v.value] as [number, number | string]),
            });
        }

        // Convert hierarchy
        const rootScope = this.convertScopeNode(metadata.hierarchy);

        return {
            timescale: `${metadata.timescale.value}${metadata.timescale.unit}`,
            signals,
            rootScope,
        };
    }

    private convertScopeNode(node: import('./store/index.js').ScopeNode): import('./types.js').WaveformScope {
        return {
            name: node.name,
            children: node.children.map(c => this.convertScopeNode(c)),
            signals: node.signals.map(s => s.id),
        };
    }

    // ========================================================================
    // Dimension Calculation
    // ========================================================================

    private calculateDimensions(): CanvasDimensions {
        // Get actual screen dimensions (blessed may return number or string)
        let screenWidth: number;
        let screenHeight: number;

        try {
            const w = this.screen.width;
            const h = this.screen.height;

            screenWidth = typeof w === 'number' ? w : parseInt(String(w), 10) || 80;
            screenHeight = typeof h === 'number' ? h : parseInt(String(h), 10) || 24;
        } catch {
            screenWidth = 80;
            screenHeight = 24;
        }

        // Calculate wave panel width (75% of screen)
        const wavePanelWidth = Math.floor(screenWidth * LAYOUT.WAVE_WIDTH_PERCENT / 100);

        // Canvas width = panel width - borders - signal labels - padding
        const canvasWidth = wavePanelWidth - LAYOUT.BORDER_WIDTH - LAYOUT.SIGNAL_LABEL_WIDTH - LAYOUT.PANEL_PADDING;

        // Canvas height = screen height - header - status - borders - time ruler
        const canvasHeight = screenHeight
            - LAYOUT.HEADER_HEIGHT
            - LAYOUT.STATUS_HEIGHT
            - LAYOUT.BORDER_HEIGHT
            - LAYOUT.TIME_RULER_HEIGHT;

        return {
            width: Math.max(LAYOUT.MIN_CANVAS_WIDTH, Math.min(LAYOUT.MAX_CANVAS_WIDTH, canvasWidth)),
            height: Math.max(LAYOUT.MIN_CANVAS_HEIGHT, Math.min(LAYOUT.MAX_CANVAS_HEIGHT, canvasHeight)),
            screenWidth,
            screenHeight,
        };
    }

    // ========================================================================
    // Rendering
    // ========================================================================

    private updateHierarchyList(): void {
        const list = this.hierarchy.getFlatList();
        const items = list.map((node) => this.formatHierarchyNode(node));
        this.hierarchyList.setItems(items);
        this.navigator.setSignalList(this.hierarchy.getVisibleSignals());
    }

    private formatHierarchyNode(node: HierarchyNode): string {
        const indent = '  '.repeat(node.depth);
        const expandIcon = this.useUnicode ? (node.expanded ? '▼' : '▶') : (node.expanded ? 'v' : '>');
        const signalIcon = this.useUnicode ? '•' : '*';
        const prefix = node.type === 'scope'
            ? `{cyan-fg}${expandIcon}{/}`
            : `{green-fg}${signalIcon}{/}`;

        let label = `${indent}${prefix} ${node.name}`;

        if (node.type === 'signal' && node.signal) {
            const value = this.getSignalValue(node.signal);
            label += ` {dim-fg}[${value}]{/}`;
        }

        return label;
    }

    private getSignalValue(signal: WaveformSignal): string {
        const state = this.navigator.getState();
        const time = state.cursorTime ?? state.timeEnd;
        return this.waveRenderer.formatValue(
            this.getValueAtTime(signal, time),
            signal.width,
            this.valueFormat
        );
    }

    private getValueAtTime(signal: WaveformSignal, time: number): number | string {
        if (signal.values.length === 0) return 0;

        let value = signal.values[0][1];
        for (const [t, v] of signal.values) {
            if (t <= time) {
                value = v;
            } else {
                break;
            }
        }
        return value;
    }

    private render(): void {
        if (!this.legacyData) return;

        const state = this.navigator.getState();
        const signals = this.hierarchy.getVisibleSignals();
        const dims = this.calculateDimensions();

        // Update hierarchy border style based on focus
        this.hierarchyList.style.border = {
            fg: this.hierarchyFocused ? COLORS.accent : COLORS.primary,
        };
        this.wavePanel.style.border = {
            fg: !this.hierarchyFocused ? COLORS.accent : COLORS.primary,
        };

        // Render time ruler
        const timescaleUnit = this.legacyData.timescale.replace(/\d+/g, '');
        const ruler = this.waveRenderer.renderTimeRuler(state.timeStart, state.timeEnd, dims.width, timescaleUnit);
        this.timeRuler.setContent(`{cyan-fg}${ruler}{/}`);

        // Render signals
        const labelLines: string[] = [];
        const waveLines: string[] = [];

        const startIdx = Math.max(0, state.selectedIndex - Math.floor(dims.height / 2));
        const visibleSignals = signals.slice(startIdx, startIdx + dims.height);

        for (let i = 0; i < visibleSignals.length; i++) {
            const signal = visibleSignals[i];
            const isSelected = startIdx + i === state.selectedIndex;

            // Render label
            const value = this.getSignalValue(signal);
            const labelText = signal.name.slice(0, 10).padEnd(10);
            const valueText = value.slice(0, 4).padStart(4);

            if (isSelected && !this.hierarchyFocused) {
                labelLines.push(`{inverse}${labelText} ${valueText}{/}`);
            } else {
                labelLines.push(`{cyan-fg}${labelText}{/} {dim-fg}${valueText}{/}`);
            }

            // Render waveform
            const rendered = this.waveRenderer.renderSignal(signal, state.timeStart, state.timeEnd, {
                width: dims.width,
                showValues: true,
                valueFormat: this.valueFormat,
            });

            const waveColor = signal.width === 1 ? 'cyan' : 'green';
            if (isSelected && !this.hierarchyFocused) {
                waveLines.push(`{${waveColor}-fg}{bold}${rendered.waveform}{/}`);
            } else {
                waveLines.push(`{${waveColor}-fg}${rendered.waveform}{/}`);
            }
        }

        this.signalLabels.setContent(labelLines.join('\n'));
        this.waveCanvas.setContent(waveLines.join('\n'));

        // Update cursor line
        if (state.cursorTime !== null) {
            const cursorCol = this.navigator.timeToColumn(state.cursorTime, dims.width);
            if (cursorCol >= 0 && cursorCol < dims.width) {
                this.cursorLine.left = LAYOUT.SIGNAL_LABEL_WIDTH + cursorCol;
                this.cursorLine.show();
            } else {
                this.cursorLine.hide();
            }
        } else {
            this.cursorLine.hide();
        }

        // Update status bar
        const zoomPercent = Math.round(state.zoom * 100);
        const cursorInfo = state.cursorTime !== null
            ? ` | Cursor: ${Math.round(state.cursorTime)}${timescaleUnit}`
            : '';
        const modeInfo = this.useUnicode ? '' : ' [ASCII]';
        const statusInfo = ` Time: ${Math.round(state.timeStart)}-${Math.round(state.timeEnd)}${timescaleUnit} | Zoom: ${zoomPercent}%${cursorInfo}${modeInfo}`;

        this.statusBar.setContent(this.getHelpText() + `\n{dim-fg}${statusInfo}{/}`);

        this.screen.render();
    }

    // ========================================================================
    // Cleanup
    // ========================================================================

    private cleanup(): void {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        this.store.close();
    }

    close(): void {
        if (this.isClosing) return;
        this.isClosing = true;

        // Show closing message
        this.statusBar.setContent('{yellow-fg} Closing waveform viewer...{/}');
        this.screen.render();

        setTimeout(() => {
            this.screen.destroy();
            process.stdout.write('\x1B[2J\x1B[0f');
            console.log('Waveform viewer closed.');
            if (this.closeResolve) {
                this.closeResolve();
            }
        }, 200);
    }
}
