/**
 * Blessed-based Chatbox Input
 *
 * A resizable terminal input box using the blessed library.
 * Provides a bordered textarea with configurable dimensions.
 */

import blessed from 'blessed';
import chalk from 'chalk';
import readline from 'readline';
import stringWidth from 'string-width';

export interface ChatboxOptions {
    /** Width of the chatbox (number or percentage string like '80%') */
    width?: number | string;
    /** Height of the chatbox (number of lines) */
    height?: number;
    /** Border style */
    border?: 'line' | 'bg' | 'none';
    /** Label shown in the border */
    label?: string;
    /** Prompt prefix shown inside the box */
    prompt?: string;
    /** Border color */
    borderColor?: string;
    /** Text color */
    textColor?: string;
    /** Background color */
    bgColor?: string;
    /** Position from bottom of screen */
    bottom?: number;
}

export interface ChatboxResult {
    submitted: boolean;
    value?: string;
}

const DEFAULT_OPTIONS: Required<ChatboxOptions> = {
    width: '100%',
    height: 3,
    border: 'line',
    label: ' Input ',
    prompt: '',
    borderColor: 'cyan',
    textColor: 'white',
    bgColor: 'black',
    bottom: 0
};

export class BlessedChatbox {
    private screen: blessed.Widgets.Screen | null = null;
    private inputBox: blessed.Widgets.TextareaElement | null = null;
    private options: Required<ChatboxOptions>;
    private isActive = false;

    constructor(options?: ChatboxOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * Update chatbox options (for resizing)
     */
    updateOptions(options: Partial<ChatboxOptions>): void {
        this.options = { ...this.options, ...options };

        if (this.inputBox) {
            if (options.width !== undefined) {
                this.inputBox.width = options.width;
            }
            if (options.height !== undefined) {
                this.inputBox.height = options.height;
            }
            if (options.label !== undefined) {
                this.inputBox.setLabel(options.label);
            }
            this.screen?.render();
        }
    }

    /**
     * Get current dimensions
     */
    getDimensions(): { width: number | string; height: number } {
        return {
            width: this.options.width,
            height: this.options.height
        };
    }

    /**
     * Show the chatbox and wait for input
     */
    async getInput(initialValue?: string): Promise<ChatboxResult> {
        return new Promise((resolve) => {
            // Create screen if not exists
            if (!this.screen) {
                this.screen = blessed.screen({
                    smartCSR: true,
                    title: 'GateFlow',
                    fullUnicode: true
                });
            }

            // Create the input box
            this.inputBox = blessed.textarea({
                parent: this.screen,
                bottom: this.options.bottom,
                left: 0,
                width: this.options.width,
                height: this.options.height,
                label: this.options.label,
                border: this.options.border === 'none' ? undefined : {
                    type: this.options.border
                },
                style: {
                    fg: this.options.textColor,
                    bg: this.options.bgColor,
                    border: {
                        fg: this.options.borderColor
                    },
                    label: {
                        fg: this.options.borderColor
                    }
                },
                inputOnFocus: true,
                keys: true,
                vi: false,
                mouse: true
            });

            // Set initial value if provided
            if (initialValue) {
                this.inputBox.setValue(initialValue);
            }

            this.isActive = true;

            // Handle submit (Enter key)
            this.inputBox.key(['enter'], () => {
                if (!this.isActive) return;

                const value = this.inputBox?.getValue()?.trim() || '';
                this.cleanup();
                resolve({ submitted: true, value });
            });

            // Handle cancel (Escape key)
            this.inputBox.key(['escape'], () => {
                if (!this.isActive) return;

                this.cleanup();
                resolve({ submitted: false });
            });

            // Handle Ctrl+C
            this.inputBox.key(['C-c'], () => {
                if (!this.isActive) return;

                this.cleanup();
                resolve({ submitted: false });
            });

            // Focus the input
            this.inputBox.focus();
            this.screen.render();
        });
    }

    /**
     * Clean up blessed elements
     */
    private cleanup(): void {
        this.isActive = false;

        if (this.inputBox) {
            this.inputBox.destroy();
            this.inputBox = null;
        }

        if (this.screen) {
            this.screen.destroy();
            this.screen = null;
        }
    }

    /**
     * Force close the chatbox
     */
    close(): void {
        this.cleanup();
    }
}

/**
 * Resizable chatbox that integrates with existing terminal output
 *
 * Keyboard shortcuts:
 * - Ctrl+Up/Down: Resize height
 * - Enter: Submit input
 * - Escape: Cancel
 */
export class InlineChatbox {
    private options: Required<ChatboxOptions>;
    private currentHeight: number;
    /** Track whether cursor is positioned inside the rendered box */
    private cursorInBox: boolean = false;

    constructor(options?: ChatboxOptions) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.currentHeight = this.options.height;
    }

    /**
     * Update options
     */
    updateOptions(options: Partial<ChatboxOptions>): void {
        this.options = { ...this.options, ...options };
        if (options.height !== undefined) {
            this.currentHeight = options.height;
        }
    }

    /**
     * Get terminal width
     */
    private getTerminalWidth(): number {
        return process.stdout.columns || 80;
    }

    /**
     * Get current dimensions
     */
    getDimensions(): { width: number; height: number } {
        return { width: this.getTerminalWidth(), height: this.currentHeight };
    }

    /**
     * Resize the chatbox height
     */
    resize(heightDelta: number): void {
        const termHeight = process.stdout.rows || 24;
        this.currentHeight = Math.max(3, Math.min(termHeight - 5, this.currentHeight + heightDelta));
    }

    /**
     * Draw the box frame
     */
    private drawFrame(inputText: string = ''): string[] {
        const lines: string[] = [];
        // Use terminal width with Math.max guard to prevent negative width edge cases
        const w = Math.max(10, this.getTerminalWidth());
        const h = this.currentHeight;

        // Top border with label (no size hint)
        const label = this.options.label;
        const labelStr = label ? ` ${label} ` : '';
        const lineLength = Math.max(0, w - 2 - labelStr.length);
        const leftLine = Math.floor(lineLength / 2);
        const rightLine = lineLength - leftLine;

        lines.push(
            chalk.cyan('┌' + '─'.repeat(leftLine) + labelStr + '─'.repeat(rightLine) + '┐')
        );

        // Middle lines (input area)
        const innerWidth = w - 4; // Account for "│ " and " │"
        const prompt = this.options.prompt || '> ';

        for (let i = 0; i < h - 2; i++) {
            if (i === 0) {
                // First line has the prompt and input
                const content = prompt + inputText;
                const padding = Math.max(0, innerWidth - content.length);
                lines.push(chalk.cyan('│ ') + content + ' '.repeat(padding) + chalk.cyan(' │'));
            } else {
                // Empty lines
                lines.push(chalk.cyan('│') + ' '.repeat(w - 2) + chalk.cyan('│'));
            }
        }

        // Bottom border with help
        const help = ' Enter:send  Esc:cancel ';
        const bottomLineLen = Math.max(0, w - 2 - help.length);
        const bottomLeft = Math.floor(bottomLineLen / 2);
        const bottomRight = bottomLineLen - bottomLeft;

        lines.push(
            chalk.cyan('└' + '─'.repeat(bottomLeft) + chalk.dim(help) + '─'.repeat(bottomRight) + '┘')
        );

        return lines;
    }

    /**
     * Clear the drawn box
     */
    private clearBox(lineCount: number): void {
        if (!this.cursorInBox) {
            // Cursor not in expected position - just clear from current position
            for (let i = 0; i < lineCount + 1; i++) {
                process.stdout.write('\x1B[2K'); // Clear line
                if (i < lineCount) {
                    process.stdout.write('\x1B[1A'); // Move up
                }
            }
            return;
        }

        const h = lineCount;
        // Cursor is inside the box (h-1 lines from bottom), move to bottom first
        process.stdout.write(`\x1B[${h - 1}B`); // Move down to bottom
        process.stdout.write('\x1B[0G'); // Move to start of line

        // Move cursor up and clear each line
        for (let i = 0; i < lineCount; i++) {
            process.stdout.write('\x1B[2K'); // Clear line
            process.stdout.write('\x1B[1A'); // Move up
        }
        process.stdout.write('\x1B[2K'); // Clear the top line too
        this.cursorInBox = false;
    }

    /**
     * Render the box and position cursor inside
     */
    private render(inputText: string = ''): number {
        // Calculate available width for input
        // Math.max guard prevents negative width edge cases
        const w = Math.max(10, process.stdout.columns || 80);
        const innerWidth = w - 4; // Account for "│ " and " │"
        const prompt = this.options.prompt || '> ';
        // Use stringWidth for accurate visual length (handles ANSI, emoji, CJK chars)
        const visualPromptLength = stringWidth(prompt);
        const maxInputWidth = innerWidth - visualPromptLength;

        // Truncate input by visual width, not character count
        let truncatedInput = inputText;
        let isTruncated = false;
        while (stringWidth(truncatedInput) > maxInputWidth && truncatedInput.length > 0) {
            truncatedInput = truncatedInput.slice(0, -1);
            isTruncated = true;
        }

        // Show truncation indicator if input was cut off
        const displayInput = isTruncated && truncatedInput.length > 0
            ? truncatedInput.slice(0, -1) + '…'
            : truncatedInput;

        const lines = this.drawFrame(displayInput);
        console.log(lines.join('\n'));

        // Position cursor inside the box (on the input line)
        const h = this.currentHeight;
        // Use stringWidth for accurate cursor positioning with multi-byte chars
        const cursorX = 2 + visualPromptLength + stringWidth(displayInput) + 1; // +1 for the space after "│"
        const cursorY = h - 1; // lines to move up from current position
        process.stdout.write(`\x1B[${cursorY}A`); // Move up
        process.stdout.write(`\x1B[${cursorX}G`); // Move to column

        this.cursorInBox = true;
        return lines.length;
    }

    /**
     * Render a visual box around the input area and get input
     * Supports height resizing with Ctrl+Up/Down keys
     */
    async getInput(): Promise<ChatboxResult> {
        return new Promise((resolve) => {
            let inputText = '';
            let lineCount = 0;

            // Initial render
            lineCount = this.render(inputText);

            // Setup raw mode for keypress detection
            if (process.stdin.isTTY) {
                readline.emitKeypressEvents(process.stdin);
                process.stdin.setRawMode(true);
            }

            if (process.stdin.isPaused()) {
                process.stdin.resume();
            }

            const redraw = () => {
                this.clearBox(lineCount);
                lineCount = this.render(inputText);
            };

            const cleanup = () => {
                process.stdin.removeListener('keypress', handleKeypress);
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
            };

            const handleKeypress = (str: string | undefined, key: { name: string; ctrl?: boolean; shift?: boolean; sequence?: string }) => {
                if (!key) return;

                // Resize height with Ctrl+Arrow
                if (key.ctrl) {
                    switch (key.name) {
                        case 'up':
                            this.resize(-1);
                            redraw();
                            return;
                        case 'down':
                            this.resize(1);
                            redraw();
                            return;
                        case 'c':
                            // Ctrl+C - cancel
                            cleanup();
                            this.clearBox(lineCount);
                            resolve({ submitted: false });
                            return;
                    }
                }

                switch (key.name) {
                    case 'return':
                        cleanup();
                        this.clearBox(lineCount);
                        resolve({ submitted: true, value: inputText.trim() });
                        break;

                    case 'escape':
                        cleanup();
                        this.clearBox(lineCount);
                        resolve({ submitted: false });
                        break;

                    case 'backspace':
                        if (inputText.length > 0) {
                            inputText = inputText.slice(0, -1);
                            redraw();
                        }
                        break;

                    default:
                        // Add printable characters
                        if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
                            inputText += str;
                            redraw();
                        }
                        break;
                }
            };

            process.stdin.on('keypress', handleKeypress);
        });
    }
}

// Factory functions
export function createChatbox(options?: ChatboxOptions): BlessedChatbox {
    return new BlessedChatbox(options);
}

export function createInlineChatbox(options?: ChatboxOptions): InlineChatbox {
    return new InlineChatbox(options);
}
