/**
 * CLI-local type definitions
 * These mirror the shared types for standalone CLI operation
 */
export interface FileChange {
    path: string;
    addedLines: number;
    removedLines: number;
    type: 'file' | 'folder';
}
export interface PipelineResult {
    files: {
        path: string;
        content: string;
        type: string;
    }[];
    simulation: {
        success: boolean;
        vcdFile?: string;
    };
}
export type RunStage = 'planning' | 'rtl' | 'lint' | 'sim' | 'verify' | 'fix';
export type { AgentStreamEvent, HumanInTheLoopHandler } from './agents/index.js';
export type LegacyAgentStreamEvent = {
    type: 'text';
    content: string;
} | {
    type: 'step_start';
    stepId: string;
    name: string;
} | {
    type: 'step_end';
    stepId: string;
} | {
    type: 'tool_start';
    toolName: string;
    input: string;
} | {
    type: 'tool_end';
    toolName: string;
    output: string;
} | {
    type: 'diff_start';
    filePath: string;
} | {
    type: 'diff_delta';
    content: string;
} | {
    type: 'diff_end';
    filePath: string;
} | {
    type: 'file_change';
    file: FileChange;
} | {
    type: 'pipeline_start';
} | {
    type: 'pipeline_complete';
    result: PipelineResult;
} | {
    type: 'error';
    message: string;
} | {
    kind: 'thought';
    text: string;
    category?: string;
    progress?: number;
    append?: boolean;
} | {
    kind: 'status';
    stage: RunStage;
    message: string;
} | {
    kind: 'answer_delta';
    text: string;
} | {
    kind: 'edit';
    file: string;
    op: 'create' | 'replace_range' | 'delete';
    text?: string;
    range?: any;
} | {
    kind: 'sim';
    summary: string;
    success: boolean;
    transcriptPath?: string;
} | {
    kind: 'error';
    message: string;
};
