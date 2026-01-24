/**
 * Waveform Webview Provider
 * Provides waveform viewing capability in VS Code webview panels
 */

import * as fs from 'fs';
import * as path from 'path';
import { WaveformStore } from '../store/index.js';
import { getGlobalEventBus } from '../../events/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Interface matching VS Code's Webview API
 * This allows the provider to work with any webview implementation
 */
export interface WebviewLike {
    html: string;
    onDidReceiveMessage: (callback: (message: unknown) => void) => { dispose: () => void };
    postMessage: (message: unknown) => Promise<boolean>;
}

export interface WebviewPanelLike {
    webview: WebviewLike;
    onDidDispose: (callback: () => void) => { dispose: () => void };
    reveal: () => void;
    dispose: () => void;
}

export interface WebviewProviderOptions {
    extensionPath: string;
}

// ============================================================================
// Webview Content Provider
// ============================================================================

/**
 * Provides waveform viewer functionality for VS Code webviews
 */
export class WaveformWebviewProvider {
    private store: WaveformStore;
    private panel: WebviewPanelLike | null = null;
    private disposables: Array<{ dispose: () => void }> = [];
    private extensionPath: string;

    constructor(options: WebviewProviderOptions) {
        this.extensionPath = options.extensionPath;
        this.store = new WaveformStore({
            cacheSize: 100 * 1024 * 1024, // 100MB cache
        });
    }

    /**
     * Get the HTML content for the webview
     */
    getHtmlContent(): string {
        // Try to load from file first (development)
        const htmlPath = path.join(this.extensionPath, 'src', 'waveform', 'web', 'viewer.html');

        try {
            if (fs.existsSync(htmlPath)) {
                return fs.readFileSync(htmlPath, 'utf-8');
            }
        } catch {
            // Fall back to dist path
        }

        // Try dist path
        const distPath = path.join(this.extensionPath, 'dist', 'waveform', 'web', 'viewer.html');
        try {
            if (fs.existsSync(distPath)) {
                return fs.readFileSync(distPath, 'utf-8');
            }
        } catch {
            // Fall back to embedded HTML
        }

        // Return minimal fallback HTML
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        background: #1e1e1e;
                        color: #ccc;
                    }
                </style>
            </head>
            <body>
                <div>
                    <h2>Waveform Viewer</h2>
                    <p>Error: Could not load viewer HTML.</p>
                    <p>Please check that the extension is properly installed.</p>
                </div>
            </body>
            </html>
        `;
    }

    /**
     * Set the webview panel to use
     */
    setPanel(panel: WebviewPanelLike): void {
        // Dispose previous panel if exists
        if (this.panel) {
            this.dispose();
        }

        this.panel = panel;

        // Set HTML content
        panel.webview.html = this.getHtmlContent();

        // Handle messages from webview
        const messageDisposable = panel.webview.onDidReceiveMessage(
            (message) => this.handleMessage(message)
        );
        this.disposables.push(messageDisposable);

        // Handle panel disposal
        const disposeDisposable = panel.onDidDispose(() => {
            this.dispose();
        });
        this.disposables.push(disposeDisposable);
    }

    /**
     * Load a waveform file and send data to webview
     */
    async loadFile(filePath: string): Promise<void> {
        const bus = getGlobalEventBus();

        try {
            bus.emit({
                type: 'status',
                phase: 'tool',
                label: 'Loading waveform file...'
            });

            // Open file in store
            const metadata = await this.store.open(filePath);
            const signals = this.store.getSignals();

            // Send data to webview
            await this.postMessage({
                type: 'loadWaveform',
                data: {
                    filePath,
                    signals: signals.map(s => ({
                        id: s.id,
                        name: s.name,
                        fullPath: s.fullPath,
                        width: s.width,
                        type: s.type
                    })),
                    timeRange: {
                        start: metadata.timeRange.start.toString(),
                        end: metadata.timeRange.end.toString()
                    },
                    timescale: metadata.timescale,
                    signalCount: metadata.signalCount
                }
            });

            bus.emit({
                type: 'waveform_loaded',
                path: filePath,
                signalCount: metadata.signalCount,
                timeRange: metadata.timeRange
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';

            await this.postMessage({
                type: 'error',
                message: `Failed to load waveform: ${message}`
            });

            throw error;
        }
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: unknown): Promise<void> {
        if (!message || typeof message !== 'object') return;

        const msg = message as { type: string; [key: string]: unknown };

        switch (msg.type) {
            case 'ready':
                // Webview is ready, nothing to do yet
                break;

            case 'getSignalData':
                await this.handleGetSignalData(msg.signalId as string);
                break;

            case 'getSignalValue':
                await this.handleGetSignalValue(
                    msg.signalId as string,
                    BigInt(msg.time as string)
                );
                break;

            default:
                console.warn('Unknown message type:', msg.type);
        }
    }

    /**
     * Handle request for signal data
     */
    private async handleGetSignalData(signalId: string): Promise<void> {
        try {
            const data = await this.store.getSignalData(signalId);

            await this.postMessage({
                type: 'signalData',
                signalId,
                data: {
                    values: data.values.map(v => ({
                        time: v.time.toString(),
                        value: v.value
                    })),
                    timeRange: {
                        start: data.timeRange.start.toString(),
                        end: data.timeRange.end.toString()
                    }
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            await this.postMessage({
                type: 'error',
                message: `Failed to get signal data: ${message}`
            });
        }
    }

    /**
     * Handle request for signal value at specific time
     */
    private async handleGetSignalValue(signalId: string, time: bigint): Promise<void> {
        try {
            const value = await this.store.getSignalValue(signalId, time);

            await this.postMessage({
                type: 'signalValue',
                signalId,
                time: time.toString(),
                value
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            await this.postMessage({
                type: 'error',
                message: `Failed to get signal value: ${message}`
            });
        }
    }

    /**
     * Post message to webview
     */
    private async postMessage(message: unknown): Promise<void> {
        if (this.panel) {
            await this.panel.webview.postMessage(message);
        }
    }

    /**
     * Reveal the panel
     */
    reveal(): void {
        this.panel?.reveal();
    }

    /**
     * Check if panel is active
     */
    isActive(): boolean {
        return this.panel !== null;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];

        if (this.store.isOpen()) {
            this.store.close();
        }

        this.panel = null;
    }
}

// ============================================================================
// Factory function for VS Code extension
// ============================================================================

/**
 * Create a waveform webview provider
 * This is the main entry point for the VS Code extension
 */
export function createWaveformWebviewProvider(extensionPath: string): WaveformWebviewProvider {
    return new WaveformWebviewProvider({ extensionPath });
}

// ============================================================================
// Standalone server for testing (optional)
// ============================================================================

export interface StandaloneServerOptions {
    port?: number;
    vcdPath?: string;
}

/**
 * Start a standalone HTTP server for testing the viewer
 * This is useful for development without VS Code
 */
export async function startStandaloneServer(options: StandaloneServerOptions = {}): Promise<void> {
    const http = await import('http');
    const port = options.port || 3000;

    const store = new WaveformStore();
    let waveformData: unknown = null;

    // Load VCD if provided
    if (options.vcdPath) {
        const metadata = await store.open(options.vcdPath);
        const signals = store.getSignals();

        waveformData = {
            filePath: options.vcdPath,
            signals: signals.map(s => ({
                id: s.id,
                name: s.name,
                fullPath: s.fullPath,
                width: s.width,
                type: s.type
            })),
            timeRange: {
                start: metadata.timeRange.start.toString(),
                end: metadata.timeRange.end.toString()
            },
            timescale: metadata.timescale,
            signalCount: metadata.signalCount
        };
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Serve viewer HTML
        if (url.pathname === '/' || url.pathname === '/index.html') {
            // Try multiple paths (src for dev, dist for production)
            const possiblePaths = [
                path.join(process.cwd(), 'src', 'waveform', 'web', 'viewer.html'),
                path.join(process.cwd(), 'dist', 'waveform', 'web', 'viewer.html'),
            ];

            let html = '';
            for (const htmlPath of possiblePaths) {
                try {
                    if (fs.existsSync(htmlPath)) {
                        html = fs.readFileSync(htmlPath, 'utf-8');
                        break;
                    }
                } catch { /* continue */ }
            }

            try {
                if (!html) throw new Error('HTML not found');

                // Inject initial data if available
                const script = waveformData
                    ? `<script>
                        window.addEventListener('load', () => {
                            setTimeout(() => {
                                window.postMessage({
                                    type: 'loadWaveform',
                                    data: ${JSON.stringify(waveformData)}
                                }, '*');
                            }, 100);
                        });
                       </script>`
                    : '';

                // Use replacer function to avoid $ being treated as special replacement pattern
                // (waveformData may contain Verilog system tasks like $display, $finish, etc.)
                const htmlWithData = html.replace('</body>', () => `${script}</body>`);

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(htmlWithData);
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error loading viewer HTML');
            }
            return;
        }

        // API: Get signal data
        if (url.pathname === '/api/signal' && req.method === 'GET') {
            const signalId = url.searchParams.get('id');

            if (!signalId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing signal ID' }));
                return;
            }

            try {
                const data = await store.getSignalData(signalId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    values: data.values.map(v => ({
                        time: v.time.toString(),
                        value: v.value
                    })),
                    timeRange: {
                        start: data.timeRange.start.toString(),
                        end: data.timeRange.end.toString()
                    }
                }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to get signal data' }));
            }
            return;
        }

        // 404 for unknown routes
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    });

    server.listen(port, () => {
        console.log(`Waveform viewer server running at http://localhost:${port}`);
        if (options.vcdPath) {
            console.log(`Loaded: ${options.vcdPath}`);
        }
    });
}
