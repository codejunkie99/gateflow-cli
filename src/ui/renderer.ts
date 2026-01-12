/**
 * Terminal Renderer
 * Event-driven terminal output with token buffering
 * 
 * NO SPINNERS - uses simple status lines to avoid stdin/stdout conflicts.
 * This is the Claude Code approach: simple, reliable, no animation conflicts.
 */

import chalk from 'chalk';
import type { EventBus, UiEvent, Subscription } from '../events/index.js';
import { DiffPreview, colorizeDiff } from '../diff/preview.js';

// ============================================================================
// Types
// ============================================================================

export interface RendererOptions {
    colors?: boolean;
    unicode?: boolean;
    bufferInterval?: number;
    bufferSize?: number;
    verbose?: boolean;
    timestamps?: boolean;
    jsonMode?: boolean;
}

interface PendingApproval {
    id: string;
    action: string;
    details: string;
    diff?: string;
}

// ============================================================================
// Terminal Renderer
// ============================================================================

export class TerminalRenderer {
    private options: Required<RendererOptions>;
    private tokenBuffer: string = '';
    private bufferTimer: NodeJS.Timeout | null = null;
    private isStreaming: boolean = false;
    private currentPhase: string = '';
    private currentLabel: string = '';
    private pendingApproval: PendingApproval | null = null;
    private diffPreview: DiffPreview;
    private startTime: number = 0;
    private subscription: Subscription | null = null;
    private lastStatusLine: string = '';
    private inputPaused: boolean = false;

    constructor(
        private bus: EventBus,
        options?: RendererOptions
    ) {
        this.options = {
            colors: options?.colors ?? true,
            unicode: options?.unicode ?? true,
            bufferInterval: options?.bufferInterval ?? 16,
            bufferSize: options?.bufferSize ?? 100,
            verbose: options?.verbose ?? false,
            timestamps: options?.timestamps ?? false,
            jsonMode: options?.jsonMode ?? false
        };

        this.diffPreview = new DiffPreview({
            colorize: this.options.colors,
            maxLines: 30
        });
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    start(): void {
        this.startTime = Date.now();
        this.subscription = this.bus.subscribe(this.handleEvent.bind(this));
    }

    stop(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
            this.subscription = null;
        }
        this.flushBuffer();
        this.clearStatus();
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
    }

    /** Pause rendering for input */
    pauseForInput(): void {
        this.inputPaused = true;
        this.clearStatus();
    }

    /** Resume after input */
    resumeAfterInput(): void {
        this.inputPaused = false;
    }

    // ========================================================================
    // Event Handler
    // ========================================================================

    private handleEvent(event: UiEvent): void {
        if (this.options.jsonMode) {
            this.handleJsonMode(event);
            return;
        }

        // Skip rendering while input is active
        if (this.inputPaused && event.type !== 'error') {
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
                this.handleError(event.message, event.code);
                break;
            case 'final':
                this.handleFinal(event.summary, event.filesModified, event.exitCode);
                break;
            case 'index_update':
                this.handleIndexUpdate(event.added, event.removed, event.modified);
                break;
            case 'file_change':
                this.handleFileChange(event.path, event.changeType);
                break;
            case 'sim_stage':
                this.handleSimStage(event.stage, event.status, event.message);
                break;
            case 'sim_progress':
                this.handleSimProgress(event.stage, event.percent, event.message);
                break;
            case 'waveform_loaded':
                this.handleWaveformLoaded(event.path, event.signalCount, event.timeRange);
                break;
            case 'waveform_analysis':
                this.handleWaveformAnalysis(event.clocks, event.anomalies, event.coverage, event.summary);
                break;
            case 'thought':
                this.handleThought(event.stepNumber, event.category, event.thought, event.confidence);
                break;
            case 'agent_start':
                this.handleAgentStart(event.agentName, event.task);
                break;
            case 'agent_complete':
                this.handleAgentComplete(event.agentName, event.success, event.durationMs);
                break;
            case 'delegation':
                this.handleDelegation(event.from, event.to, event.taskType);
                break;
            default:
                if (this.options.verbose) {
                    console.log(chalk.gray(`[${event.type}]`), event);
                }
        }
    }

    // ========================================================================
    // Token Streaming
    // ========================================================================

    private handleToken(text: string): void {
        if (!this.isStreaming) {
            this.isStreaming = true;
            this.clearStatus();
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
        this.isStreaming = false;
        process.stdout.write('\n');
    }

    private flushBuffer(): void {
        if (this.tokenBuffer.length > 0) {
            process.stdout.write(this.tokenBuffer);
            this.tokenBuffer = '';
        }
    }

    // ========================================================================
    // Status (Simple text, no spinner)
    // ========================================================================

    private handleStatus(phase: string, label: string): void {
        this.currentPhase = phase;
        this.currentLabel = label;

        if (this.isStreaming || this.inputPaused) {
            return;
        }

        this.writeStatus(`${chalk.cyan('•')} ${label}`);
    }

    private writeStatus(text: string): void {
        this.clearStatus();
        this.lastStatusLine = text;
        process.stdout.write(text);
    }

    private clearStatus(): void {
        if (this.lastStatusLine) {
            // Clear the line
            process.stdout.write('\r' + ' '.repeat(this.lastStatusLine.length) + '\r');
            this.lastStatusLine = '';
        }
    }

    // ========================================================================
    // Tool Events
    // ========================================================================

    private handleToolCall(tool: string, argsSummary: string): void {
        this.clearStatus();
        this.log(
            chalk.cyan('•') + ' ' +
            chalk.blue.bold(tool) +
            chalk.gray(` ${argsSummary}`)
        );
    }

    private handleToolResult(tool: string, ok: boolean, summary: string, duration?: number): void {
        const icon = ok ? '✓' : '✗';
        const color = ok ? chalk.gray : chalk.red;
        const durationStr = duration ? chalk.gray(` (${duration}ms)`) : '';
        this.log(chalk.gray('  │ ') + color(`${icon} ${summary}`) + durationStr);
    }

    // ========================================================================
    // Diff Preview
    // ========================================================================

    private handleDiffPreview(
        path: string,
        unifiedDiff: string,
        stats: { added: number; removed: number }
    ): void {
        this.clearStatus();
        console.log('');
        console.log(this.diffPreview.render(path, unifiedDiff, { ...stats, chunks: 1 }));
    }

    // ========================================================================
    // Approval
    // ========================================================================

    private handleApprovalRequest(
        id: string,
        action: string,
        details: string,
        diff?: string
    ): void {
        this.clearStatus();
        this.pendingApproval = { id, action, details, diff };

        console.log('');
        console.log(chalk.yellow.bold('Approval Required'));
        console.log(chalk.white(`   ${action}: ${details}`));
        
        if (diff) {
            console.log('');
            console.log(colorizeDiff(diff));
        }

        console.log('');
        console.log(chalk.white('   [Y]es  [N]o  [A]ll  [S]kip'));
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
        return true;
    }

    isWaitingForApproval(): boolean {
        return this.pendingApproval !== null;
    }

    // ========================================================================
    // Error / Final
    // ========================================================================

    private handleError(message: string, code?: number): void {
        this.clearStatus();
        console.log('');
        this.log(chalk.red(`ERROR: ${message}`));
        if (code !== undefined) {
            this.log(chalk.gray(`   Exit code: ${code}`));
        }
    }

    private handleFinal(summary: string, filesModified: string[], exitCode: number): void {
        this.clearStatus();
        
        const duration = Date.now() - this.startTime;
        const status = exitCode === 0 ? 'SUCCESS' : 'FAILED';
        const color = exitCode === 0 ? chalk.blue : chalk.red;

        console.log('');
        console.log(color.bold(`${status}: ${summary}`));
        
        if (filesModified.length > 0) {
            console.log(chalk.gray(`   Modified: ${filesModified.join(', ')}`));
        }
        
        console.log(chalk.gray(`   Duration: ${this.formatDuration(duration)}`));
    }

    // ========================================================================
    // Index / Watch Events
    // ========================================================================

    private handleIndexUpdate(added: number, removed: number, modified: number): void {
        if (this.options.verbose) {
            console.log(
                chalk.blue('Index updated:') +
                chalk.green(` +${added}`) +
                chalk.red(` -${removed}`) +
                chalk.yellow(` ~${modified}`)
            );
        }
    }

    private handleFileChange(path: string, changeType: string): void {
        if (this.options.verbose) {
            const icon = changeType === 'add' ? '+' : changeType === 'unlink' ? '-' : '~';
            const color = changeType === 'add' ? chalk.green : changeType === 'unlink' ? chalk.red : chalk.yellow;
            console.log(color(`  [${icon}] ${path}`));
        }
    }

    // ========================================================================
    // Simulation Events
    // ========================================================================

    private handleSimStage(stage: string, status: string, message?: string): void {
        this.clearStatus();
        const prefix = status === 'started' ? '>' : status === 'completed' ? '+' : '-';
        const color = status === 'failed' ? chalk.red : status === 'completed' ? chalk.blue : chalk.cyan;
        console.log(color(`${prefix} ${stage}${message ? ': ' + message : ''}`));
    }

    private handleSimProgress(stage: string, percent: number, message: string): void {
        const bar = this.makeProgressBar(percent);
        this.writeStatus(`${stage} ${bar} ${message}`);
    }

    // ========================================================================
    // Waveform Events
    // ========================================================================

    private handleWaveformLoaded(
        path: string,
        signalCount: number,
        timeRange: { start: bigint; end: bigint }
    ): void {
        this.clearStatus();
        const fileName = path.split(/[/\\]/).pop() ?? path;
        const duration = timeRange.end - timeRange.start;

        console.log(chalk.cyan('~ ') + chalk.white.bold('Waveform loaded: ') + chalk.cyan(fileName));
        console.log(chalk.gray(`  ${signalCount} signals, ${duration.toString()} time units`));
    }

    private handleWaveformAnalysis(
        clocks: Array<{ signal: string; frequency: number }>,
        anomalies: Array<{ type: string; signal: string; time: bigint }>,
        coverage: { percentage: number },
        summary: string
    ): void {
        this.clearStatus();

        console.log(chalk.cyan('~ ') + chalk.white.bold('Waveform Analysis'));

        if (clocks.length > 0) {
            console.log(chalk.green(`  + Detected ${clocks.length} clock(s):`));
            for (const clk of clocks.slice(0, 5)) {
                console.log(chalk.gray(`    - ${clk.signal} @ ${clk.frequency.toFixed(4)} MHz`));
            }
        }

        if (anomalies.length > 0) {
            console.log(chalk.yellow(`  ! Found ${anomalies.length} anomaly(s):`));
            for (const a of anomalies.slice(0, 5)) {
                console.log(chalk.gray(`    - ${a.type} on ${a.signal} @ t=${a.time.toString()}`));
            }
            if (anomalies.length > 5) {
                console.log(chalk.gray(`    ... and ${anomalies.length - 5} more`));
            }
        } else {
            console.log(chalk.green('  + No anomalies detected'));
        }

        const coverageColor = coverage.percentage >= 90 ? chalk.green :
            coverage.percentage >= 70 ? chalk.yellow : chalk.red;
        console.log(coverageColor(`  Coverage: ${coverage.percentage.toFixed(1)}%`));
        console.log(chalk.gray(`  ${summary}`));
    }

    // ========================================================================
    // Multi-Agent Events
    // ========================================================================

    private handleThought(stepNumber: number, category: string, thought: string, confidence?: number): void {
        if (!this.options.verbose) return;

        const prefixes: Record<string, string> = {
            analyzing: '[ANALYZING]',
            planning: '[PLANNING]',
            decomposing: '[DECOMPOSING]',
            coordinating: '[COORDINATING]',
            generating: '[GENERATING]',
            validating: '[VALIDATING]',
            fixing: '[FIXING]'
        };

        const prefix = prefixes[category] || '[THINKING]';
        const confStr = confidence !== undefined ? chalk.gray(` ${Math.round(confidence * 100)}%`) : '';

        console.log(chalk.gray(`  ${prefix} ${thought}${confStr}`));
    }

    private handleAgentStart(agentName: string, task: string): void {
        this.clearStatus();
        console.log(
            chalk.cyan('[') +
            chalk.white.bold(agentName) +
            chalk.cyan('] ') +
            chalk.white(task)
        );
    }

    private handleAgentComplete(agentName: string, success: boolean, durationMs: number): void {
        const statusIcon = success ? '[OK]' : '[FAIL]';
        const statusColor = success ? chalk.green : chalk.red;
        const durationStr = this.formatDuration(durationMs);

        console.log(
            chalk.gray('  ') +
            statusColor(statusIcon) +
            chalk.gray(` ${agentName} (${durationStr})`)
        );
    }

    private handleDelegation(from: string, to: string, taskType: string): void {
        console.log(
            chalk.gray('  -> ') +
            chalk.cyan(from) +
            chalk.gray(' -> ') +
            chalk.cyan(to) +
            chalk.gray(` [${taskType}]`)
        );
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    private formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    }

    private getTimestamp(): string {
        if (!this.options.timestamps) return '';
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false });
        return chalk.gray(`[${time}] `);
    }

    private log(message: string): void {
        console.log(this.getTimestamp() + message);
    }

    private makeProgressBar(percent: number, width: number = 20): string {
        const filled = Math.round(width * percent / 100);
        const empty = width - filled;
        return '[' + '='.repeat(filled) + '-'.repeat(empty) + ']';
    }

    // ========================================================================
    // JSON Mode
    // ========================================================================

    private handleJsonMode(event: UiEvent): void {
        const json = JSON.stringify(event, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );
        console.log(json);
    }
}

// ============================================================================
// Factory
// ============================================================================

export function createRenderer(
    bus: EventBus,
    options?: RendererOptions
): TerminalRenderer {
    const renderer = new TerminalRenderer(bus, options);
    renderer.start();
    return renderer;
}
