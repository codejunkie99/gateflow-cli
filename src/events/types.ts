/**
 * GateFlow Event Protocol
 * Unified typed event bus for renderer decoupling
 */

// ============================================================================
// Core Event Types
// ============================================================================

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
export type StatusPhase =
    | 'thinking'
    | 'tool'
    | 'verifying'
    | 'fixing'
    | 'indexing'
    | 'watching'
    | 'setup'
    | 'downloading'
    | 'extracting'
    | 'executing'
    | 'memory';

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
    clocks: Array<{ signal: string; frequency: number }>;
    anomalies: Array<{ type: string; signal: string; time: bigint }>;
    coverage: { percentage: number };
    summary: string;
}

/**
 * Timeout events - distinct from errors for clearer UI feedback
 */
export interface TimeoutEvent {
    type: 'timeout';
    taskId: string;
    agentName: string;
    timeoutMs: number;
    durationMs: number;
    message: string;
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

/**
 * Log events - arbitrary informational lines for the UI.
 * Prefer this over console.log so output stays within the renderer.
 */
export interface LogEvent {
    type: 'log';
    message: string;
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
export type ThoughtCategory =
    | 'analyzing'
    | 'planning'
    | 'decomposing'
    | 'coordinating'
    | 'generating'
    | 'validating'
    | 'fixing';

export interface ThoughtEvent {
    type: 'thought';
    stepNumber: number;
    category: ThoughtCategory;
    thought: string;
    confidence?: number;
    data?: Record<string, unknown>;
    timestamp: number;
}

/**
 * Setup stage events - for tool installation progress
 */
export type SetupStage =
    | 'checking'      // Checking prerequisites
    | 'downloading'   // Downloading files
    | 'extracting'    // Extracting archive
    | 'cloning'       // Git clone
    | 'configuring'   // CMake configure
    | 'building'      // CMake build (long)
    | 'linking'       // Final linking
    | 'verifying'     // Running --version
    | 'saving';       // Saving to .env

export interface SetupStageEvent {
    type: 'setup_stage';
    tool: 'verible' | 'slang';
    stage: SetupStage;
    status: 'started' | 'completed' | 'failed';
    message?: string;
}

/**
 * Prerequisite installation stage events
 */
export type PrereqInstallStage =
    | 'detecting'     // Detecting package managers
    | 'checking'      // Checking prerequisite status
    | 'installing'    // Running install command
    | 'verifying'     // Verifying installation
    | 'manual';       // Manual installation guidance

export type Prerequisite = 'git' | 'cmake' | 'compiler';

export interface PrereqInstallStageEvent {
    type: 'prereq_install_stage';
    prerequisite: Prerequisite;
    stage: PrereqInstallStage;
    status: 'started' | 'completed' | 'failed';
    message?: string;
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
    result?: unknown;
    durationMs: number;
    outputTokens?: number;
    inputTokens?: number;
    // AI SDK 6: Extended usage tracking
    reasoningTokens?: number;
    textTokens?: number;
    cachedTokens?: number;
    finishReason?: string;
    rawUsage?: unknown;
}

export interface DelegationEvent {
    type: 'delegation';
    from: string;
    to: string;
    taskType: string;
    taskData: Record<string, unknown>;
}

/**
 * Tool progress events - detailed tool execution lifecycle
 */
export interface ToolProgressEvent {
    type: 'tool_progress';
    tool: string;
    state: 'started' | 'executing' | 'completed' | 'failed';
    metadata?: {
        file?: string;
        lineCount?: number;
    };
}

/**
 * Thinking/reasoning stream events - real-time LLM reasoning
 */
export interface ThinkingStreamEvent {
    type: 'thinking_stream';
    text: string;
    isComplete: boolean;
}

// ============================================================================
// Union Type
// ============================================================================

export type UiEvent =
    // Streaming
    | TokenEvent
    | TokenDoneEvent
    // Status
    | StatusEvent
    // Tools
    | ToolCallEvent
    | ToolResultEvent
    // Diff/Approval
    | DiffPreviewEvent
    | ApprovalRequestEvent
    | ApprovalResponseEvent
    // Watch
    | FileChangeEvent
    | WatchStatusEvent
    // Simulation
    | SimStageEvent
    | SimProgressEvent
    // Waveform
    | WaveformLoadedEvent
    | WaveformAnalysisEvent
    // Setup
    | SetupStageEvent
    | PrereqInstallStageEvent
    // Timeout
    | TimeoutEvent
    // Completion
    | ErrorEvent
    | LogEvent
    | FinalEvent
    // Memory
    | IndexUpdateEvent
    | MemorySavedEvent
    // Thinking/Agent events
    | ThoughtEvent
    | AgentStartEvent
    | AgentCompleteEvent
    | DelegationEvent
    // Tool progress and thinking stream
    | ToolProgressEvent
    | ThinkingStreamEvent;

// ============================================================================
// Event Type Guards
// ============================================================================

export function isTokenEvent(event: UiEvent): event is TokenEvent {
    return event.type === 'token';
}

export function isStatusEvent(event: UiEvent): event is StatusEvent {
    return event.type === 'status';
}

export function isToolEvent(event: UiEvent): event is ToolCallEvent | ToolResultEvent {
    return event.type === 'tool_call' || event.type === 'tool_result';
}

export function isApprovalEvent(event: UiEvent): event is ApprovalRequestEvent | ApprovalResponseEvent {
    return event.type === 'approval_request' || event.type === 'approval_response';
}

export function isErrorEvent(event: UiEvent): event is ErrorEvent {
    return event.type === 'error';
}

export function isTimeoutEvent(event: UiEvent): event is TimeoutEvent {
    return event.type === 'timeout';
}

export function isWaveformEvent(event: UiEvent): event is WaveformLoadedEvent | WaveformAnalysisEvent {
    return event.type === 'waveform_loaded' || event.type === 'waveform_analysis';
}

export function isSimEvent(event: UiEvent): event is SimStageEvent | SimProgressEvent {
    return event.type === 'sim_stage' || event.type === 'sim_progress';
}

export function isSetupEvent(event: UiEvent): event is SetupStageEvent {
    return event.type === 'setup_stage';
}

export function isPrereqInstallEvent(event: UiEvent): event is PrereqInstallStageEvent {
    return event.type === 'prereq_install_stage';
}

// ============================================================================
// Exit Codes
// ============================================================================

export const ExitCodes = {
    SUCCESS: 0,
    LINT_FAILED: 1,
    USER_REJECTED: 2,
    TOOL_ERROR: 3,
    CONFIG_ERROR: 4,
    NETWORK_ERROR: 5,
    TIMEOUT: 6,
    WATCH_ERROR: 7,
} as const;

export type ExitCode = typeof ExitCodes[keyof typeof ExitCodes];
