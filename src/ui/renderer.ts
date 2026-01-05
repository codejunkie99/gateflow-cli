/**
 * Terminal Renderer
 * Event-driven terminal output with token buffering
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';
import type { EventBus, UiEvent } from '../events/index.js';
import { DiffPreview, colorizeDiff } from '../diff/preview.js';

// ============================================================================
// Types
// ============================================================================

export interface RendererOptions {
    /** Enable colors (default: true) */
    colors?: boolean;
    /** Enable unicode characters (default: true) */
    unicode?: boolean;
    /** Token buffer flush interval in ms (default: 16) */
    bufferInterval?: number;
    /** Token buffer size before flush (default: 100) */
    bufferSize?: number;
    /** Show verbose output (default: false) */
    verbose?: boolean;
    /** Show timestamps (default: false) */
    timestamps?: boolean;
    /** JSON output mode (default: false) */
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
    private spinner: Ora | null = null;
    private tokenBuffer: string = '';
    private bufferTimer: NodeJS.Timeout | null = null;
    private isStreaming: boolean = false;
    private currentPhase: string = '';
    private pendingApproval: PendingApproval | null = null;
    private diffPreview: DiffPreview;
    private startTime: number = 0;

    constructor(
        private bus: EventBus,
        options?: RendererOptions
    ) {
        this.options = {
            colors: options?.colors ?? true,
            unicode: options?.unicode ?? true,
            bufferInterval: options?.bufferInterval ?? 16,  // ~60fps
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

    /**
     * Start listening to events
     */
    start(): void {
        this.startTime = Date.now();
        this.bus.subscribe(this.handleEvent.bind(this));
    }

    /**
     * Stop renderer and cleanup
     */
    stop(): void {
        this.flushBuffer();
        this.stopSpinner();
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
        }
    }

    // ========================================================================
    // Event Handler
    // ========================================================================

    private handleEvent(event: UiEvent): void {
        if (this.options.jsonMode) {
            this.handleJsonMode(event);
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
    // Token Streaming (Buffered)
    // ========================================================================

    private handleToken(text: string): void {
        if (!this.isStreaming) {
            this.isStreaming = true;
            this.stopSpinner();
            // Print newline to separate from spinner
            process.stdout.write('\n');
        }

        this.tokenBuffer += text;

        // Flush if buffer exceeds size
        if (this.tokenBuffer.length >= this.options.bufferSize) {
            this.flushBuffer();
        }

        // Set/reset timer for flush
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
        }
        this.bufferTimer = setTimeout(() => this.flushBuffer(), this.options.bufferInterval);
    }

    private handleTokenDone(): void {
        this.flushBuffer();
        this.stopSpinner();
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
    // Status / Spinner
    // ========================================================================

    private handleStatus(phase: string, label: string): void {
        this.currentPhase = phase;

        // Flush any pending tokens
        this.flushBuffer();

        const icon = this.getPhaseIcon(phase);

        if (this.spinner) {
            this.spinner.text = `${icon} ${label}`;
        } else {
            this.spinner = ora({
                text: `${icon} ${label}`,
                color: this.getPhaseColor(phase) as any,
                spinner: this.options.unicode ? 'dots' : 'line'
            }).start();
        }
    }

    private stopSpinner(): void {
        if (this.spinner) {
            this.spinner.stop();
            this.spinner = null;
        }
    }

    private getPhaseIcon(phase: string): string {
        // No emojis - use simple text indicators
        return '•';
    }

    private getPhaseColor(phase: string): string {
        switch (phase) {
            case 'thinking': return 'blue';
            case 'tool': return 'cyan';
            case 'verifying': return 'blue';
            case 'fixing': return 'cyan';
            case 'indexing': return 'blue';
            case 'watching': return 'cyan';
            default: return 'white';
        }
    }

    // ========================================================================
    // Tool Events
    // ========================================================================

    private handleToolCall(tool: string, argsSummary: string): void {
        this.stopSpinner();
        
        console.log(
            chalk.cyan('•') + ' ' + 
            chalk.blue.bold(tool) +
            chalk.gray(` ${argsSummary}`)
        );
    }

    private handleToolResult(tool: string, ok: boolean, summary: string, duration?: number): void {
        const color = ok ? chalk.gray : chalk.red;
        const durationStr = duration ? chalk.gray(` (${duration}ms)`) : '';

        // Dotted connection line for tool results
        console.log(chalk.gray('  │ ') + color(summary) + durationStr);
    }

    // ========================================================================
    // Diff Preview
    // ========================================================================

    private handleDiffPreview(
        path: string,
        unifiedDiff: string,
        stats: { added: number; removed: number }
    ): void {
        this.stopSpinner();
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
        this.stopSpinner();
        this.pendingApproval = { id, action, details, diff };

        console.log('');
        console.log(chalk.yellow.bold('Approval Required'));
        console.log(chalk.white(`   ${action}: ${details}`));
        
        if (diff) {
            console.log('');
            console.log(colorizeDiff(diff));
        }

        console.log('');
        console.log(chalk.gray('   [Y]es  [N]o  [A]ll  [S]kip'));
    }

    /**
     * Process user approval input
     */
    processApprovalInput(input: string): boolean {
        if (!this.pendingApproval) return false;

        const key = input.toLowerCase().trim();
        let approved = false;
        let scope: 'once' | 'session' | 'project' | undefined;

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
                approved = false;
                break;
            case 's':
            case 'skip':
                approved = false;
                break;
            default:
                return false; // Invalid input
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

    /**
     * Check if waiting for approval
     */
    isWaitingForApproval(): boolean {
        return this.pendingApproval !== null;
    }

    // ========================================================================
    // Error / Final
    // ========================================================================

    private handleError(message: string, code?: number): void {
        this.stopSpinner();
        console.log('');
        console.log(chalk.red(`ERROR: ${message}`));
        if (code !== undefined) {
            console.log(chalk.gray(`   Exit code: ${code}`));
        }
    }

    private handleFinal(summary: string, filesModified: string[], exitCode: number): void {
        this.stopSpinner();
        
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

    private handleSimStage(
        stage: string,
        status: string,
        message?: string
    ): void {
        const prefix = status === 'started'
            ? '>'
            : status === 'completed'
            ? '+'
            : '-';

        const color = status === 'failed' ? chalk.red : status === 'completed' ? chalk.blue : chalk.cyan;

        console.log(color(`${prefix} ${stage}${message ? ': ' + message : ''}`));
    }

    private handleSimProgress(stage: string, percent: number, message: string): void {
        if (this.spinner) {
            const bar = this.makeProgressBar(percent);
            this.spinner.text = `${stage} ${bar} ${message}`;
        }
    }

    // ========================================================================
    // Thinking/Agent Events
    // ========================================================================

    private handleThought(stepNumber: number, category: string, thought: string, confidence?: number): void {
        const icons: Record<string, string> = {
            analyzing: '🔍',
            planning: '📋',
            decomposing: '🔨',
            coordinating: '🤝',
            generating: '⚡',
            validating: '✓',
            fixing: '🔧'
        };
        
        const icon = icons[category] || '•';
        const confStr = confidence !== undefined ? chalk.gray(` (${Math.round(confidence * 100)}%)`) : '';
        
        console.log(chalk.gray(`  ${icon} [${stepNumber}] ${thought}${confStr}`));
    }

    private handleAgentStart(agentName: string, task: string): void {
        this.stopSpinner();
        const agentColor = this.getAgentColor(agentName);
        
        console.log(
            chalk.cyan('[') + 
            agentColor.bold(agentName) +
            chalk.cyan('] ') +
            chalk.white(`Starting: ${task}`)
        );
    }

    private handleAgentComplete(agentName: string, success: boolean, durationMs: number): void {
        const agentColor = this.getAgentColor(agentName);
        const statusIcon = success ? '✓' : '✗';
        const durationStr = this.formatDuration(durationMs);
        
        console.log(
            chalk.gray('  │ ') +
            (success ? chalk.green : chalk.red)(`${statusIcon} Completed`) +
            chalk.gray(` (${durationStr})`)
        );
    }

    private handleDelegation(from: string, to: string, taskType: string): void {
        console.log(
            chalk.gray(`  └─ `) +
            chalk.cyan(`${from}`) +
            chalk.gray(' → ') +
            chalk.cyan(`${to}`) +
            chalk.gray(`: ${taskType}`)
        );
    }

    private getAgentColor(agentName: string): typeof chalk {
        const colors: Record<string, typeof chalk> = {
            'planning': chalk.blue,
            'understanding': chalk.cyan,
            'codegen': chalk.green,
            'refactoring': chalk.yellow,
            'testbench': chalk.magenta,
            'debug': chalk.red
        };
        return colors[agentName] || chalk.white;
    }

    // ========================================================================
    // JSON Mode
    // ========================================================================

    private handleJsonMode(event: UiEvent): void {
        // Serialize with BigInt support
        const json = JSON.stringify(event, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );
        console.log(json);
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    private formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    }

    private makeProgressBar(percent: number, width: number = 20): string {
        const filled = Math.round(width * percent / 100);
        const empty = width - filled;
        return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and start a renderer for the given event bus
 */
export function createRenderer(
    bus: EventBus,
    options?: RendererOptions
): TerminalRenderer {
    const renderer = new TerminalRenderer(bus, options);
    renderer.start();
    return renderer;
}

