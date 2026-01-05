/**
 * Terminal Renderer
 * Event-driven terminal output with token buffering
 */
import chalk from 'chalk';
import ora from 'ora';
import { DiffPreview, colorizeDiff } from '../diff/preview.js';
// ============================================================================
// Terminal Renderer
// ============================================================================
export class TerminalRenderer {
    bus;
    options;
    spinner = null;
    tokenBuffer = '';
    bufferTimer = null;
    isStreaming = false;
    currentPhase = '';
    pendingApproval = null;
    diffPreview;
    startTime = 0;
    constructor(bus, options) {
        this.bus = bus;
        this.options = {
            colors: options?.colors ?? true,
            unicode: options?.unicode ?? true,
            bufferInterval: options?.bufferInterval ?? 16, // ~60fps
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
    start() {
        this.startTime = Date.now();
        this.bus.subscribe(this.handleEvent.bind(this));
    }
    /**
     * Stop renderer and cleanup
     */
    stop() {
        this.flushBuffer();
        this.stopSpinner();
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
        }
    }
    // ========================================================================
    // Event Handler
    // ========================================================================
    handleEvent(event) {
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
    handleToken(text) {
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
    handleTokenDone() {
        this.flushBuffer();
        this.stopSpinner();
        this.isStreaming = false;
        process.stdout.write('\n');
    }
    flushBuffer() {
        if (this.tokenBuffer.length > 0) {
            process.stdout.write(this.tokenBuffer);
            this.tokenBuffer = '';
        }
    }
    // ========================================================================
    // Status / Spinner
    // ========================================================================
    handleStatus(phase, label) {
        this.currentPhase = phase;
        // Flush any pending tokens
        this.flushBuffer();
        const icon = this.getPhaseIcon(phase);
        if (this.spinner) {
            this.spinner.text = `${icon} ${label}`;
        }
        else {
            this.spinner = ora({
                text: `${icon} ${label}`,
                color: this.getPhaseColor(phase),
                spinner: this.options.unicode ? 'dots' : 'line'
            }).start();
        }
    }
    stopSpinner() {
        if (this.spinner) {
            this.spinner.stop();
            this.spinner = null;
        }
    }
    getPhaseIcon(phase) {
        // No emojis - use simple text indicators
        return '•';
    }
    getPhaseColor(phase) {
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
    handleToolCall(tool, argsSummary) {
        this.stopSpinner();
        console.log(chalk.cyan('•') + ' ' +
            chalk.blue.bold(tool) +
            chalk.gray(` ${argsSummary}`));
    }
    handleToolResult(tool, ok, summary, duration) {
        const color = ok ? chalk.gray : chalk.red;
        const durationStr = duration ? chalk.gray(` (${duration}ms)`) : '';
        // Dotted connection line for tool results
        console.log(chalk.gray('  │ ') + color(summary) + durationStr);
    }
    // ========================================================================
    // Diff Preview
    // ========================================================================
    handleDiffPreview(path, unifiedDiff, stats) {
        this.stopSpinner();
        console.log('');
        console.log(this.diffPreview.render(path, unifiedDiff, { ...stats, chunks: 1 }));
    }
    // ========================================================================
    // Approval
    // ========================================================================
    handleApprovalRequest(id, action, details, diff) {
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
    processApprovalInput(input) {
        if (!this.pendingApproval)
            return false;
        const key = input.toLowerCase().trim();
        let approved = false;
        let scope;
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
    isWaitingForApproval() {
        return this.pendingApproval !== null;
    }
    // ========================================================================
    // Error / Final
    // ========================================================================
    handleError(message, code) {
        this.stopSpinner();
        console.log('');
        console.log(chalk.red(`ERROR: ${message}`));
        if (code !== undefined) {
            console.log(chalk.gray(`   Exit code: ${code}`));
        }
    }
    handleFinal(summary, filesModified, exitCode) {
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
    handleIndexUpdate(added, removed, modified) {
        if (this.options.verbose) {
            console.log(chalk.blue('Index updated:') +
                chalk.green(` +${added}`) +
                chalk.red(` -${removed}`) +
                chalk.yellow(` ~${modified}`));
        }
    }
    handleFileChange(path, changeType) {
        if (this.options.verbose) {
            const icon = changeType === 'add' ? '+' : changeType === 'unlink' ? '-' : '~';
            const color = changeType === 'add' ? chalk.green : changeType === 'unlink' ? chalk.red : chalk.yellow;
            console.log(color(`  [${icon}] ${path}`));
        }
    }
    // ========================================================================
    // Simulation Events
    // ========================================================================
    handleSimStage(stage, status, message) {
        const prefix = status === 'started'
            ? '>'
            : status === 'completed'
                ? '+'
                : '-';
        const color = status === 'failed' ? chalk.red : status === 'completed' ? chalk.blue : chalk.cyan;
        console.log(color(`${prefix} ${stage}${message ? ': ' + message : ''}`));
    }
    handleSimProgress(stage, percent, message) {
        if (this.spinner) {
            const bar = this.makeProgressBar(percent);
            this.spinner.text = `${stage} ${bar} ${message}`;
        }
    }
    // ========================================================================
    // Multi-Agent Events
    // ========================================================================
    /**
     * Handle thinking step events (verbose mode only)
     */
    handleThought(stepNumber, category, thought, confidence) {
        // Only show thinking in verbose mode
        if (!this.options.verbose)
            return;
        const prefixes = {
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
    /**
     * Handle agent start events
     */
    handleAgentStart(agentName, task) {
        this.stopSpinner();
        console.log(chalk.cyan('[') +
            chalk.white.bold(agentName) +
            chalk.cyan('] ') +
            chalk.white(task));
    }
    /**
     * Handle agent completion events
     */
    handleAgentComplete(agentName, success, durationMs) {
        const statusIcon = success ? '[OK]' : '[FAIL]';
        const statusColor = success ? chalk.green : chalk.red;
        const durationStr = this.formatDuration(durationMs);
        console.log(chalk.gray('  ') +
            statusColor(statusIcon) +
            chalk.gray(` ${agentName} (${durationStr})`));
    }
    /**
     * Handle task delegation events
     */
    handleDelegation(from, to, taskType) {
        console.log(chalk.gray('  └─ ') +
            chalk.cyan(from) +
            chalk.gray(' → ') +
            chalk.cyan(to) +
            chalk.gray(` [${taskType}]`));
    }
    // ========================================================================
    // Utilities
    // ========================================================================
    formatDuration(ms) {
        if (ms < 1000)
            return `${ms}ms`;
        if (ms < 60000)
            return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    }
    makeProgressBar(percent, width = 20) {
        const filled = Math.round(width * percent / 100);
        const empty = width - filled;
        return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
    }
    // ========================================================================
    // JSON Mode
    // ========================================================================
    handleJsonMode(event) {
        // Serialize with BigInt support
        const json = JSON.stringify(event, (_, value) => typeof value === 'bigint' ? value.toString() : value);
        console.log(json);
    }
}
// ============================================================================
// Factory
// ============================================================================
/**
 * Create and start a renderer for the given event bus
 */
export function createRenderer(bus, options) {
    const renderer = new TerminalRenderer(bus, options);
    renderer.start();
    return renderer;
}
