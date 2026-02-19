/**
 * Diff Display
 * Renders diffs with syntax highlighting and box decoration
 */

import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

interface DiffLine {
    type: 'context' | 'add' | 'remove' | 'header';
    lineNumber?: number;
    newLineNumber?: number;
    content: string;
}

interface DiffStats {
    additions: number;
    deletions: number;
    changes: number;
}

interface DiffDisplayOptions {
    width?: number;
    unicode?: boolean;
}

interface DiffGlyphs {
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
// DiffDisplay Class
// ============================================================================

export class DiffDisplay {
    private readonly boxWidth: number;
    private readonly unicode: boolean;
    private readonly glyphs: DiffGlyphs;

    constructor(
        widthOrOptions: number | DiffDisplayOptions = 70,
        options?: DiffDisplayOptions
    ) {
        const width = typeof widthOrOptions === 'number'
            ? widthOrOptions
            : (widthOrOptions.width ?? 70);
        const unicode = typeof widthOrOptions === 'number'
            ? (options?.unicode ?? true)
            : (widthOrOptions.unicode ?? true);

        this.boxWidth = Math.min(width, (process.stdout.columns || 80) - 4);
        this.unicode = unicode;
        this.glyphs = unicode
            ? { h: '\u{2500}', v: '\u{2502}', tl: '\u{250C}', tr: '\u{2510}', bl: '\u{2514}', br: '\u{2518}', teeL: '\u{251C}', teeR: '\u{2524}' }
            : { h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+', teeL: '+', teeR: '+' };
    }

    /**
     * Parse unified diff into structured lines
     */
    parseDiff(unifiedDiff: string): DiffLine[] {
        const lines = unifiedDiff.split('\n');
        const result: DiffLine[] = [];

        let oldLine = 0;
        let newLine = 0;

        for (const line of lines) {
            if (line.startsWith('@@')) {
                // Parse hunk header: @@ -10,5 +10,6 @@
                const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
                if (match) {
                    oldLine = parseInt(match[1], 10);
                    newLine = parseInt(match[2], 10);
                }
                result.push({ type: 'header', content: line });
            } else if (line.startsWith('---') || line.startsWith('+++')) {
                // Skip file headers
                continue;
            } else if (line.startsWith('-')) {
                result.push({
                    type: 'remove',
                    lineNumber: oldLine++,
                    content: line.slice(1)
                });
            } else if (line.startsWith('+')) {
                result.push({
                    type: 'add',
                    lineNumber: newLine++,
                    content: line.slice(1)
                });
            } else if (line.startsWith(' ') || line === '') {
                result.push({
                    type: 'context',
                    lineNumber: oldLine,
                    newLineNumber: newLine,
                    content: line.startsWith(' ') ? line.slice(1) : line
                });
                oldLine++;
                newLine++;
            }
        }

        return result;
    }

    /**
     * Get diff statistics
     */
    getStats(lines: DiffLine[]): DiffStats {
        let additions = 0, deletions = 0;

        for (const line of lines) {
            if (line.type === 'add') additions++;
            if (line.type === 'remove') deletions++;
        }

        return {
            additions,
            deletions,
            changes: Math.max(additions, deletions)
        };
    }

    /**
     * Apply basic syntax highlighting for SystemVerilog
     */
    highlightSV(code: string): string {
        // Keywords
        const keywords = /\b(module|endmodule|always_ff|always_comb|always|if|else|begin|end|posedge|negedge|input|output|inout|logic|reg|wire|assign|parameter|localparam|generate|endgenerate|for|while|case|endcase|default|function|endfunction|task|endtask|return|typedef|struct|enum|interface|endinterface|class|endclass|package|endpackage|import|initial|forever|repeat|fork|join|join_any|join_none|constraint|rand|randc|covergroup|endgroup|property|sequence|assert|assume|cover|restrict|unique|unique0|priority|inside|with|solve|before|dist|timescale|include|define|ifdef|ifndef|elsif|else|endif|undef)\b/g;

        let result = code;

        // Apply keyword highlighting (magenta)
        result = result.replace(keywords, (match) => chalk.magenta(match));

        // Numbers (decimal, binary, hex, octal)
        result = result.replace(/\b(\d+'[bdho][\da-fA-F_xXzZ]+|\d+)\b/g, (match) => chalk.yellow(match));

        // Strings
        result = result.replace(/"([^"]*)"/g, (match) => chalk.green(match));

        // Single-line comments
        result = result.replace(/(\/\/.*$)/gm, (match) => chalk.gray(match));

        return result;
    }

    /**
     * Format a single diff line
     */
    private formatLine(line: DiffLine, maxLineNum: number): string {
        const lineNumWidth = String(maxLineNum).length;
        const contentWidth = this.boxWidth - lineNumWidth - 8;

        let prefix: string;
        let lineNum: string;
        let content: string;
        let displayContent: string;

        // Truncate content if needed
        const truncate = (str: string, width: number): string => {
            if (str.length > width) {
                return str.slice(0, width - 3) + '...';
            }
            return str;
        };

        switch (line.type) {
            case 'add':
                prefix = chalk.green('+');
                lineNum = chalk.green(String(line.lineNumber || '').padStart(lineNumWidth));
                displayContent = truncate(line.content, contentWidth);
                content = chalk.green(this.highlightSV(displayContent));
                break;
            case 'remove':
                prefix = chalk.red('-');
                lineNum = chalk.red(String(line.lineNumber || '').padStart(lineNumWidth));
                displayContent = truncate(line.content, contentWidth);
                content = chalk.red(displayContent);
                break;
            case 'context':
                prefix = ' ';
                lineNum = chalk.gray(String(line.lineNumber || '').padStart(lineNumWidth));
                displayContent = truncate(line.content, contentWidth);
                content = this.highlightSV(displayContent);
                break;
            case 'header':
                return chalk.cyan(line.content);
            default:
                return line.content;
        }

        return `${prefix}${lineNum} ${this.glyphs.v} ${content}`;
    }

    /**
     * Draw a box around content
     */
    drawBox(title: string, content: string[], footer: string): string {
        const lines: string[] = [];
        const innerWidth = this.boxWidth - 2;

        // Top border with title
        const titlePadded = ` ${title} `;
        const leftBorderLen = Math.max(1, Math.floor((innerWidth - titlePadded.length) / 2));
        const rightBorderLen = Math.max(0, innerWidth - leftBorderLen - titlePadded.length);
        const topBorder = this.glyphs.h.repeat(leftBorderLen);
        const topBorderRight = this.glyphs.h.repeat(rightBorderLen);
        lines.push(chalk.cyan(this.glyphs.tl + topBorder + titlePadded + topBorderRight + this.glyphs.tr));

        // Empty line
        lines.push(chalk.cyan(this.glyphs.v) + ' '.repeat(innerWidth) + chalk.cyan(this.glyphs.v));

        // Content
        for (const line of content) {
            // Strip ANSI for length calculation
            const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
            const padding = Math.max(0, innerWidth - stripped.length - 1);
            lines.push(chalk.cyan(this.glyphs.v) + ' ' + line + ' '.repeat(padding) + chalk.cyan(this.glyphs.v));
        }

        // Empty line
        lines.push(chalk.cyan(this.glyphs.v) + ' '.repeat(innerWidth) + chalk.cyan(this.glyphs.v));

        // Separator
        lines.push(
            chalk.cyan(
                this.glyphs.teeL +
                this.glyphs.h.repeat(innerWidth) +
                this.glyphs.teeR
            )
        );

        // Footer
        const footerStripped = footer.replace(/\x1b\[[0-9;]*m/g, '');
        const footerPadding = Math.max(0, Math.floor((innerWidth - footerStripped.length) / 2));
        lines.push(
            chalk.cyan(this.glyphs.v) +
            ' '.repeat(footerPadding) +
            footer +
            ' '.repeat(innerWidth - footerPadding - footerStripped.length) +
            chalk.cyan(this.glyphs.v)
        );

        // Bottom border with actions
        const actions = '[y]es / [n]o / [e]dit / [d]iff';
        const actionsLen = actions.length;
        const bottomLeftLen = Math.max(1, Math.floor((innerWidth - actionsLen) / 2));
        const bottomRightLen = Math.max(0, innerWidth - bottomLeftLen - actionsLen);
        lines.push(
            chalk.cyan(this.glyphs.bl + this.glyphs.h.repeat(bottomLeftLen)) +
            chalk.yellow(actions) +
            chalk.cyan(this.glyphs.h.repeat(bottomRightLen) + this.glyphs.br)
        );

        return lines.join('\n');
    }

    /**
     * Render a diff for display
     */
    render(
        filePath: string,
        unifiedDiff: string,
        statsOverride?: { added: number; removed: number }
    ): string {
        const lines = this.parseDiff(unifiedDiff);
        const stats = statsOverride
            ? {
                additions: statsOverride.added,
                deletions: statsOverride.removed,
                changes: Math.max(statsOverride.added, statsOverride.removed)
            }
            : this.getStats(lines);

        // Find max line number for padding
        const lineNumbers = lines
            .filter(l => l.lineNumber !== undefined)
            .map(l => l.lineNumber!);
        const maxLineNum = lineNumbers.length > 0 ? Math.max(...lineNumbers) : 1;

        // Format content lines (skip headers for boxed display)
        const contentLines = lines
            .filter(l => l.type !== 'header')
            .map(l => this.formatLine(l, maxLineNum));

        // Stats footer
        const statsText = `${stats.changes} changes: ` +
            chalk.red(`${stats.deletions} deletions`) + ', ' +
            chalk.green(`${stats.additions} additions`);

        return this.drawBox(`Proposed Edit: ${filePath}`, contentLines, statsText);
    }

    /**
     * Render a compact inline diff (for smaller changes)
     */
    renderInline(
        filePath: string,
        unifiedDiff: string,
        statsOverride?: { added: number; removed: number }
    ): string {
        const lines = this.parseDiff(unifiedDiff);
        const stats = statsOverride
            ? {
                additions: statsOverride.added,
                deletions: statsOverride.removed,
                changes: Math.max(statsOverride.added, statsOverride.removed)
            }
            : this.getStats(lines);

        const output: string[] = [
            chalk.cyan(this.glyphs.h.repeat(3) + ' ') + chalk.bold(filePath) + chalk.cyan(' ' + this.glyphs.h.repeat(3))
        ];

        for (const line of lines) {
            if (line.type === 'header') continue;

            const lineNum = line.lineNumber ? String(line.lineNumber).padStart(4) : '    ';

            switch (line.type) {
                case 'add':
                    output.push(chalk.green(`+${lineNum} ${this.glyphs.v} ${line.content}`));
                    break;
                case 'remove':
                    output.push(chalk.red(`-${lineNum} ${this.glyphs.v} ${line.content}`));
                    break;
                case 'context':
                    output.push(chalk.gray(` ${lineNum} ${this.glyphs.v} ${line.content}`));
                    break;
            }
        }

        output.push(
            chalk.cyan(this.glyphs.h.repeat(3) + ' ') +
            chalk.green(`+${stats.additions}`) + ' / ' +
            chalk.red(`-${stats.deletions}`) +
            chalk.cyan(' ' + this.glyphs.h.repeat(3))
        );

        return output.join('\n');
    }

    /**
     * Render a minimal one-line summary
     */
    renderSummary(filePath: string, stats: DiffStats): string {
        return chalk.cyan(this.glyphs.h + ' ') +
            chalk.bold(filePath) +
            chalk.gray(` (+${stats.additions}/-${stats.deletions})`);
    }
}
