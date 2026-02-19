/**
 * Centralized Input Manager
 * 
 * Manages ALL interactive prompt interactions to prevent conflicts between:
 * - Main REPL loop
 * - Agent ask_user tool
 * - Approval prompts
 * - Tool setup prompts
 * 
 * Key design:
 * - Single prompt path via Ink PromptController
 * - Queue-based prompt handling to prevent overlapping prompts
 * - Integrates with renderer pause/resume callbacks during input
 */

import chalk from 'chalk';
import type { EventBus } from '../events/index.js';
import { getPromptController, type LinePromptOptions } from './prompt-controller.js';

type ApprovalScope = 'once' | 'session' | 'all';

interface InputManagerOptions {
    /** Whether interactive prompt UI is available (TTY + non-JSON mode). */
    interactive?: boolean;
}

interface ApprovalResult {
    approved: boolean;
    scope: ApprovalScope;
}

interface PromptOptions {
    /** Question to display */
    question: string;
    /** Optional choices to show */
    choices?: string[];
    /** Default answer if user just presses enter */
    defaultAnswer?: string;
    /** Whether this is an approval prompt (Y/N/A/S) */
    isApproval?: boolean;
    /** Optional diff to display before prompt */
    diff?: string;
    /** Render a boxed input (Ink only) */
    useBox?: boolean;
}

export class InputManager {
    private sessionApprovals = new Set<string>();
    private approveAll = false;
    private onPromptStart?: () => void;
    private onPromptEnd?: () => void;
    private isPrompting = false;
    private interactive = process.stdout.isTTY && process.stdin.isTTY;

    constructor(private bus?: EventBus, options?: InputManagerOptions) {
        this.interactive = options?.interactive ?? this.interactive;
    }

    /**
     * Initialize the input manager
     * Call this once at startup
     */
    initialize(): void {
        // Ensure singleton prompt controller exists.
        getPromptController();
    }

    /**
     * Update runtime context for the manager (used when singleton already exists).
     */
    configure(bus?: EventBus, options?: InputManagerOptions): void {
        if (bus) {
            this.bus = bus;
        }
        if (options?.interactive !== undefined) {
            this.interactive = options.interactive;
        }
    }

    /**
     * Throw if interactive prompting is unavailable.
     */
    private assertInteractive(): void {
        if (this.interactive) return;
        throw new Error(
            'Interactive input requested, but no interactive TTY UI is available. ' +
            'Run this command in a terminal without --json.'
        );
    }

    /**
     * Set callbacks for prompt lifecycle
     * Used by renderer to pause/resume spinner
     */
    setPromptCallbacks(onStart: () => void, onEnd: () => void): void {
        this.onPromptStart = onStart;
        this.onPromptEnd = onEnd;
    }

    /**
     * Prompt the user for input
     * Returns a promise that resolves with the user's answer
     */
    async prompt(options: PromptOptions): Promise<string> {
        this.assertInteractive();
        this.onPromptStart?.();
        this.isPrompting = true;
        try {
            const controller = getPromptController();
            const answer = await controller.requestLine(options as LinePromptOptions);
            const result = answer.trim() || options.defaultAnswer || '';
            return result;
        } finally {
            this.isPrompting = false;
            this.onPromptEnd?.();
        }
    }

    /**
     * Request approval from user
     * Handles session/all scope caching
     */
    async requestApproval(
        action: string,
        details: string,
        options?: { diff?: string }
    ): Promise<ApprovalResult> {
        // Check cached approvals
        if (this.approveAll || this.sessionApprovals.has(action)) {
            return { approved: true, scope: 'session' };
        }

        const answer = await this.prompt({
            question: `${chalk.yellow.bold('Approval Required')}\n   ${action}: ${details}`,
            isApproval: true,
            diff: options?.diff
        });

        const key = answer.toLowerCase().trim();
        
        switch (key) {
            case 'y':
            case 'yes':
                return { approved: true, scope: 'once' };
            case 'a':
            case 'all':
                this.sessionApprovals.add(action);
                return { approved: true, scope: 'session' };
            case 'n':
            case 'no':
            case 's':
            case 'skip':
            default:
                return { approved: false, scope: 'once' };
        }
    }

    /**
     * Ask user a question with optional choices
     */
    async askUser(
        question: string,
        choices?: string[],
        defaultAnswer?: string
    ): Promise<string> {
        return this.prompt({
            question,
            choices,
            defaultAnswer
        });
    }

    /**
     * Simple yes/no question
     */
    async confirm(question: string, defaultYes = true): Promise<boolean> {
        const hint = defaultYes ? '[Y/n]' : '[y/N]';
        const defaultText = defaultYes ? 'yes' : 'no';
        const answer = await this.prompt({
            question: `${question} ${chalk.gray(hint)} ${chalk.gray(`(default: ${defaultText})`)}`,
            defaultAnswer: defaultYes ? 'y' : 'n'
        });
        
        const key = answer.toLowerCase().trim();
        if (key === '' || key === '\n') {
            return defaultYes;
        }
        return key === 'y' || key === 'yes';
    }

    /**
     * Get raw line input (for REPL)
     * Uses Ink box prompt in interactive mode.
     */
    async getLine(promptStr: string = '> '): Promise<string> {
        this.assertInteractive();
        this.onPromptStart?.();
        this.isPrompting = true;
        try {
            const controller = getPromptController();
            const answer = await controller.requestLine({ question: promptStr, useBox: true });
            return answer || '';
        } finally {
            this.isPrompting = false;
            this.onPromptEnd?.();
        }
    }

    /**
     * Check if currently prompting
     */
    isWaitingForInput(): boolean {
        return this.isPrompting;
    }

    /**
     * Set approve all mode
     */
    setApproveAll(value: boolean): void {
        this.approveAll = value;
    }

    /**
     * Check if action is pre-approved
     */
    isApproved(action: string): boolean {
        return this.approveAll || this.sessionApprovals.has(action);
    }

    /**
     * Clear session approvals
     */
    clearApprovals(): void {
        this.sessionApprovals.clear();
        this.approveAll = false;
    }

    /**
     * Close the input manager
     */
    close(): void {
        this.isPrompting = false;
    }
}

// Singleton instance
let instance: InputManager | null = null;

/**
 * Get the global InputManager instance
 */
export function getInputManager(): InputManager {
    if (!instance) {
        instance = new InputManager();
    }
    return instance;
}

/**
 * Initialize the global InputManager
 */
export function initInputManager(bus?: EventBus, options?: InputManagerOptions): InputManager {
    if (!instance) {
        instance = new InputManager(bus, options);
    } else {
        instance.configure(bus, options);
    }
    instance.initialize();
    return instance;
}
