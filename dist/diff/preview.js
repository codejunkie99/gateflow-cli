/**
 * Diff Preview
 * Terminal rendering for diff previews
 */
import chalk from 'chalk';
// ============================================================================
// Diff Preview Renderer
// ============================================================================
export class DiffPreview {
    options;
    constructor(options) {
        this.options = {
            maxLines: options?.maxLines ?? 50,
            showLineNumbers: options?.showLineNumbers ?? true,
            contextLines: options?.contextLines ?? 3,
            colorize: options?.colorize ?? true,
            boxed: options?.boxed ?? true
        };
    }
    /**
     * Render a unified diff for terminal display
     */
    render(path, diff, stats) {
        const lines = [];
        // Header
        if (this.options.boxed) {
            lines.push(this.renderBoxTop(path, stats));
        }
        else {
            lines.push(this.renderHeader(path, stats));
        }
        // Diff content
        const diffLines = this.renderDiffContent(diff);
        lines.push(...diffLines);
        // Footer
        if (this.options.boxed) {
            lines.push(this.renderBoxBottom());
        }
        // Action prompt
        lines.push(this.renderPrompt());
        return lines.join('\n');
    }
    /**
     * Render just the diff content (no box/header)
     */
    renderDiffContent(diff) {
        const lines = [];
        const diffLines = diff.split('\n');
        let lineCount = 0;
        let truncated = false;
        for (const line of diffLines) {
            // Skip header lines
            if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')) {
                continue;
            }
            if (lineCount >= this.options.maxLines) {
                truncated = true;
                break;
            }
            lines.push(this.renderLine(line));
            lineCount++;
        }
        if (truncated) {
            lines.push(chalk.gray(`  ... (${diffLines.length - lineCount} more lines)`));
        }
        return lines;
    }
    /**
     * Render a single diff line with coloring
     */
    renderLine(line) {
        const indent = '  ';
        if (!this.options.colorize) {
            return indent + line;
        }
        // Hunk header
        if (line.startsWith('@@')) {
            return indent + chalk.cyan(line);
        }
        // Added line
        if (line.startsWith('+')) {
            return indent + chalk.green(line);
        }
        // Removed line
        if (line.startsWith('-')) {
            return indent + chalk.red(line);
        }
        // Context line
        return indent + chalk.gray(line);
    }
    /**
     * Render boxed header
     */
    renderBoxTop(filePath, stats) {
        const title = ` Proposed Changes `;
        const statsStr = `(+${stats.added} -${stats.removed})`;
        const maxWidth = Math.max(60, filePath.length + statsStr.length + 10);
        const topBorder = '┌' + '─'.repeat(maxWidth - 2) + '┐';
        const fileLine = '│ ' + chalk.bold(filePath) + ' ' + chalk.gray(statsStr) + ' '.repeat(maxWidth - 4 - filePath.length - statsStr.length) + '│';
        const separator = '├' + '─'.repeat(maxWidth - 2) + '┤';
        return [
            chalk.blue(topBorder),
            chalk.blue('│') + chalk.cyan.bold(title) + ' '.repeat(maxWidth - title.length - 2) + chalk.blue('│'),
            chalk.blue(separator),
            chalk.blue(fileLine),
            chalk.blue('├' + '─'.repeat(maxWidth - 2) + '┤'),
        ].join('\n');
    }
    /**
     * Render boxed footer
     */
    renderBoxBottom() {
        const maxWidth = 60;
        return chalk.blue('└' + '─'.repeat(maxWidth - 2) + '┘');
    }
    /**
     * Render simple header (no box)
     */
    renderHeader(filePath, stats) {
        return chalk.bold.cyan(`📝 ${filePath}`) +
            chalk.gray(` (+${stats.added} -${stats.removed})`);
    }
    /**
     * Render action prompt
     */
    renderPrompt() {
        return chalk.yellow('  [Y]es apply  [N]o reject  [V]iew full  [E]dit patch');
    }
    /**
     * Render a compact one-line summary
     */
    renderCompact(filePath, stats) {
        const action = stats.added > 0 && stats.removed > 0
            ? 'modify'
            : stats.added > 0
                ? 'create'
                : 'delete';
        return chalk.cyan(`  ${action}: ${filePath}`) +
            chalk.gray(` (+${stats.added} -${stats.removed})`);
    }
    /**
     * Render stats only
     */
    renderStats(stats) {
        return chalk.green(`+${stats.added}`) + ' ' + chalk.red(`-${stats.removed}`);
    }
}
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Format a diff for terminal with default options
 */
export function formatDiff(path, diff, stats) {
    const preview = new DiffPreview();
    return preview.render(path, diff, stats);
}
/**
 * Format a compact diff summary
 */
export function formatDiffSummary(path, stats) {
    const preview = new DiffPreview();
    return preview.renderCompact(path, stats);
}
/**
 * Colorize diff for inline display
 */
export function colorizeDiff(diff) {
    return diff
        .split('\n')
        .map(line => {
        if (line.startsWith('@@'))
            return chalk.cyan(line);
        if (line.startsWith('+') && !line.startsWith('+++'))
            return chalk.green(line);
        if (line.startsWith('-') && !line.startsWith('---'))
            return chalk.red(line);
        if (line.startsWith('---') || line.startsWith('+++'))
            return chalk.bold(line);
        return chalk.gray(line);
    })
        .join('\n');
}
/**
 * Parse hunk header to get line numbers
 */
export function parseHunkHeader(header) {
    const match = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match)
        return null;
    return {
        oldStart: parseInt(match[1], 10),
        oldCount: parseInt(match[2] ?? '1', 10),
        newStart: parseInt(match[3], 10),
        newCount: parseInt(match[4] ?? '1', 10)
    };
}
