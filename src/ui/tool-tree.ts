/**
 * Tool Tree Display
 * Renders tool calls as a hierarchical tree structure
 */

import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

export interface ToolCallNode {
    tool: string;
    args: string;
    startTime: number;
    endTime?: number;
    result?: {
        ok: boolean;
        summary: string;
    };
}

// ============================================================================
// ToolTree Class
// ============================================================================

export class ToolTree {
    private nodes: ToolCallNode[] = [];
    private currentNode: ToolCallNode | null = null;

    // Tool icons mapping (ASCII symbols for compatibility)
    private readonly toolIcons: Record<string, string> = {
        'read_file': '[R]',
        'write_file': '[W]',
        'edit_file': '[E]',
        'lint_file': '[L]',
        'grep_context': '[G]',
        'search_history': '[H]',
        'run_command': '[!]',
        'generate_code': '[*]',
        'list_files': '[D]',
        'find_symbol': '[S]',
        'get_hierarchy': '[T]',
        'simulate': '[~]',
        'view_waveform': '[V]',
        'query_knowledge': '[Q]',
        'store_knowledge': '[K]',
        'default': '[>]'
    };

    /**
     * Add a new tool call to the tree
     */
    addToolCall(tool: string, args: string): void {
        this.currentNode = {
            tool,
            args,
            startTime: Date.now()
        };
        this.nodes.push(this.currentNode);
    }

    /**
     * Complete the current tool call with result
     */
    completeToolCall(ok: boolean, summary: string): void {
        if (this.currentNode) {
            this.currentNode.endTime = Date.now();
            this.currentNode.result = { ok, summary };
            this.currentNode = null;
        }
    }

    /**
     * Get icon for a tool
     */
    private getIcon(tool: string): string {
        return this.toolIcons[tool] || this.toolIcons['default'];
    }

    /**
     * Format duration in human readable form
     */
    private formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    /**
     * Render a single node
     */
    private renderNode(node: ToolCallNode, isLast: boolean): string[] {
        const lines: string[] = [];
        const prefix = isLast ? '\u{2514}\u{2500}' : '\u{251C}\u{2500}'; // '└─' or '├─'
        const childPrefix = isLast ? '   ' : '\u{2502}  '; // '   ' or '│  '

        const icon = this.getIcon(node.tool);

        // Tool call line
        lines.push(
            chalk.cyan(prefix) + ' ' +
            icon + ' ' +
            chalk.blue.bold(node.tool) +
            chalk.gray(` ${node.args}`)
        );

        // Result line (if completed)
        if (node.result) {
            const duration = node.endTime
                ? chalk.gray(` (${this.formatDuration(node.endTime - node.startTime)})`)
                : '';

            if (node.result.ok) {
                lines.push(
                    chalk.cyan(childPrefix) + '   \u{2514}\u{2500} ' + // '   └─ '
                    chalk.green('\u{2713}') + ' ' + // '✓'
                    chalk.gray(node.result.summary) +
                    duration
                );
            } else {
                lines.push(
                    chalk.cyan(childPrefix) + '   \u{2514}\u{2500} ' +
                    chalk.red('\u{2717}') + ' ' + // '✗'
                    chalk.red(node.result.summary) +
                    duration
                );
            }
        } else {
            // In progress
            lines.push(
                chalk.cyan(childPrefix) + '   \u{2514}\u{2500} ' +
                chalk.yellow('\u{2819}') + ' ' + // spinner dot
                chalk.gray('Running...')
            );
        }

        return lines;
    }

    /**
     * Render the entire tree
     */
    render(): string {
        if (this.nodes.length === 0) return '';

        const lines: string[] = [];

        this.nodes.forEach((node, index) => {
            const isLast = index === this.nodes.length - 1;
            lines.push(...this.renderNode(node, isLast));
        });

        return lines.join('\n');
    }

    /**
     * Render only the last N nodes (for incremental display)
     */
    renderLast(count: number = 1): string {
        const startIndex = Math.max(0, this.nodes.length - count);
        const nodesToRender = this.nodes.slice(startIndex);

        const lines: string[] = [];
        nodesToRender.forEach((node, index) => {
            const isLast = startIndex + index === this.nodes.length - 1;
            lines.push(...this.renderNode(node, isLast));
        });

        return lines.join('\n');
    }

    /**
     * Get just the tool call line (without result)
     */
    renderToolCallLine(isLast: boolean = true): string | null {
        if (!this.currentNode) return null;

        const prefix = isLast ? '\u{2514}\u{2500}' : '\u{251C}\u{2500}';
        const icon = this.getIcon(this.currentNode.tool);

        return (
            chalk.cyan(prefix) + ' ' +
            icon + ' ' +
            chalk.blue.bold(this.currentNode.tool) +
            chalk.gray(` ${this.currentNode.args}`)
        );
    }

    /**
     * Get just the result line of the last completed node
     */
    renderResultLine(isLast: boolean = true): string | null {
        // Find the most recently completed node
        const completedNodes = this.nodes.filter(n => n.result);
        if (completedNodes.length === 0) return null;

        const node = completedNodes[completedNodes.length - 1];
        const childPrefix = isLast ? '   ' : '\u{2502}  ';
        const duration = node.endTime
            ? chalk.gray(` (${this.formatDuration(node.endTime - node.startTime)})`)
            : '';

        if (node.result!.ok) {
            return (
                chalk.cyan(childPrefix) + '   \u{2514}\u{2500} ' +
                chalk.green('\u{2713}') + ' ' +
                chalk.gray(node.result!.summary) +
                duration
            );
        } else {
            return (
                chalk.cyan(childPrefix) + '   \u{2514}\u{2500} ' +
                chalk.red('\u{2717}') + ' ' +
                chalk.red(node.result!.summary) +
                duration
            );
        }
    }

    /**
     * Clear the tree
     */
    clear(): void {
        this.nodes = [];
        this.currentNode = null;
    }

    /**
     * Get statistics
     */
    getStats(): { total: number; success: number; failed: number; pending: number } {
        let success = 0, failed = 0, pending = 0;

        for (const node of this.nodes) {
            if (!node.result) pending++;
            else if (node.result.ok) success++;
            else failed++;
        }

        return { total: this.nodes.length, success, failed, pending };
    }

    /**
     * Get total duration of all completed tool calls
     */
    getTotalDuration(): number {
        return this.nodes.reduce((sum, node) => {
            if (node.endTime) {
                return sum + (node.endTime - node.startTime);
            }
            return sum;
        }, 0);
    }

    /**
     * Check if there's a tool call in progress
     */
    hasActiveCall(): boolean {
        return this.currentNode !== null;
    }

    /**
     * Get the current tool name (if active)
     */
    getCurrentTool(): string | null {
        return this.currentNode?.tool ?? null;
    }
}
