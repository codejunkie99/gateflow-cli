/**
 * Block Renderer
 * Warp-style block rendering for grouped command output
 */

import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

export interface BlockOptions {
    title: string;
    showTimer?: boolean;
    collapsible?: boolean;
    maxHeight?: number;
}

// ============================================================================
// Block Class
// ============================================================================

export class Block {
    private lines: string[] = [];
    private startTime: number;
    private endTime?: number;
    private options: BlockOptions;
    private width: number;
    public status: string = '';
    private success?: boolean;

    constructor(options: BlockOptions, width: number) {
        this.options = options;
        this.width = width;
        this.startTime = Date.now();
    }

    addLine(content: string): void {
        this.lines.push(content);
    }

    end(success?: boolean): void {
        this.endTime = Date.now();
        this.success = success;
    }

    private getDuration(): string {
        const elapsed = (this.endTime || Date.now()) - this.startTime;
        if (elapsed < 1000) return `${elapsed}ms`;
        return `${(elapsed / 1000).toFixed(1)}s`;
    }

    /**
     * Format a line to fit within the block
     */
    formatLine(content: string): string {
        const innerWidth = this.width - 4;
        // Strip ANSI for length calculation
        const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');

        let displayContent = content;
        if (stripped.length > innerWidth) {
            // Truncate but try to preserve ANSI codes
            displayContent = stripped.slice(0, innerWidth - 3) + '...';
        }

        const strippedDisplay = displayContent.replace(/\x1b\[[0-9;]*m/g, '');
        const padding = Math.max(0, innerWidth - strippedDisplay.length);

        return chalk.gray('\u{2502} ') + displayContent + ' '.repeat(padding) + chalk.gray(' \u{2502}'); // │
    }

    /**
     * Render the block header
     */
    renderHeader(): string {
        const innerWidth = this.width - 2;
        const title = ` ${this.options.title} `;
        const duration = this.options.showTimer ? ` ${this.getDuration()} ` : '';

        // Calculate border lengths
        const titleLen = title.length;
        const durationLen = duration.length;
        const leftBorderLen = Math.min(3, Math.max(1, Math.floor((innerWidth - titleLen - durationLen) / 2)));
        const rightBorderLen = Math.max(0, innerWidth - leftBorderLen - titleLen - durationLen);

        const leftBorder = '\u{2500}'.repeat(leftBorderLen); // ─
        const rightBorder = '\u{2500}'.repeat(rightBorderLen);

        return chalk.cyan('\u{250C}' + leftBorder) + // ┌
               chalk.bold(title) +
               chalk.cyan(rightBorder.slice(0, Math.max(0, rightBorder.length - durationLen))) +
               chalk.gray(duration) +
               chalk.cyan('\u{2500}\u{2510}'); // ─┐
    }

    /**
     * Render the block footer
     */
    renderFooter(): string {
        const innerWidth = this.width - 2;
        return chalk.cyan('\u{2514}' + '\u{2500}'.repeat(innerWidth) + '\u{2518}'); // └───┘
    }

    /**
     * Render an empty line within the block
     */
    renderEmptyLine(): string {
        const innerWidth = this.width - 4;
        return chalk.gray('\u{2502}') + ' '.repeat(innerWidth + 2) + chalk.gray('\u{2502}');
    }

    /**
     * Get all stored lines
     */
    getLines(): string[] {
        return this.lines;
    }

    /**
     * Check if block is complete
     */
    isComplete(): boolean {
        return this.endTime !== undefined;
    }

    /**
     * Get success status
     */
    isSuccess(): boolean | undefined {
        return this.success;
    }
}

// ============================================================================
// BlockRenderer Class
// ============================================================================

export class BlockRenderer {
    private blocks: Block[] = [];
    private currentBlock: Block | null = null;
    private width: number;

    constructor(width?: number) {
        this.width = width || Math.min(80, (process.stdout.columns || 80) - 2);
    }

    /**
     * Start a new block
     */
    startBlock(options: BlockOptions): void {
        this.endBlock(); // Close any existing block

        this.currentBlock = new Block(options, this.width);
        this.blocks.push(this.currentBlock);

        // Render header
        console.log(this.currentBlock.renderHeader());
    }

    /**
     * Add content to current block
     */
    addLine(content: string): void {
        if (this.currentBlock) {
            this.currentBlock.addLine(content);
            console.log(this.currentBlock.formatLine(content));
        } else {
            console.log(content);
        }
    }

    /**
     * Add an empty line to current block
     */
    addEmptyLine(): void {
        if (this.currentBlock) {
            this.currentBlock.addLine('');
            console.log(this.currentBlock.renderEmptyLine());
        } else {
            console.log('');
        }
    }

    /**
     * Update the block's status (e.g., for timer)
     */
    updateStatus(status: string): void {
        if (this.currentBlock) {
            this.currentBlock.status = status;
            // Note: Re-rendering header requires cursor manipulation
            // For simplicity, just update internally
        }
    }

    /**
     * End current block
     */
    endBlock(success?: boolean): void {
        if (this.currentBlock) {
            this.currentBlock.end(success);
            console.log(this.currentBlock.renderFooter());
            this.currentBlock = null;
        }
    }

    /**
     * Get the current block (if any)
     */
    getCurrentBlock(): Block | null {
        return this.currentBlock;
    }

    /**
     * Check if a block is active
     */
    hasActiveBlock(): boolean {
        return this.currentBlock !== null;
    }

    /**
     * Get all blocks
     */
    getBlocks(): Block[] {
        return this.blocks;
    }

    /**
     * Get block statistics
     */
    getStats(): { total: number; success: number; failed: number; pending: number } {
        let success = 0, failed = 0, pending = 0;

        for (const block of this.blocks) {
            if (!block.isComplete()) {
                pending++;
            } else if (block.isSuccess()) {
                success++;
            } else {
                failed++;
            }
        }

        return { total: this.blocks.length, success, failed, pending };
    }

    /**
     * Clear all blocks
     */
    clear(): void {
        if (this.currentBlock) {
            this.endBlock();
        }
        this.blocks = [];
        this.currentBlock = null;
    }

    /**
     * Create a simple separator line
     */
    renderSeparator(): string {
        return chalk.gray('\u{2500}'.repeat(this.width)); // ─
    }

    /**
     * Render a status block (for final summary)
     */
    renderStatusBlock(title: string, lines: string[], success: boolean): string {
        const output: string[] = [];
        const innerWidth = this.width - 2;

        // Status icon
        const icon = success ? chalk.green('\u{2713}') : chalk.red('\u{2717}'); // ✓ or ✗
        const titleWithIcon = `${icon} ${title}`;

        // Top border
        const titleLen = title.length + 2; // +2 for icon and space
        const leftBorder = '\u{2500}'.repeat(3);
        const rightBorderLen = Math.max(0, innerWidth - 3 - titleLen - 1);
        const rightBorder = '\u{2500}'.repeat(rightBorderLen);

        output.push(
            chalk.cyan('\u{250C}' + leftBorder + ' ') +
            titleWithIcon +
            chalk.cyan(' ' + rightBorder + '\u{2510}')
        );

        // Content
        for (const line of lines) {
            const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
            const padding = Math.max(0, innerWidth - stripped.length - 2);
            output.push(chalk.cyan('\u{2502} ') + line + ' '.repeat(padding) + chalk.cyan(' \u{2502}'));
        }

        // Bottom border
        output.push(chalk.cyan('\u{2514}' + '\u{2500}'.repeat(innerWidth) + '\u{2518}'));

        return output.join('\n');
    }
}
