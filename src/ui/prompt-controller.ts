/**
 * Prompt Controller
 *
 * Centralized async prompt queue for Ink UI.
 * Allows InputManager and menu/text helpers to request prompts
 * and lets the Ink UI resolve them.
 */

import type { MenuSection, MenuResult, InteractiveMenuOptions } from './InteractiveMenu.js';
import type { TextInputOptions, TextInputResult } from './InteractiveMenu.js';

export type PromptKind = 'line' | 'menu' | 'text';

export interface LinePromptOptions {
    question: string;
    choices?: string[];
    defaultAnswer?: string;
    isApproval?: boolean;
    diff?: string;
    useBox?: boolean;
}

export interface MenuPromptOptions<T = unknown> {
    sections: MenuSection<T>[];
    options?: InteractiveMenuOptions;
}

export interface TextPromptOptions extends TextInputOptions {}

export type PromptRequest =
    | {
        id: string;
        kind: 'line';
        payload: LinePromptOptions;
        resolve: (value: string) => void;
        reject: (err: Error) => void;
        cancelValue: string;
    }
    | {
        id: string;
        kind: 'menu';
        payload: MenuPromptOptions;
        resolve: (value: MenuResult<any>) => void;
        reject: (err: Error) => void;
        cancelValue: MenuResult<any>;
    }
    | {
        id: string;
        kind: 'text';
        payload: TextPromptOptions;
        resolve: (value: TextInputResult) => void;
        reject: (err: Error) => void;
        cancelValue: TextInputResult;
    };

export interface PromptState {
    current: PromptRequest | null;
    queueLength: number;
}

type Listener = () => void;

export class PromptController {
    private queue: PromptRequest[] = [];
    private current: PromptRequest | null = null;
    private listeners = new Set<Listener>();
    private idCounter = 0;

    getState(): PromptState {
        return {
            current: this.current,
            queueLength: this.queue.length
        };
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

    private nextId(): string {
        this.idCounter += 1;
        return `prompt-${this.idCounter}`;
    }

    private enqueue<T extends PromptRequest>(request: T): Promise<any> {
        return new Promise((resolve, reject) => {
            request.resolve = resolve as T['resolve'];
            request.reject = reject as T['reject'];
            this.queue.push(request);
            if (!this.current) {
                this.advance();
            } else {
                this.notify();
            }
        });
    }

    private advance(): void {
        this.current = this.queue.shift() || null;
        this.notify();
    }

    requestLine(options: LinePromptOptions): Promise<string> {
        return this.enqueue({
            id: this.nextId(),
            kind: 'line',
            payload: options,
            resolve: () => {},
            reject: () => {},
            cancelValue: ''
        });
    }

    requestMenu<T = unknown>(options: MenuPromptOptions<T>): Promise<MenuResult<T>> {
        return this.enqueue({
            id: this.nextId(),
            kind: 'menu',
            payload: options,
            resolve: () => {},
            reject: () => {},
            cancelValue: { selected: false }
        });
    }

    requestText(options: TextPromptOptions): Promise<TextInputResult> {
        return this.enqueue({
            id: this.nextId(),
            kind: 'text',
            payload: options,
            resolve: () => {},
            reject: () => {},
            cancelValue: { submitted: false }
        });
    }

    submit(result: string | MenuResult<any> | TextInputResult): void {
        if (!this.current) return;
        const current = this.current;
        this.current = null;
        try {
            current.resolve(result as never);
        } finally {
            this.advance();
        }
    }

    cancel(): void {
        if (!this.current) return;
        const current = this.current;
        this.current = null;
        try {
            current.resolve(current.cancelValue as never);
        } finally {
            this.advance();
        }
    }
}

let controller: PromptController | null = null;

export function initPromptController(): PromptController {
    if (!controller) {
        controller = new PromptController();
    }
    return controller;
}

export function getPromptController(): PromptController {
    return controller ?? initPromptController();
}
