/**
 * Terminal Renderer
 * Event-driven terminal output with token buffering
 */
import type { EventBus } from '../events/index.js';
export interface RendererOptions {
    /** Enable colors (default: true) */
    colors?: boolean;
    /** Enable unicode characters (default: true) */
    unicode?: boolean;
    /** Token buffer flush interval in ms (default: 16) */
    bufferInterval?: number;
    /** Token buffer size before flush (default: 100) */
    bufferSize?: number;
    /** Show verbose output (default: false) */
    verbose?: boolean;
    /** Show timestamps (default: false) */
    timestamps?: boolean;
    /** JSON output mode (default: false) */
    jsonMode?: boolean;
}
export declare class TerminalRenderer {
    private bus;
    private options;
    private spinner;
    private tokenBuffer;
    private bufferTimer;
    private isStreaming;
    private currentPhase;
    private pendingApproval;
    private diffPreview;
    private startTime;
    constructor(bus: EventBus, options?: RendererOptions);
    /**
     * Start listening to events
     */
    start(): void;
    /**
     * Stop renderer and cleanup
     */
    stop(): void;
    private handleEvent;
    private handleToken;
    private handleTokenDone;
    private flushBuffer;
    private handleStatus;
    private stopSpinner;
    private getPhaseIcon;
    private getPhaseColor;
    private handleToolCall;
    private handleToolResult;
    private handleDiffPreview;
    private handleApprovalRequest;
    /**
     * Process user approval input
     */
    processApprovalInput(input: string): boolean;
    /**
     * Check if waiting for approval
     */
    isWaitingForApproval(): boolean;
    private handleError;
    private handleFinal;
    private handleIndexUpdate;
    private handleFileChange;
    private handleSimStage;
    private handleSimProgress;
    private handleThought;
    private handleAgentStart;
    private handleAgentComplete;
    private handleDelegation;
    private getAgentColor;
    private handleJsonMode;
    private formatDuration;
    private makeProgressBar;
}
/**
 * Create and start a renderer for the given event bus
 */
export declare function createRenderer(bus: EventBus, options?: RendererOptions): TerminalRenderer;
