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

export interface BlockRendererOptions {
    width?: number;
    unicode?: boolean;
    output?: (line: string) => void;
}

interface BlockGlyphs {
    h: string;
    v: string;
    tl: string;
    tr: string;
    bl: string;
    br: string;
    teeL: string;
    teeR: string;
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
    private glyphs: BlockGlyphs;
    public status: string = '';
    private success?: boolean;

    constructor(options: BlockOptions, width: number, glyphs: BlockGlyphs) {
        this.options = options;
        this.width = width;
        this.glyphs = glyphs;
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

        return chalk.gray(`${this.glyphs.v} `) + displayContent + ' '.repeat(padding) + chalk.gray(` ${this.glyphs.v}`);
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

        const leftBorder = this.glyphs.h.repeat(leftBorderLen);
        const rightBorder = this.glyphs.h.repeat(rightBorderLen);

        return chalk.cyan(this.glyphs.tl + leftBorder) +
               chalk.bold(title) +
               chalk.cyan(rightBorder.slice(0, Math.max(0, rightBorder.length - durationLen))) +
               chalk.gray(duration) +
               chalk.cyan(this.glyphs.h + this.glyphs.tr);
    }

    /**
     * Render the block footer
     */
    renderFooter(): string {
        const innerWidth = this.width - 2;
        return chalk.cyan(this.glyphs.bl + this.glyphs.h.repeat(innerWidth) + this.glyphs.br);
    }

    /**
     * Render an empty line within the block
     */
    renderEmptyLine(): string {
        const innerWidth = this.width - 4;
        return chalk.gray(this.glyphs.v) + ' '.repeat(innerWidth + 2) + chalk.gray(this.glyphs.v);
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
    private unicode: boolean;
    private glyphs: BlockGlyphs;
    private output: (line: string) => void;

    constructor(widthOrOptions?: number | BlockRendererOptions, options?: BlockRendererOptions) {
        const width = typeof widthOrOptions === 'number'
            ? widthOrOptions
            : (widthOrOptions?.width ?? options?.width);
        const unicode = typeof widthOrOptions === 'number'
            ? (options?.unicode ?? true)
            : (widthOrOptions?.unicode ?? true);
        const output = typeof widthOrOptions === 'number'
            ? options?.output
            : widthOrOptions?.output;

        this.width = width || Math.min(80, (process.stdout.columns || 80) - 2);
        this.unicode = unicode;
        this.glyphs = unicode
            ? { h: '\u{2500}', v: '\u{2502}', tl: '\u{250C}', tr: '\u{2510}', bl: '\u{2514}', br: '\u{2518}', teeL: '\u{251C}', teeR: '\u{2524}' }
            : { h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+', teeL: '+', teeR: '+' };
        this.output = output ?? ((line: string) => console.log(line));
    }

    private write(line: string): void {
        this.output(line);
    }

    /**
     * Start a new block
     */
    startBlock(options: BlockOptions): void {
        this.endBlock(); // Close any existing block

        this.currentBlock = new Block(options, this.width, this.glyphs);
        this.blocks.push(this.currentBlock);

        // Render header
        this.write(this.currentBlock.renderHeader());
    }

    /**
     * Add content to current block
     */
    addLine(content: string): void {
        if (this.currentBlock) {
            this.currentBlock.addLine(content);
            this.write(this.currentBlock.formatLine(content));
        } else {
            this.write(content);
        }
    }

    /**
     * Add an empty line to current block
     */
    addEmptyLine(): void {
        if (this.currentBlock) {
            this.currentBlock.addLine('');
            this.write(this.currentBlock.renderEmptyLine());
        } else {
            this.write('');
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
            this.write(this.currentBlock.renderFooter());
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
        return chalk.gray(this.glyphs.h.repeat(this.width));
    }

    /**
     * Render a status block (for final summary)
     */
    renderStatusBlock(title: string, lines: string[], success: boolean): string {
        const output: string[] = [];
        const innerWidth = this.width - 2;

        // Status icon
        const icon = success
            ? chalk.green(this.unicode ? '\u{2713}' : 'OK')
            : chalk.red(this.unicode ? '\u{2717}' : 'X');
        const titleWithIcon = `${icon} ${title}`;

        // Top border
        const titleLen = title.length + 2; // +2 for icon and space
        const leftBorder = this.glyphs.h.repeat(3);
        const rightBorderLen = Math.max(0, innerWidth - 3 - titleLen - 1);
        const rightBorder = this.glyphs.h.repeat(rightBorderLen);

        output.push(
            chalk.cyan(this.glyphs.tl + leftBorder + ' ') +
            titleWithIcon +
            chalk.cyan(' ' + rightBorder + this.glyphs.tr)
        );

        // Content
        for (const line of lines) {
            const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
            const padding = Math.max(0, innerWidth - stripped.length - 2);
            output.push(chalk.cyan(`${this.glyphs.v} `) + line + ' '.repeat(padding) + chalk.cyan(` ${this.glyphs.v}`));
        }

        // Bottom border
        output.push(chalk.cyan(this.glyphs.bl + this.glyphs.h.repeat(innerWidth) + this.glyphs.br));

        return output.join('\n');
    }
}
