/**
 * Edit Tools
 * Line-based and search/replace edits with diff preview
 */
import type { EventBus } from '../events/bus.js';
import type { PolicyEngine } from '../policy/engine.js';
export interface EditLinesResult {
    success: boolean;
    path: string;
    diff?: string;
    stats?: {
        added: number;
        removed: number;
    };
    error?: string;
    applied?: boolean;
}
export interface SearchReplaceResult {
    success: boolean;
    path: string;
    replacements: number;
    diff?: string;
    stats?: {
        added: number;
        removed: number;
    };
    error?: string;
    applied?: boolean;
}
export interface EditOperation {
    startLine: number;
    endLine: number;
    newContent: string;
}
export declare class EditTools {
    private bus;
    private policy;
    private projectRoot;
    constructor(bus: EventBus, policy: PolicyEngine, projectRoot?: string);
    private resolvePath;
    editLines(filePath: string, edits: EditOperation[], options?: {
        skipApproval?: boolean;
        dryRun?: boolean;
    }): Promise<EditLinesResult>;
    searchReplace(filePath: string, search: string, replace: string, options?: {
        all?: boolean;
        isRegex?: boolean;
        caseSensitive?: boolean;
        skipApproval?: boolean;
        dryRun?: boolean;
    }): Promise<SearchReplaceResult>;
    insertLines(filePath: string, afterLine: number, content: string, options?: {
        skipApproval?: boolean;
        dryRun?: boolean;
    }): Promise<EditLinesResult>;
    deleteLines(filePath: string, startLine: number, endLine: number, options?: {
        skipApproval?: boolean;
        dryRun?: boolean;
    }): Promise<EditLinesResult>;
    replaceContent(filePath: string, newContent: string, options?: {
        skipApproval?: boolean;
        dryRun?: boolean;
    }): Promise<EditLinesResult>;
    private calculateDiffStats;
    /**
     * Generate a unified diff between two strings
     */
    generateDiff(filePath: string, original: string, modified: string): string;
}
