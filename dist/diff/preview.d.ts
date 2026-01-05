/**
 * Diff Preview
 * Terminal rendering for diff previews
 */
import type { DiffStats } from './engine.js';
export interface DiffPreviewOptions {
    maxLines?: number;
    showLineNumbers?: boolean;
    contextLines?: number;
    colorize?: boolean;
    boxed?: boolean;
}
export declare class DiffPreview {
    private options;
    constructor(options?: DiffPreviewOptions);
    /**
     * Render a unified diff for terminal display
     */
    render(path: string, diff: string, stats: DiffStats): string;
    /**
     * Render just the diff content (no box/header)
     */
    renderDiffContent(diff: string): string[];
    /**
     * Render a single diff line with coloring
     */
    private renderLine;
    /**
     * Render boxed header
     */
    private renderBoxTop;
    /**
     * Render boxed footer
     */
    private renderBoxBottom;
    /**
     * Render simple header (no box)
     */
    private renderHeader;
    /**
     * Render action prompt
     */
    private renderPrompt;
    /**
     * Render a compact one-line summary
     */
    renderCompact(filePath: string, stats: DiffStats): string;
    /**
     * Render stats only
     */
    renderStats(stats: DiffStats): string;
}
/**
 * Format a diff for terminal with default options
 */
export declare function formatDiff(path: string, diff: string, stats: DiffStats): string;
/**
 * Format a compact diff summary
 */
export declare function formatDiffSummary(path: string, stats: DiffStats): string;
/**
 * Colorize diff for inline display
 */
export declare function colorizeDiff(diff: string): string;
/**
 * Parse hunk header to get line numbers
 */
export declare function parseHunkHeader(header: string): {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
} | null;
