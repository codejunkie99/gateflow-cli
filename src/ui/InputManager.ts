/**
 * Centralized Input Manager
 * 
 * Manages ALL stdin/readline interactions to prevent conflicts between:
 * - Main REPL loop
 * - Agent ask_user tool
 * - Approval prompts
 * - Tool setup prompts
 * 
 * Key design:
 * - Single readline instance, reused across all prompts
 * - Queue-based prompt handling to prevent overlapping prompts
 * - Properly pauses/resumes stdin around prompts
 * - Integrates with TerminalRenderer to pause spinner during input
 */

import readline from 'readline';
import chalk from 'chalk';
import type { EventBus } from '../events/index.js';
import { InlineChatbox, type ChatboxOptions } from './BlessedChatbox.js';
import { getPromptController, type LinePromptOptions } from './prompt-controller.js';

export type ApprovalScope = 'once' | 'session' | 'all';

export interface InputManagerOptions {
    /** Use chatbox UI instead of simple readline */
    useChatbox?: boolean;
    /** Chatbox configuration */
    chatboxOptions?: ChatboxOptions;
    /** Use Ink prompt controller instead of readline/chatbox */
    useInk?: boolean;
}

export interface ApprovalResult {
    approved: boolean;
    scope: ApprovalScope;
}

export interface PromptOptions {
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
}

interface QueuedPrompt {
    options: PromptOptions;
    resolve: (answer: string) => void;
    reject: (error: Error) => void;
}

export class InputManager {
    private rl: readline.Interface | null = null;
    private promptQueue: QueuedPrompt[] = [];
    private isPrompting = false;
    private sessionApprovals = new Set<string>();
    private approveAll = false;
    private onPromptStart?: () => void;
    private onPromptEnd?: () => void;
    private useInk = false;

    // Chatbox support
    private useChatbox: boolean = false;
    private chatbox: InlineChatbox | null = null;
    private chatboxOptions: ChatboxOptions = {};

    constructor(private bus?: EventBus, options?: InputManagerOptions) {
        this.useInk = options?.useInk ?? false;
        if (options?.useChatbox) {
            this.useChatbox = true;
            this.chatboxOptions = options.chatboxOptions || {};
            this.chatbox = new InlineChatbox(this.chatboxOptions);
        }
    }

    /**
     * Enable or disable chatbox mode
     */
    setChatboxMode(enabled: boolean, options?: ChatboxOptions): void {
        this.useChatbox = enabled;
        if (enabled) {
            this.chatboxOptions = options || this.chatboxOptions;
            this.chatbox = new InlineChatbox(this.chatboxOptions);
        } else {
            this.chatbox = null;
        }
    }

    /**
     * Update chatbox dimensions
     */
    setChatboxSize(width?: number | string, height?: number): void {
        if (this.chatbox) {
            this.chatbox.updateOptions({ width, height });
        }
        if (width !== undefined) this.chatboxOptions.width = width;
        if (height !== undefined) this.chatboxOptions.height = height;
    }

    /**
     * Get current chatbox settings
     */
    getChatboxSettings(): { enabled: boolean; options: ChatboxOptions } {
        return {
            enabled: this.useChatbox,
            options: { ...this.chatboxOptions }
        };
    }

    /**
     * Initialize the input manager
     * Call this once at startup
     */
    initialize(): void {
        if (this.useInk) return;
        if (this.rl) return;

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        // Handle close event (Ctrl+D)
        this.rl.on('close', () => {
            this.rl = null;
        });
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
        if (this.useInk) {
            this.onPromptStart?.();
            try {
                const controller = getPromptController();
                const answer = await controller.requestLine(options as LinePromptOptions);
                const result = answer.trim() || options.defaultAnswer || '';
                return result;
            } finally {
                this.onPromptEnd?.();
            }
        }

        return new Promise((resolve, reject) => {
            this.promptQueue.push({ options, resolve, reject });
            this.processQueue();
        });
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
     * Uses chatbox if enabled, otherwise standard readline
     */
    async getLine(promptStr: string = '> '): Promise<string> {
        if (this.useInk) {
            this.onPromptStart?.();
            try {
                const controller = getPromptController();
                const answer = await controller.requestLine({ question: promptStr });
                return answer || '';
            } finally {
                this.onPromptEnd?.();
            }
        }

        // Use chatbox mode if enabled
        if (this.useChatbox && this.chatbox) {
            this.onPromptStart?.();
            try {
                const result = await this.chatbox.getInput();
                return result.submitted ? (result.value || '') : '';
            } finally {
                this.onPromptEnd?.();
            }
        }

        return this.prompt({ question: promptStr });
    }

    /**
     * Process the prompt queue
     */
    private async processQueue(): Promise<void> {
        if (this.useInk) return;
        if (this.isPrompting || this.promptQueue.length === 0) {
            return;
        }

        this.isPrompting = true;
        const { options, resolve, reject } = this.promptQueue.shift()!;

        try {
            // Ensure readline is initialized
            if (!this.rl) {
                this.initialize();
            }

            // Notify renderer to pause spinner
            this.onPromptStart?.();

            // Ensure stdin is flowing
            if (process.stdin.isPaused()) {
                process.stdin.resume();
            }

            // Build prompt string
            let promptStr = '';

            if (options.diff) {
                promptStr += '\n' + options.diff + '\n';
            }

            promptStr += options.question;

            if (options.choices && options.choices.length > 0) {
                promptStr += '\n   ' + options.choices.map((c, i) =>
                    chalk.cyan(`[${i + 1}]`) + ' ' + c
                ).join('  ');
                promptStr += '\n';
            }

            if (options.isApproval) {
                promptStr += '\n' + chalk.gray('   [Y]es  [N]o  [A]ll  [S]kip: ');
            } else if (!promptStr.endsWith(' ')) {
                promptStr += ' ';
            }

            // Use chatbox for main prompts if enabled (but not for approvals/choices)
            if (this.useChatbox && this.chatbox && !options.isApproval && !options.choices) {
                // Show the question first
                if (promptStr.trim()) {
                    console.log(promptStr);
                }
                const result = await this.chatbox.getInput();
                const answer = result.submitted ? (result.value || '') : '';
                const finalResult = answer.trim() || options.defaultAnswer || '';
                resolve(finalResult);
                return;
            }

            // Standard readline input
            const answer = await new Promise<string>((res) => {
                this.rl!.question(promptStr, (input) => {
                    res(input);
                });
            });

            // Apply default if empty
            const result = answer.trim() || options.defaultAnswer || '';

            resolve(result);
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.isPrompting = false;

            // Notify renderer to resume spinner
            this.onPromptEnd?.();

            // Process next in queue
            this.processQueue();
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
        if (this.useInk) {
            this.promptQueue = [];
            this.isPrompting = false;
            return;
        }
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        this.promptQueue = [];
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
    }
    instance.initialize();
    return instance;
}

/**
 * Enable chatbox mode on the global InputManager
 */
export function enableChatbox(options?: ChatboxOptions): void {
    const mgr = getInputManager();
    mgr.setChatboxMode(true, options);
}

/**
 * Disable chatbox mode on the global InputManager
 */
export function disableChatbox(): void {
    const mgr = getInputManager();
    mgr.setChatboxMode(false);
}

/**
 * Set chatbox dimensions
 */
export function setChatboxSize(width?: number | string, height?: number): void {
    const mgr = getInputManager();
    mgr.setChatboxSize(width, height);
}
