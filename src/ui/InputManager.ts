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

export type ApprovalScope = 'once' | 'session' | 'all';

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

    constructor(private bus?: EventBus) {}

    /**
     * Initialize the input manager
     * Call this once at startup
     */
    initialize(): void {
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
     */
    async getLine(promptStr: string = '> '): Promise<string> {
        return this.prompt({ question: promptStr });
    }

    /**
     * Process the prompt queue
     */
    private async processQueue(): Promise<void> {
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

            // Ask the question
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
export function initInputManager(bus?: EventBus): InputManager {
    if (!instance) {
        instance = new InputManager(bus);
    }
    instance.initialize();
    return instance;
}
