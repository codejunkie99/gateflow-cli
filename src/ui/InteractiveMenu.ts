/**
 * Interactive Menu Component
 *
 * A terminal-based dropdown menu using raw readline with keypress events.
 * Supports two-section menus (included vs supported providers) with
 * arrow key navigation and Enter to select.
 *
 * Key features:
 * - Works within existing REPL loop
 * - Integrates with InputManager callbacks for spinner coordination
 * - Supports grouped items with headers
 * - Escape to cancel
 */

import readline from 'readline';
import chalk from 'chalk';
import { getPromptController } from './prompt-controller.js';

// ============================================================================
// Types
// ============================================================================

export interface MenuItem<T = unknown> {
    /** Display label for the item */
    label: string;
    /** Value returned when selected */
    value: T;
    /** Optional description shown to the right */
    description?: string;
    /** Whether this item is disabled (shown but not selectable) */
    disabled?: boolean;
    /** Optional hint shown when item is selected */
    hint?: string;
}

export interface MenuSection<T = unknown> {
    /** Section header text */
    title: string;
    /** Items in this section */
    items: MenuItem<T>[];
    /** Optional color for the section header */
    headerColor?: (text: string) => string;
}

export interface InteractiveMenuOptions {
    /** Title shown above the menu */
    title?: string;
    /** Prompt shown at the bottom */
    prompt?: string;
    /** Whether to show help text */
    showHelp?: boolean;
    /** Maximum visible items before scrolling */
    maxVisibleItems?: number;
    /** Enable search/filter functionality */
    searchable?: boolean;
    /** Placeholder text for search input */
    searchPlaceholder?: string;
    /** Callback when prompt starts (for spinner coordination) */
    onPromptStart?: () => void;
    /** Callback when prompt ends */
    onPromptEnd?: () => void;
}

export interface MenuResult<T> {
    /** Whether user made a selection (vs cancelled) */
    selected: boolean;
    /** The selected value, if any */
    value?: T;
    /** The selected item, if any */
    item?: MenuItem<T>;
    /** Section index of selected item */
    sectionIndex?: number;
}

// ============================================================================
// Interactive Menu Implementation
// ============================================================================

export class InteractiveMenu<T = unknown> {
    // INVARIANT: this.currentIndex always indexes into this.filteredItems.
    // - When searching: filteredItems contains only matching items (no headers)
    // - When not searching: filteredItems === flatItems (set at lines 101, 115, 144)
    //   and flatItems is built in the same order as section iteration.
    //
    // We use two render paths because:
    // 1. Search mode: flat list without section headers (simpler, faster)
    // 2. Normal mode: iterate sections to render headers between item groups
    //
    // Both paths use this.currentIndex to determine selection, which works
    // because findNextSelectableIndexInFiltered() always operates on filteredItems

    private sections: MenuSection<T>[];
    private options: InteractiveMenuOptions;
    private currentIndex = 0;
    private flatItems: { item: MenuItem<T>; sectionIndex: number }[] = [];
    private filteredItems: { item: MenuItem<T>; sectionIndex: number }[] = [];
    private scrollOffset = 0;
    private rl: readline.Interface | null = null;
    private searchQuery = '';

    constructor(sections: MenuSection<T>[], options: InteractiveMenuOptions = {}) {
        this.sections = sections;
        this.options = {
            showHelp: true,
            maxVisibleItems: 10,
            searchable: false,
            searchPlaceholder: 'Type to search...',
            ...options
        };

        // Flatten items for navigation
        this.flattenItems();
        // Initialize filtered items
        this.filteredItems = [...this.flatItems];
    }

    private flattenItems(): void {
        this.flatItems = [];
        this.sections.forEach((section, sectionIndex) => {
            section.items.forEach(item => {
                this.flatItems.push({ item, sectionIndex });
            });
        });
    }

    private filterItems(): void {
        if (!this.searchQuery) {
            this.filteredItems = [...this.flatItems];
        } else {
            const query = this.searchQuery.toLowerCase();
            this.filteredItems = this.flatItems.filter(({ item }) => {
                const labelMatch = item.label.toLowerCase().includes(query);
                const descMatch = item.description?.toLowerCase().includes(query) || false;
                return labelMatch || descMatch;
            });
        }
        // Reset selection to first item
        this.currentIndex = this.findNextSelectableIndexInFiltered(0, 1);
        if (this.currentIndex === -1) {
            this.currentIndex = 0;
        }
        this.scrollOffset = 0;
    }

    /**
     * Show the interactive menu and wait for user selection
     */
    async show(): Promise<MenuResult<T>> {
        return new Promise((resolve) => {
            if (this.flatItems.length === 0) {
                resolve({ selected: false });
                return;
            }

            // Reset search state
            this.searchQuery = '';
            this.filteredItems = [...this.flatItems];
            this.scrollOffset = 0;

            // Move to first selectable item
            this.currentIndex = this.findNextSelectableIndexInFiltered(0, 1);
            if (this.currentIndex === -1) {
                this.currentIndex = 0;
            }

            // Notify prompt start
            this.options.onPromptStart?.();

            // Setup readline for raw mode
            if (process.stdin.isTTY) {
                readline.emitKeypressEvents(process.stdin);
                process.stdin.setRawMode(true);
            }

            // Ensure stdin is flowing
            if (process.stdin.isPaused()) {
                process.stdin.resume();
            }

            // Hide cursor during menu display (show if searchable)
            if (!this.options.searchable) {
                process.stdout.write('\x1B[?25l');
            }

            // Initial render
            this.render();

            // Handle keypress events
            const handleKeypress = (_str: string | undefined, key: readline.Key) => {
                if (!key) return;

                switch (key.name) {
                    case 'up':
                        this.moveSelection(-1);
                        this.render();
                        break;

                    case 'down':
                        this.moveSelection(1);
                        this.render();
                        break;

                    case 'return':
                        cleanup();
                        const selected = this.filteredItems[this.currentIndex];
                        if (selected && !selected.item.disabled) {
                            resolve({
                                selected: true,
                                value: selected.item.value,
                                item: selected.item,
                                sectionIndex: selected.sectionIndex
                            });
                        } else {
                            resolve({ selected: false });
                        }
                        break;

                    case 'escape':
                        // If searching, clear search first
                        if (this.options.searchable && this.searchQuery) {
                            this.searchQuery = '';
                            this.filterItems();
                            this.render();
                        } else {
                            cleanup();
                            resolve({ selected: false });
                        }
                        break;

                    case 'backspace':
                        // Handle backspace for search
                        if (this.options.searchable && this.searchQuery.length > 0) {
                            this.searchQuery = this.searchQuery.slice(0, -1);
                            this.filterItems();
                            this.render();
                        }
                        break;

                    case 'c':
                        // Handle Ctrl+C
                        if (key.ctrl) {
                            cleanup();
                            resolve({ selected: false });
                        } else if (this.options.searchable && !key.ctrl && !key.meta) {
                            // Regular 'c' for search
                            this.searchQuery += 'c';
                            this.filterItems();
                            this.render();
                        }
                        break;

                    default:
                        // Handle alphanumeric input for search
                        if (this.options.searchable && key.sequence && !key.ctrl && !key.meta) {
                            // Only add printable characters
                            const char = key.sequence;
                            if (char.length === 1 && char.charCodeAt(0) >= 32 && char.charCodeAt(0) < 127) {
                                this.searchQuery += char;
                                this.filterItems();
                                this.render();
                            }
                        }
                        break;
                }
            };

            const cleanup = () => {
                process.stdin.removeListener('keypress', handleKeypress);
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                // Show cursor again
                process.stdout.write('\x1B[?25h');
                // Clear the menu display
                this.clearMenu();
                // Notify prompt end
                this.options.onPromptEnd?.();
            };

            process.stdin.on('keypress', handleKeypress);
        });
    }

    private moveSelection(direction: number): void {
        const newIndex = this.findNextSelectableIndexInFiltered(this.currentIndex + direction, direction);
        if (newIndex !== -1) {
            this.currentIndex = newIndex;
            this.updateScrollOffset();
        }
    }

    private findNextSelectableIndex(startIndex: number, direction: number): number {
        let index = startIndex;
        const maxIterations = this.flatItems.length;
        let iterations = 0;

        while (iterations < maxIterations) {
            if (index < 0) {
                index = this.flatItems.length - 1;
            } else if (index >= this.flatItems.length) {
                index = 0;
            }

            const item = this.flatItems[index];
            if (item && !item.item.disabled) {
                return index;
            }

            index += direction;
            iterations++;
        }

        return -1;
    }

    private findNextSelectableIndexInFiltered(startIndex: number, direction: number): number {
        if (this.filteredItems.length === 0) return -1;

        let index = startIndex;
        const maxIterations = this.filteredItems.length;
        let iterations = 0;

        while (iterations < maxIterations) {
            if (index < 0) {
                index = this.filteredItems.length - 1;
            } else if (index >= this.filteredItems.length) {
                index = 0;
            }

            const item = this.filteredItems[index];
            if (item && !item.item.disabled) {
                return index;
            }

            index += direction;
            iterations++;
        }

        return -1;
    }

    private updateScrollOffset(): void {
        const maxVisible = this.options.maxVisibleItems!;
        const totalItems = this.filteredItems.length;

        if (totalItems <= maxVisible) {
            this.scrollOffset = 0;
            return;
        }

        // Ensure current item is visible
        if (this.currentIndex < this.scrollOffset) {
            this.scrollOffset = this.currentIndex;
        } else if (this.currentIndex >= this.scrollOffset + maxVisible) {
            this.scrollOffset = this.currentIndex - maxVisible + 1;
        }
    }

    private render(): void {
        const lines: string[] = [];
        const maxVisible = this.options.maxVisibleItems!;

        // Title
        if (this.options.title) {
            lines.push('');
            lines.push(chalk.bold.cyan(this.options.title));
            lines.push('');
        }

        // Search input (when searchable)
        if (this.options.searchable) {
            const searchDisplay = this.searchQuery
                ? chalk.white(this.searchQuery) + chalk.dim('|')
                : chalk.dim(this.options.searchPlaceholder || 'Type to search...');
            lines.push(`  ${chalk.cyan('⌕')} ${searchDisplay}`);
            lines.push('');
        }

        // Handle empty filtered results
        if (this.filteredItems.length === 0) {
            lines.push(chalk.dim('  No matching models found'));
            lines.push('');
            if (this.options.showHelp) {
                lines.push(chalk.dim('  Press Escape to clear search'));
            }
            this.clearMenu();
            console.log(lines.join('\n'));
            (this as any)._lastLineCount = lines.length;
            return;
        }

        // Build visible items - use filteredItems when searching, sections otherwise
        let visibleCount = 0;

        if (this.options.searchable && this.searchQuery) {
            // When searching, render flat filtered list without section headers
            for (let i = this.scrollOffset; i < this.filteredItems.length && visibleCount < maxVisible; i++) {
                const { item } = this.filteredItems[i];
                const isSelected = i === this.currentIndex;
                const line = this.renderItem(item, isSelected);
                lines.push(line);
                visibleCount++;
            }
        } else {
            // Normal render with section headers
            let itemIndex = 0;
            let lastRenderedSection = -1;

            for (const section of this.sections) {
                const sectionStartIndex = itemIndex;
                const sectionEndIndex = sectionStartIndex + section.items.length;

                // Check if any items from this section are visible
                const sectionHasVisibleItems =
                    sectionEndIndex > this.scrollOffset &&
                    sectionStartIndex < this.scrollOffset + maxVisible;

                if (sectionHasVisibleItems && lastRenderedSection !== this.sections.indexOf(section)) {
                    // Add section header if we're at or past this section
                    if (itemIndex <= this.scrollOffset + maxVisible && itemIndex >= this.scrollOffset) {
                        const headerColor = section.headerColor || chalk.dim;
                        lines.push(headerColor(`  ${section.title}`));
                        lastRenderedSection = this.sections.indexOf(section);
                    }
                }

                for (const menuItem of section.items) {
                    if (itemIndex >= this.scrollOffset && visibleCount < maxVisible) {
                        const isSelected = itemIndex === this.currentIndex;
                        const line = this.renderItem(menuItem, isSelected);
                        lines.push(line);
                        visibleCount++;
                    }
                    itemIndex++;
                }
            }
        }

        // Scroll indicators
        const totalItems = this.options.searchable && this.searchQuery
            ? this.filteredItems.length
            : this.flatItems.length;
        const insertPos = this.options.title ? (this.options.searchable ? 5 : 3) : (this.options.searchable ? 2 : 0);

        if (this.scrollOffset > 0) {
            lines.splice(insertPos, 0, chalk.dim('    ↑ more above'));
        }
        if (this.scrollOffset + maxVisible < totalItems) {
            lines.push(chalk.dim('    ↓ more below'));
        }

        // Help text
        if (this.options.showHelp) {
            lines.push('');
            if (this.options.searchable) {
                lines.push(chalk.dim('  ↑↓ navigate • Enter select • Esc clear/cancel • Type to search'));
            } else {
                lines.push(chalk.dim('  Use arrow keys to navigate, Enter to select, Escape to cancel'));
            }
        }

        // Hint for selected item
        const selectedItem = this.filteredItems[this.currentIndex];
        if (selectedItem?.item.hint) {
            lines.push('');
            lines.push(chalk.yellow(`  ${selectedItem.item.hint}`));
        }

        // Clear previous render and output new
        this.clearMenu();
        console.log(lines.join('\n'));

        // Store line count for clearing
        (this as any)._lastLineCount = lines.length;
    }

    private renderItem(item: MenuItem<T>, isSelected: boolean): string {
        const pointer = isSelected ? chalk.cyan('>') : ' ';
        const bullet = isSelected ? chalk.cyan('*') : ' ';

        let label = item.label;
        if (item.disabled) {
            label = chalk.dim(label);
        } else if (isSelected) {
            label = chalk.bold.white(label);
        }

        let line = `  ${pointer}${bullet} ${label}`;

        if (item.description) {
            const desc = item.disabled ? chalk.dim(item.description) : chalk.gray(item.description);
            line += `  ${desc}`;
        }

        return line;
    }

    private clearMenu(): void {
        const lineCount = (this as any)._lastLineCount || 0;
        if (lineCount > 0) {
            // Move cursor up and clear lines
            process.stdout.write(`\x1B[${lineCount}A`);
            for (let i = 0; i < lineCount; i++) {
                process.stdout.write('\x1B[2K\x1B[1B');
            }
            process.stdout.write(`\x1B[${lineCount}A`);
        }
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Show a simple selection menu
 */
export async function showMenu<T>(
    items: MenuItem<T>[],
    options?: InteractiveMenuOptions
): Promise<MenuResult<T>> {
    const controller = getPromptController();
    options?.onPromptStart?.();
    try {
        return await controller.requestMenu<T>({
            sections: [{ title: '', items }],
            options
        });
    } finally {
        options?.onPromptEnd?.();
    }
}

/**
 * Show a sectioned selection menu
 */
export async function showSectionedMenu<T>(
    sections: MenuSection<T>[],
    options?: InteractiveMenuOptions
): Promise<MenuResult<T>> {
    const controller = getPromptController();
    options?.onPromptStart?.();
    try {
        return await controller.requestMenu<T>({ sections, options });
    } finally {
        options?.onPromptEnd?.();
    }
}

// ============================================================================
// Text Input Prompt
// ============================================================================

export interface TextInputOptions {
    /** Prompt message */
    prompt: string;
    /** Placeholder text (shown in dim) */
    placeholder?: string;
    /** Whether to mask input (for passwords/API keys) */
    mask?: boolean;
    /** Validation function */
    validate?: (value: string) => string | true;
    /** Callback when prompt starts */
    onPromptStart?: () => void;
    /** Callback when prompt ends */
    onPromptEnd?: () => void;
}

export interface TextInputResult {
    /** Whether user entered a value (vs cancelled) */
    submitted: boolean;
    /** The entered value */
    value?: string;
}

/**
 * Show a text input prompt
 */
export async function showTextInput(options: TextInputOptions): Promise<TextInputResult> {
    options.onPromptStart?.();
    try {
        const controller = getPromptController();
        return await controller.requestText(options);
    } finally {
        options.onPromptEnd?.();
    }
}
