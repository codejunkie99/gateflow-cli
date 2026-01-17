/**
 * Terminal Renderer
 * Event-driven terminal output with animated spinners, tool tree, and token tracking
 *
 * Enhanced with:
 * - Animated spinners via ora
 * - Tool call tree display
 * - Token counter with cost estimation
 * - Diff preview with syntax highlighting
 * - Warp-style block rendering
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import type { EventBus, UiEvent, Subscription, AgentCompleteEvent } from '../events/index.js';
import { DiffPreview, colorizeDiff } from '../diff/preview.js';
import { ToolTree } from './tool-tree.js';
import { DiffDisplay } from './diff-display.js';
import { BlockRenderer } from './block-renderer.js';

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
    useSpinner?: boolean;
    useToolTree?: boolean;
    showTokens?: boolean;
}

interface PendingApproval {
    id: string;
    action: string;
    details: string;
    diff?: string;
}

interface TokenUsage {
    input: number;
    output: number;
    cached: number;
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

    // Enhanced UI components
    private spinner: Ora | null = null;
    private spinnerActive: boolean = false;
    private toolTree: ToolTree = new ToolTree();
    private diffDisplay: DiffDisplay = new DiffDisplay();
    private blockRenderer: BlockRenderer = new BlockRenderer();

    // Token tracking
    private tokenUsage: TokenUsage = { input: 0, output: 0, cached: 0 };
    private toolCallCount: number = 0;

    // Cost per 1M tokens (Claude 3.5 Sonnet pricing)
    private readonly pricing = {
        input: 3.00,    // $3 per 1M input tokens
        output: 15.00,  // $15 per 1M output tokens
        cached: 0.30    // $0.30 per 1M cached tokens
    };

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
            jsonMode: options?.jsonMode ?? false,
            useSpinner: options?.useSpinner ?? true,
            useToolTree: options?.useToolTree ?? true,
            showTokens: options?.showTokens ?? true
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
        this.spinnerStop();
        this.clearStatus();
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
    }

    /** Pause rendering for input */
    pauseForInput(): void {
        this.inputPaused = true;
        this.spinnerStop();
        this.clearStatus();
    }

    /** Resume after input */
    resumeAfterInput(): void {
        this.inputPaused = false;
    }

    // ========================================================================
    // Spinner Management
    // ========================================================================

    /**
     * Start or update the spinner with a new message
     */
    private startSpinner(text: string, symbol?: string): void {
        if (this.inputPaused || !this.options.useSpinner) return;

        if (!this.spinner) {
            this.spinner = ora({
                text,
                spinner: 'dots',
                color: 'cyan',
                hideCursor: true
            });
        }

        if (symbol) {
            this.spinner.prefixText = symbol;
        } else {
            this.spinner.prefixText = '';
        }

        this.spinner.text = text;

        // Add token suffix if enabled
        if (this.options.showTokens) {
            const suffix = this.buildStatusSuffix();
            if (suffix) {
                this.spinner.suffixText = suffix;
            }
        }

        if (!this.spinnerActive) {
            this.spinner.start();
            this.spinnerActive = true;
        }
    }

    /**
     * Stop spinner with success state
     */
    private spinnerSucceed(text?: string): void {
        if (this.spinner && this.spinnerActive) {
            this.spinner.succeed(text);
            this.spinnerActive = false;
        }
    }

    /**
     * Stop spinner with failure state
     */
    private spinnerFail(text?: string): void {
        if (this.spinner && this.spinnerActive) {
            this.spinner.fail(text);
            this.spinnerActive = false;
        }
    }

    /**
     * Stop spinner without status (just clear it)
     */
    private spinnerStop(): void {
        if (this.spinner && this.spinnerActive) {
            this.spinner.stop();
            this.spinnerActive = false;
        }
    }

    /**
     * Update spinner text
     */
    private updateSpinnerText(text: string): void {
        if (this.spinner && this.spinnerActive) {
            this.spinner.text = text;
        }
    }

    // ========================================================================
    // Token Tracking
    // ========================================================================

    /**
     * Format token count (e.g., 1234 -> "1.2k")
     */
    private formatTokens(count: number): string {
        if (count >= 1000000) {
            return `${(count / 1000000).toFixed(1)}M`;
        }
        if (count >= 1000) {
            return `${(count / 1000).toFixed(1)}k`;
        }
        return String(count);
    }

    /**
     * Calculate estimated cost
     */
    private calculateCost(): number {
        const inputCost = (this.tokenUsage.input / 1_000_000) * this.pricing.input;
        const outputCost = (this.tokenUsage.output / 1_000_000) * this.pricing.output;
        const cachedCost = (this.tokenUsage.cached / 1_000_000) * this.pricing.cached;
        return inputCost + outputCost + cachedCost;
    }

    /**
     * Format cost (e.g., 0.0234 -> "$0.02")
     */
    private formatCost(cost: number): string {
        if (cost < 0.01) {
            return '<$0.01';
        }
        return `$${cost.toFixed(2)}`;
    }

    /**
     * Build status suffix with token info
     */
    private buildStatusSuffix(): string {
        const parts: string[] = [];

        // Token counts
        if (this.tokenUsage.input > 0 || this.tokenUsage.output > 0) {
            const inputStr = chalk.blue(`\u{2191}${this.formatTokens(this.tokenUsage.input)}`); // ↑
            const outputStr = chalk.green(`\u{2193}${this.formatTokens(this.tokenUsage.output)}`); // ↓
            parts.push(`${inputStr} ${outputStr}`);
        }

        // Cost estimate
        const cost = this.calculateCost();
        if (cost > 0) {
            parts.push(chalk.yellow(this.formatCost(cost)));
        }

        // Tool call count
        if (this.toolCallCount > 0) {
            parts.push(chalk.gray(`${this.toolCallCount} tools`));
        }

        if (parts.length === 0) return '';

        return chalk.gray(' \u{2502} ') + parts.join(chalk.gray(' \u{2502} ')); // │
    }

    /**
     * Reset stats for new run
     */
    private resetStats(): void {
        this.tokenUsage = { input: 0, output: 0, cached: 0 };
        this.toolCallCount = 0;
        this.toolTree.clear();
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
            case 'prereq_install_stage':
                this.handlePrereqStage(event.prerequisite, event.stage, event.status, event.message);
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
                this.handleAgentComplete(event.agentName, event.success, event.durationMs, event);
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
        // Stop spinner when streaming starts
        if (!this.isStreaming) {
            this.spinnerStop();
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
    // Status (with spinner)
    // ========================================================================

    private handleStatus(phase: string, label: string): void {
        this.currentPhase = phase;
        this.currentLabel = label;

        if (this.isStreaming || this.inputPaused) {
            return;
        }

        // Map phases to spinner symbols (ASCII for compatibility)
        const phaseSymbols: Record<string, string> = {
            'thinking': '[?]',
            'tool': '[>]',
            'verifying': '[v]',
            'fixing': '[~]',
            'indexing': '[i]',
            'watching': '[w]',
            'setup': '[s]',
            'downloading': '[d]',
            'extracting': '[x]',
            'executing': '[!]',
            'memory': '[m]'
        };

        const symbol = phaseSymbols[phase] || '';

        if (this.options.useSpinner) {
            this.startSpinner(label, symbol);
        } else {
            this.writeStatus(`${chalk.cyan('\u{2022}')} ${label}`); // •
        }
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
    // Tool Events (with tree)
    // ========================================================================

    private handleToolCall(tool: string, argsSummary: string): void {
        this.spinnerStop();
        this.clearStatus();
        this.toolCallCount++;

        if (this.options.useToolTree) {
            // Add to tree and render
            this.toolTree.addToolCall(tool, argsSummary);
            const toolLine = this.toolTree.renderToolCallLine(false);
            if (toolLine) {
                console.log(toolLine);
            }
        } else {
            this.log(
                chalk.cyan('\u{2022}') + ' ' + // •
                chalk.blue.bold(tool) +
                chalk.gray(` ${argsSummary}`)
            );
        }

        // Start spinner for tool execution
        if (this.options.useSpinner) {
            this.startSpinner(`Running ${tool}...`);
        }
    }

    private handleToolResult(tool: string, ok: boolean, summary: string, duration?: number): void {
        this.spinnerStop();

        if (this.options.useToolTree) {
            // Complete in tree and render result
            this.toolTree.completeToolCall(ok, summary);
            const resultLine = this.toolTree.renderResultLine(false);
            if (resultLine) {
                console.log(resultLine);
            }
        } else {
            const icon = ok ? '\u{2713}' : '\u{2717}'; // ✓ or ✗
            const color = ok ? chalk.gray : chalk.red;
            const durationStr = duration ? chalk.gray(` (${duration}ms)`) : '';
            this.log(chalk.gray('  \u{2502} ') + color(`${icon} ${summary}`) + durationStr); // │
        }
    }

    // ========================================================================
    // Diff Preview (enhanced)
    // ========================================================================

    private handleDiffPreview(
        path: string,
        unifiedDiff: string,
        stats: { added: number; removed: number }
    ): void {
        this.spinnerStop();
        this.clearStatus();

        console.log('');
        // Use the enhanced diff display for boxed rendering
        console.log(this.diffDisplay.render(path, unifiedDiff));
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
        this.spinnerStop();
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
        this.spinnerFail(message);
        this.clearStatus();
        console.log('');
        this.log(chalk.red(`ERROR: ${message}`));
        if (code !== undefined) {
            this.log(chalk.gray(`   Exit code: ${code}`));
        }
    }

    private handleFinal(summary: string, filesModified: string[], exitCode: number): void {
        this.spinnerStop();
        this.clearStatus();

        const duration = Date.now() - this.startTime;
        const status = exitCode === 0 ? 'SUCCESS' : 'FAILED';
        const color = exitCode === 0 ? chalk.blue : chalk.red;

        // Show tool call summary if we have any
        if (this.options.useToolTree) {
            const stats = this.toolTree.getStats();
            if (stats.total > 0) {
                console.log(
                    chalk.gray(`\n\u{2500}\u{2500}\u{2500} ${stats.total} tool calls: `) + // ───
                    chalk.green(`${stats.success} \u{2713}`) + // ✓
                    (stats.failed > 0 ? chalk.red(` ${stats.failed} \u{2717}`) : '') // ✗
                );
            }
        }

        console.log('');

        // Build final status with token info
        const suffix = this.options.showTokens ? this.buildStatusSuffix() : '';
        console.log(color.bold(`${status}: ${summary}`) + suffix);

        if (filesModified.length > 0) {
            console.log(chalk.gray(`   Modified: ${filesModified.join(', ')}`));
        }

        console.log(chalk.gray(`   Duration: ${this.formatDuration(duration)}`));

        // Reset for next run
        this.resetStats();
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
        if (status === 'started') {
            this.startSpinner(`${stage}${message ? ': ' + message : ''}`, '[!]');
        } else if (status === 'completed') {
            this.spinnerSucceed(`${stage} complete`);
        } else if (status === 'failed') {
            this.spinnerFail(`${stage} failed${message ? ': ' + message : ''}`);
        }
    }

    private handlePrereqStage(prereq: string, stage: string, status: string, message?: string): void {
        // Map prerequisite names to display names
        const prereqNames: Record<string, string> = {
            git: 'Git',
            cmake: 'CMake',
            compiler: 'C++ Compiler'
        };
        const displayName = prereqNames[prereq] || prereq;

        if (stage === 'checking') {
            if (status === 'started') {
                this.startSpinner(`Checking ${displayName}...`, '[?]');
            } else if (status === 'completed') {
                this.spinnerSucceed(`${displayName}${message ? ` (${message})` : ''}`);
            } else if (status === 'failed') {
                this.spinnerFail(`${displayName}${message ? ` (${message})` : ''}`);
            }
        } else {
            // For other stages (detecting, installing, verifying, manual)
            if (status === 'started') {
                this.startSpinner(`${displayName}: ${stage}${message ? ` ${message}` : ''}`, '[*]');
            } else if (status === 'completed') {
                this.spinnerSucceed(`${displayName}: ${stage}`);
            } else if (status === 'failed') {
                this.spinnerFail(`${displayName}: ${stage}${message ? ` ${message}` : ''}`);
            }
        }
    }

    private handleSimProgress(stage: string, percent: number, message: string): void {
        if (this.options.useSpinner && this.spinner && this.spinnerActive) {
            const bar = this.makeProgressBar(percent);
            this.spinner.text = `${stage} ${bar} ${message}`;
        } else {
            const bar = this.makeProgressBar(percent);
            this.writeStatus(`${stage} ${bar} ${message}`);
        }
    }

    // ========================================================================
    // Waveform Events
    // ========================================================================

    private handleWaveformLoaded(
        path: string,
        signalCount: number,
        timeRange: { start: bigint; end: bigint }
    ): void {
        this.spinnerSucceed('Waveform loaded');
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
        this.spinnerStop();

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
        this.spinnerStop();
        console.log(
            chalk.cyan('[') +
            chalk.white.bold(agentName) +
            chalk.cyan('] ') +
            chalk.white(task)
        );
        this.startSpinner(`${agentName} working...`, '[A]');
    }

    private handleAgentComplete(agentName: string, success: boolean, durationMs: number, event?: AgentCompleteEvent): void {
        // Update token usage from event
        if (event) {
            if (event.inputTokens) {
                this.tokenUsage.input += event.inputTokens;
            }
            if (event.outputTokens) {
                this.tokenUsage.output += event.outputTokens;
            }
            if (event.cachedTokens) {
                this.tokenUsage.cached += event.cachedTokens;
            }
        }

        const statusIcon = success ? '[OK]' : '[FAIL]';
        const statusColor = success ? chalk.green : chalk.red;
        const durationStr = this.formatDuration(durationMs);

        if (success) {
            this.spinnerSucceed(`${agentName} (${durationStr})`);
        } else {
            this.spinnerFail(`${agentName} (${durationStr})`);
        }

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

    // ========================================================================
    // Public Accessors
    // ========================================================================

    /**
     * Get the tool tree instance for external use
     */
    getToolTree(): ToolTree {
        return this.toolTree;
    }

    /**
     * Get the block renderer instance for external use
     */
    getBlockRenderer(): BlockRenderer {
        return this.blockRenderer;
    }

    /**
     * Get the diff display instance for external use
     */
    getDiffDisplay(): DiffDisplay {
        return this.diffDisplay;
    }

    /**
     * Get current token usage
     */
    getTokenUsage(): TokenUsage {
        return { ...this.tokenUsage };
    }

    /**
     * Get tool call count
     */
    getToolCallCount(): number {
        return this.toolCallCount;
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
