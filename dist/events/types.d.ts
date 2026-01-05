/**
 * GateFlow Event Protocol
 * Unified typed event bus for renderer decoupling
 */
/**
 * Streaming events - text from LLM
 */
export interface TokenEvent {
    type: 'token';
    text: string;
}
export interface TokenDoneEvent {
    type: 'token_done';
}
/**
 * Status events - current phase
 */
export type StatusPhase = 'thinking' | 'tool' | 'verifying' | 'fixing' | 'indexing' | 'watching';
export interface StatusEvent {
    type: 'status';
    phase: StatusPhase;
    label: string;
}
/**
 * Tool lifecycle events
 */
export interface ToolCallEvent {
    type: 'tool_call';
    tool: string;
    argsSummary: string;
    args?: Record<string, unknown>;
}
export interface ToolResultEvent {
    type: 'tool_result';
    tool: string;
    ok: boolean;
    summary: string;
    duration?: number;
    result?: unknown;
}
/**
 * Diff and approval events
 */
export interface DiffPreviewEvent {
    type: 'diff_preview';
    path: string;
    unifiedDiff: string;
    stats: {
        added: number;
        removed: number;
    };
}
export interface ApprovalRequestEvent {
    type: 'approval_request';
    id: string;
    action: string;
    details: string;
    diff?: string;
    options?: string[];
}
export interface ApprovalResponseEvent {
    type: 'approval_response';
    id: string;
    approved: boolean;
    scope?: 'once' | 'session' | 'project';
}
/**
 * Watch mode events
 */
export interface FileChangeEvent {
    type: 'file_change';
    path: string;
    changeType: 'add' | 'change' | 'unlink';
}
export interface WatchStatusEvent {
    type: 'watch_status';
    watching: boolean;
    patterns: string[];
    fileCount: number;
}
/**
 * Simulation events
 */
export interface SimStageEvent {
    type: 'sim_stage';
    stage: 'analyze' | 'compile' | 'link' | 'simulate' | 'parse_vcd' | 'analyze_waveform';
    status: 'started' | 'completed' | 'failed';
    message?: string;
}
export interface SimProgressEvent {
    type: 'sim_progress';
    stage: string;
    percent: number;
    message: string;
}
/**
 * Waveform events
 */
export interface WaveformLoadedEvent {
    type: 'waveform_loaded';
    path: string;
    signalCount: number;
    timeRange: {
        start: bigint;
        end: bigint;
    };
}
export interface WaveformAnalysisEvent {
    type: 'waveform_analysis';
    clocks: Array<{
        signal: string;
        frequency: number;
    }>;
    anomalies: Array<{
        type: string;
        signal: string;
        time: bigint;
    }>;
    coverage: {
        percentage: number;
    };
    summary: string;
}
/**
 * Completion events
 */
export interface ErrorEvent {
    type: 'error';
    message: string;
    code?: number;
    recoverable?: boolean;
}
export interface FinalEvent {
    type: 'final';
    summary: string;
    filesModified: string[];
    exitCode: number;
}
/**
 * Memory/index events
 */
export interface IndexUpdateEvent {
    type: 'index_update';
    added: number;
    removed: number;
    modified: number;
}
export interface MemorySavedEvent {
    type: 'memory_saved';
    path: string;
    size: number;
}
/**
 * Thinking/Reasoning events (from ThinkingChain)
 */
export type ThoughtCategory = 'analyzing' | 'planning' | 'decomposing' | 'coordinating' | 'generating' | 'validating' | 'fixing';
export interface ThoughtEvent {
    type: 'thought';
    stepNumber: number;
    category: ThoughtCategory;
    thought: string;
    confidence?: number;
    data?: any;
    timestamp: number;
}
/**
 * Agent lifecycle events
 */
export interface AgentStartEvent {
    type: 'agent_start';
    agentName: string;
    task: string;
    estimatedDuration?: number;
}
export interface AgentCompleteEvent {
    type: 'agent_complete';
    agentName: string;
    success: boolean;
    result?: any;
    durationMs: number;
    outputTokens?: number;
    inputTokens?: number;
}
export interface DelegationEvent {
    type: 'delegation';
    from: string;
    to: string;
    taskType: string;
    taskData: any;
}
export type UiEvent = TokenEvent | TokenDoneEvent | StatusEvent | ToolCallEvent | ToolResultEvent | DiffPreviewEvent | ApprovalRequestEvent | ApprovalResponseEvent | FileChangeEvent | WatchStatusEvent | SimStageEvent | SimProgressEvent | WaveformLoadedEvent | WaveformAnalysisEvent | ErrorEvent | FinalEvent | IndexUpdateEvent | MemorySavedEvent | ThoughtEvent | AgentStartEvent | AgentCompleteEvent | DelegationEvent;
export declare function isTokenEvent(event: UiEvent): event is TokenEvent;
export declare function isStatusEvent(event: UiEvent): event is StatusEvent;
export declare function isToolEvent(event: UiEvent): event is ToolCallEvent | ToolResultEvent;
export declare function isApprovalEvent(event: UiEvent): event is ApprovalRequestEvent | ApprovalResponseEvent;
export declare function isErrorEvent(event: UiEvent): event is ErrorEvent;
export declare const ExitCodes: {
    readonly SUCCESS: 0;
    readonly LINT_FAILED: 1;
    readonly USER_REJECTED: 2;
    readonly TOOL_ERROR: 3;
    readonly CONFIG_ERROR: 4;
    readonly NETWORK_ERROR: 5;
    readonly TIMEOUT: 6;
    readonly WATCH_ERROR: 7;
};
export type ExitCode = typeof ExitCodes[keyof typeof ExitCodes];
