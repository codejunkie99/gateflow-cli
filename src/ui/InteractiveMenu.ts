/**
 * Interactive Menu APIs
 *
 * Ink handles menu and text prompt rendering via PromptController.
 * This module keeps a stable API for command-layer callers.
 */

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
    /** Optional color for section header in legacy renderers */
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
// Interactive Menu Class
// ============================================================================

/**
 * Backward-compatible class wrapper.
 * Rendering/input handling are delegated to Ink via PromptController.
 */
class InteractiveMenu<T = unknown> {
    private sections: MenuSection<T>[];
    private options: InteractiveMenuOptions;

    constructor(sections: MenuSection<T>[], options: InteractiveMenuOptions = {}) {
        this.sections = sections;
        this.options = {
            showHelp: true,
            maxVisibleItems: 10,
            searchable: false,
            searchPlaceholder: 'Type to search...',
            ...options
        };
    }

    async show(): Promise<MenuResult<T>> {
        return showSectionedMenu(this.sections, this.options);
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Show a simple selection menu.
 */
async function showMenu<T>(
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
 * Show a sectioned selection menu.
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
 * Show a text input prompt.
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
