import React from 'react';
import chalk from 'chalk';
import { render } from 'ink';
import type { EventBus, UiEvent, AgentCompleteEvent } from '../../events/index.js';
import { DiffDisplay } from '../diff-display.js';
import { colorizeDiff } from '../../diff/preview.js';
import { ToolTree } from '../tool-tree.js';
import { InkStore } from './store.js';
import { InkApp } from './InkApp.js';
import { getPromptController } from '../prompt-controller.js';
import { BlockRenderer } from '../block-renderer.js';
import { getStartupLines, clearStartupLines } from '../startup-messages.js';

export interface RendererOptions {
    colors?: boolean;
    unicode?: boolean;
    bufferInterval?: number;
    bufferSize?: number;
    verbose?: boolean;
    timestamps?: boolean;
    jsonMode?: boolean;
    useSpinner?: boolean;
    useToolTree?: boolean;
    showTokens?: boolean;
}

export interface Renderer {
    start(): void;
    stop(): void;
    pauseForInput(): void;
    resumeAfterInput(): void;
    isWaitingForApproval(): boolean;
    processApprovalInput(input: string): boolean;
    enableAltScreen?(): void;
    clearScreen?(): void;
}

interface PendingApproval {
    id: string;
    action: string;
    details: string;
    diff?: string;
}

// ANSI escape codes for alternate screen buffer
const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';

export class InkRenderer {
    private options: Required<RendererOptions>;
    private subscription: { unsubscribe: () => void } | null = null;
    private tokenBuffer = '';
    private bufferTimer: NodeJS.Timeout | null = null;
    private isStreaming = false;
    private pendingApproval: PendingApproval | null = null;
    private diffDisplay: DiffDisplay;
    private toolTree: ToolTree;
    private blockRenderer: BlockRenderer;
    private store: InkStore;
    private inkInstance: ReturnType<typeof render> | null = null;
    private useAltScreen: boolean = false;
    private resizeHandler: (() => void) | null = null;

    private tokenUsage = { input: 0, output: 0, cached: 0 };
    private toolCallCount = 0;

    private readonly pricing = {
        input: 3.00,
        output: 15.00,
        cached: 0.30
    };

    constructor(
        private bus: EventBus,
        options?: RendererOptions
    ) {
        this.options = {
            colors: options?.colors ?? true,
            unicode: options?.unicode ?? true,
            bufferInterval: options?.bufferInterval ?? 32,
            bufferSize: options?.bufferSize ?? 200,
            verbose: options?.verbose ?? false,
            timestamps: options?.timestamps ?? false,
            jsonMode: options?.jsonMode ?? false,
            useSpinner: options?.useSpinner ?? true,
            useToolTree: options?.useToolTree ?? true,
            showTokens: options?.showTokens ?? true
        };

        this.toolTree = new ToolTree({ unicode: this.options.unicode });
        this.diffDisplay = new DiffDisplay({ unicode: this.options.unicode });

        this.store = new InkStore({
            toolTree: this.toolTree
        });

        this.blockRenderer = new BlockRenderer({
            unicode: this.options.unicode,
            output: (line) => this.appendRaw(line)
        });
    }

    /**
     * Enable alternate screen mode (like vim/htop)
     * This prevents resize artifacts by using a separate screen buffer
     */
    enableAltScreen(): void {
        if (!process.stdout.isTTY) return;
        if (!this.useAltScreen) {
            this.useAltScreen = true;
            process.stdout.write(ENTER_ALT_SCREEN + CLEAR_SCREEN + CURSOR_HOME);
            // Force a redraw in the alternate buffer so the UI appears immediately.
            this.store.setState({});
        }
    }

    /**
     * Clear the screen (useful after resize)
     */
    clearScreen(): void {
        if (!process.stdout.isTTY) return;
        process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
    }

    start(): void {
        const promptController = getPromptController();
        const startupLines = getStartupLines();
        if (startupLines.length > 0) {
            for (const line of startupLines) {
                this.store.appendLog(line);
            }
            clearStartupLines();
        }

        this.inkInstance = render(
            <InkApp
                store={this.store}
                promptController={promptController}
                showTokens={this.options.showTokens}
                useSpinner={this.options.useSpinner}
                unicode={this.options.unicode}
            />
        );

        // Set up resize handler - just trigger re-render, let Ink handle it
        this.resizeHandler = () => {
            if (this.inkInstance) {
                // Trigger re-render with new dimensions - Ink handles the rest
                this.store.setState({});
            }
        };
        process.stdout.on('resize', this.resizeHandler);

        this.subscription = this.bus.subscribe(this.handleEvent.bind(this));
    }

    stop(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }

        // Remove resize handler
        if (this.resizeHandler) {
            process.stdout.off('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        this.flushBuffer();
        const currentStream = this.store.getState().stream;
        if (currentStream) {
            this.appendRaw(currentStream);
            this.store.setState({ stream: '' });
        }
        this.isStreaming = false;
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        if (this.inkInstance) {
            this.inkInstance.unmount();
            this.inkInstance = null;

            // Leave alternate screen if we were using it
            if (this.useAltScreen) {
                process.stdout.write(LEAVE_ALT_SCREEN);
                this.useAltScreen = false;
            }
        }
    }

    pauseForInput(): void {
        this.store.setState({ inputPaused: true });
    }

    resumeAfterInput(): void {
        this.store.setState({ inputPaused: false });
    }

    isWaitingForApproval(): boolean {
        return this.pendingApproval !== null;
    }

    processApprovalInput(input: string): boolean {
        if (!this.pendingApproval) return false;

        const key = input.toLowerCase().trim();
        let approved = false;
        let scope: 'once' | 'session' | 'project' = 'once';

        switch (key) {
            case 'y':
            case 'yes':
                approved = true;
                scope = 'once';
                break;
            case 'a':
            case 'all':
                approved = true;
                scope = 'session';
                break;
            case 'n':
            case 'no':
            case 's':
            case 'skip':
                approved = false;
                scope = 'once';
                break;
            default:
                return false;
        }

        this.bus.emit({
            type: 'approval_response',
            id: this.pendingApproval.id,
            approved,
            scope
        });

        this.pendingApproval = null;
        this.store.setState({ pendingApproval: null });
        return true;
    }

    private handleEvent(event: UiEvent): void {
        if (this.options.jsonMode) {
            const json = JSON.stringify(event, (_, value) =>
                typeof value === 'bigint' ? value.toString() : value
            );
            process.stdout.write(json + '\n');
            return;
        }

        switch (event.type) {
            case 'token':
                this.handleToken(event.text);
                break;
            case 'token_done':
                this.handleTokenDone();
                break;
            case 'status':
                this.handleStatus(event.phase, event.label);
                break;
            case 'tool_call':
                this.handleToolCall(event.tool, event.argsSummary);
                break;
            case 'tool_result':
                this.handleToolResult(event.tool, event.ok, event.summary, event.duration);
                break;
            case 'diff_preview':
                this.handleDiffPreview(event.path, event.unifiedDiff, event.stats);
                break;
            case 'approval_request':
                this.handleApprovalRequest(event.id, event.action, event.details, event.diff);
                break;
            case 'error':
                this.log(chalk.red(`ERROR: ${event.message}`));
                break;
            case 'log':
                this.appendRaw(event.message);
                break;
            case 'timeout':
                this.log(chalk.yellow(`TIMEOUT: ${event.message}`));
                break;
            case 'final':
                this.handleFinal(event.summary, event.exitCode, event.filesModified);
                break;
            case 'index_update':
                if (this.options.verbose) {
                    this.appendRaw(
                        chalk.blue('Index updated:') +
                        chalk.green(` +${event.added}`) +
                        chalk.red(` -${event.removed}`) +
                        chalk.yellow(` ~${event.modified}`)
                    );
                }
                break;
            case 'file_change':
                if (this.options.verbose) {
                    const icon = event.changeType === 'add' ? '+' : event.changeType === 'unlink' ? '-' : '~';
                    const color = event.changeType === 'add'
                        ? chalk.green
                        : event.changeType === 'unlink'
                        ? chalk.red
                        : chalk.yellow;
                    this.appendRaw(color(`  [${icon}] ${event.path}`));
                }
                break;
            case 'sim_stage':
                this.appendRaw(chalk.gray(`[sim] ${event.stage} ${event.status}${event.message ? `: ${event.message}` : ''}`));
                break;
            case 'sim_progress':
                if (this.options.verbose) {
                    this.appendRaw(chalk.gray(`[sim] ${event.stage} ${event.percent}% ${event.message ?? ''}`));
                }
                break;
            case 'prereq_install_stage':
                this.appendRaw(chalk.gray(`[setup] ${event.prerequisite}: ${event.stage} ${event.status}`));
                break;
            case 'waveform_loaded':
                this.appendRaw(chalk.cyan(`Waveform loaded: ${event.path} (${event.signalCount} signals)`));
                break;
            case 'waveform_analysis':
                this.appendRaw(chalk.cyan(`Waveform analysis: ${event.summary}`));
                break;
            case 'thought':
                if (this.options.verbose) {
                    this.appendRaw(chalk.gray(`[${event.category}] ${event.thought}`));
                }
                break;
            case 'agent_start':
                this.appendRaw(chalk.cyan(`[${event.agentName}] ${event.task}`));
                break;
            case 'agent_complete':
                this.handleAgentComplete(event);
                break;
            case 'delegation':
                if (this.options.verbose) {
                    this.appendRaw(chalk.gray(`Delegation: ${event.from} -> ${event.to} (${event.taskType})`));
                }
                break;
            default:
                if (this.options.verbose) {
                    this.appendRaw(chalk.gray(`[${event.type}] ${JSON.stringify(event)}`));
                }
        }
    }

    private handleToken(text: string): void {
        if (!this.isStreaming) {
            this.isStreaming = true;
            this.store.setState({ status: null });
        }

        this.tokenBuffer += text;

        if (this.tokenBuffer.length >= this.options.bufferSize) {
            this.flushBuffer();
        }

        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
        }
        this.bufferTimer = setTimeout(() => this.flushBuffer(), this.options.bufferInterval);
    }

    private handleTokenDone(): void {
        this.flushBuffer();
        if (this.store.getState().stream) {
            this.appendRaw(this.store.getState().stream);
        }
        this.store.setState({ stream: '' });
        this.isStreaming = false;
    }

    private flushBuffer(): void {
        if (!this.tokenBuffer) return;
        const nextStream = this.store.getState().stream + this.tokenBuffer;
        this.tokenBuffer = '';
        this.store.setState({ stream: nextStream });
    }

    private handleStatus(phase: string, label: string): void {
        const phaseSymbols: Record<string, string> = {
            thinking: '[?]',
            tool: '[>]',
            verifying: '[v]',
            fixing: '[~]',
            indexing: '[i]',
            watching: '[w]',
            setup: '[s]',
            downloading: '[d]',
            extracting: '[x]',
            executing: '[!]',
            memory: '[m]'
        };
        const symbol = phaseSymbols[phase] || '';
        this.store.setState({ status: { phase, label, symbol } });
    }

    private handleToolCall(tool: string, argsSummary: string): void {
        this.toolCallCount++;
        this.updateStatsState();
        if (this.options.useToolTree) {
            this.toolTree.addToolCall(tool, argsSummary);
            const line = this.toolTree.renderToolCallLine(true);
            if (line) this.appendRaw(line);
        } else {
            this.log(chalk.gray(`[tool] ${tool} ${argsSummary}`));
        }
    }

    private handleToolResult(tool: string, ok: boolean, summary: string, duration?: number): void {
        if (this.options.useToolTree) {
            this.toolTree.completeToolCall(ok, summary);
            const line = this.toolTree.renderResultLine(true);
            if (line) this.appendRaw(line);
        } else {
            const icon = ok
                ? (this.options.unicode ? '✓' : 'OK')
                : (this.options.unicode ? '✗' : 'X');
            const color = ok ? chalk.green : chalk.red;
            const durationStr = duration ? chalk.gray(` (${duration}ms)`) : '';
            this.log(color(`${icon} ${summary}`) + durationStr);
        }
    }

    private handleDiffPreview(
        path: string,
        unifiedDiff: string,
        stats: { added: number; removed: number }
    ): void {
        const rendered = this.diffDisplay.render(path, unifiedDiff, stats);
        this.appendRaw('');
        this.appendRaw(rendered);
    }

    private handleApprovalRequest(id: string, action: string, details: string, diff?: string): void {
        this.pendingApproval = { id, action, details, diff };
        this.store.setState({ pendingApproval: this.pendingApproval });
        if (diff) {
            this.appendRaw(colorizeDiff(diff));
        }
    }

    private handleAgentComplete(event: AgentCompleteEvent): void {
        if (event.inputTokens) this.tokenUsage.input += event.inputTokens;
        if (event.outputTokens) this.tokenUsage.output += event.outputTokens;
        if (event.cachedTokens) this.tokenUsage.cached += event.cachedTokens;
        this.updateStatsState();

        const statusIcon = event.success ? '[OK]' : '[FAIL]';
        const statusColor = event.success ? chalk.green : chalk.red;
        const durationStr = formatDuration(event.durationMs);
        this.appendRaw(
            chalk.gray('  ') + statusColor(statusIcon) + chalk.gray(` ${event.agentName} (${durationStr})`)
        );
    }

    private handleFinal(summary: string, exitCode: number, filesModified: string[]): void {
        const status = exitCode === 0 ? 'SUCCESS' : 'FAILED';
        const color = exitCode === 0 ? chalk.blue : chalk.red;
        this.appendRaw(color.bold(`${status}: ${summary}`));
        if (filesModified.length > 0) {
            this.appendRaw(chalk.gray(`   Modified: ${filesModified.join(', ')}`));
        }
        this.resetStats();
    }

    private updateStatsState(): void {
        this.store.setState({
            tokens: { ...this.tokenUsage },
            cost: this.calculateCost(),
            toolCallCount: this.toolCallCount
        });
    }

    private resetStats(): void {
        this.tokenUsage = { input: 0, output: 0, cached: 0 };
        this.toolCallCount = 0;
        this.toolTree.clear();
        this.updateStatsState();
    }

    private calculateCost(): number {
        const inputCost = (this.tokenUsage.input / 1_000_000) * this.pricing.input;
        const outputCost = (this.tokenUsage.output / 1_000_000) * this.pricing.output;
        const cachedCost = (this.tokenUsage.cached / 1_000_000) * this.pricing.cached;
        return inputCost + outputCost + cachedCost;
    }

    private formatTimestamp(): string {
        if (!this.options.timestamps) return '';
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false });
        return chalk.gray(`[${time}] `);
    }

    private log(message: string): void {
        this.appendRaw(this.formatTimestamp() + message);
    }

    private appendRaw(message: string): void {
        this.store.appendLog(message);
    }

    getToolTree(): ToolTree {
        return this.toolTree;
    }

    getBlockRenderer(): BlockRenderer {
        return this.blockRenderer;
    }

    getDiffDisplay(): DiffDisplay {
        return this.diffDisplay;
    }

    getTokenUsage(): { input: number; output: number; cached: number } {
        return { ...this.tokenUsage };
    }

    getToolCallCount(): number {
        return this.toolCallCount;
    }
}

class JsonRenderer implements Renderer {
    private subscription: { unsubscribe: () => void } | null = null;

    constructor(private bus: EventBus) {}

    start(): void {
        this.subscription = this.bus.subscribe(this.handleEvent.bind(this));
    }

    stop(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
    }

    pauseForInput(): void {
        // No-op in JSON mode.
    }

    resumeAfterInput(): void {
        // No-op in JSON mode.
    }

    isWaitingForApproval(): boolean {
        return false;
    }

    processApprovalInput(_input: string): boolean {
        return false;
    }

    private handleEvent(event: UiEvent): void {
        const json = JSON.stringify(event, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );
        process.stdout.write(json + '\n');
    }
}

export function createRenderer(
    bus: EventBus,
    options?: RendererOptions
): Renderer {
    if (options?.jsonMode) {
        const renderer = new JsonRenderer(bus);
        renderer.start();
        return renderer;
    }

    const renderer = new InkRenderer(bus, options);
    renderer.start();
    return renderer;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
