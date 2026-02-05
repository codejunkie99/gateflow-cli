import type { ToolTree } from '../tool-tree.js';

export interface LogEntry {
    id: number;
    text: string;
}

export interface StatusState {
    phase: string;
    label: string;
    symbol?: string;
}

export interface TokenUsage {
    input: number;
    output: number;
    cached: number;
}

export interface InkState {
    logs: LogEntry[];
    stream: string;
    status: StatusState | null;
    tokens: TokenUsage;
    cost: number;
    toolCallCount: number;
    toolTree: ToolTree | null;
    pendingApproval: {
        id: string;
        action: string;
        details: string;
        diff?: string;
    } | null;
    inputPaused: boolean;
}

type Listener = () => void;

export class InkStore {
    private listeners = new Set<Listener>();
    private logId = 0;
    private state: InkState;
    private maxLogs = 500;

    constructor(initial: Partial<InkState> = {}) {
        this.state = {
        logs: [],
        stream: '',
        status: null,
        tokens: { input: 0, output: 0, cached: 0 },
        cost: 0,
        toolCallCount: 0,
        toolTree: null,
        pendingApproval: null,
        inputPaused: false,
        ...initial
    };
    }

    getState(): InkState {
        return this.state;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    setState(partial: Partial<InkState>): void {
        this.state = { ...this.state, ...partial };
        this.notify();
    }

    appendLog(text: string): void {
        // Keep logs line-based. Ink's <Text> can behave unexpectedly with embedded newlines.
        const nextLogs = [...this.state.logs];
        const lines = text.split('\n');
        for (const line of lines) {
            nextLogs.push({ id: ++this.logId, text: line });
        }
        if (nextLogs.length > this.maxLogs) {
            nextLogs.splice(0, nextLogs.length - this.maxLogs);
        }
        this.state = { ...this.state, logs: nextLogs };
        this.notify();
    }
}
