/**
 * Theme System
 * Color themes for the terminal UI
 */

import chalk, { ChalkInstance } from 'chalk';

// ============================================================================
// Types
// ============================================================================

export type ThemeType = 'dark' | 'light';

export interface ThemeColors {
    // Primary UI colors
    primary: ChalkInstance;
    secondary: ChalkInstance;
    accent: ChalkInstance;

    // Status colors
    success: ChalkInstance;
    error: ChalkInstance;
    warning: ChalkInstance;
    info: ChalkInstance;

    // Text colors
    text: ChalkInstance;
    textMuted: ChalkInstance;
    textBold: ChalkInstance;

    // UI element colors
    border: ChalkInstance;
    spinner: ChalkInstance;
    prompt: ChalkInstance;
    selection: ChalkInstance;

    // Diff colors
    diffAdd: ChalkInstance;
    diffRemove: ChalkInstance;
    diffContext: ChalkInstance;
}

export interface Theme {
    name: string;
    type: ThemeType;
    colors: ThemeColors;
}

// ============================================================================
// Theme Definitions
// ============================================================================

const defaultTheme: Theme = {
    name: 'default',
    type: 'dark',
    colors: {
        primary: chalk.blue,
        secondary: chalk.cyan,
        accent: chalk.magenta,

        success: chalk.green,
        error: chalk.red,
        warning: chalk.yellow,
        info: chalk.blue,

        text: chalk.white,
        textMuted: chalk.gray,
        textBold: chalk.white.bold,

        border: chalk.blue,
        spinner: chalk.cyan,
        prompt: chalk.blue,
        selection: chalk.bgBlue.white,

        diffAdd: chalk.green,
        diffRemove: chalk.red,
        diffContext: chalk.gray
    }
};

const lightTheme: Theme = {
    name: 'light',
    type: 'light',
    colors: {
        primary: chalk.blue,
        secondary: chalk.blueBright,
        accent: chalk.magentaBright,

        success: chalk.green,
        error: chalk.red,
        warning: chalk.yellow,
        info: chalk.blue,

        text: chalk.black,
        textMuted: chalk.gray,
        textBold: chalk.black.bold,

        border: chalk.blueBright,
        spinner: chalk.blue,
        prompt: chalk.blueBright,
        selection: chalk.bgBlueBright.black,

        diffAdd: chalk.green,
        diffRemove: chalk.red,
        diffContext: chalk.gray
    }
};

const draculaTheme: Theme = {
    name: 'dracula',
    type: 'dark',
    colors: {
        primary: chalk.hex('#bd93f9'),      // Purple
        secondary: chalk.hex('#8be9fd'),     // Cyan
        accent: chalk.hex('#ff79c6'),        // Pink

        success: chalk.hex('#50fa7b'),       // Green
        error: chalk.hex('#ff5555'),         // Red
        warning: chalk.hex('#f1fa8c'),       // Yellow
        info: chalk.hex('#8be9fd'),          // Cyan

        text: chalk.hex('#f8f8f2'),          // Foreground
        textMuted: chalk.hex('#6272a4'),     // Comment
        textBold: chalk.hex('#f8f8f2').bold,

        border: chalk.hex('#bd93f9'),        // Purple
        spinner: chalk.hex('#ff79c6'),       // Pink
        prompt: chalk.hex('#50fa7b'),        // Green
        selection: chalk.bgHex('#44475a').hex('#f8f8f2'),

        diffAdd: chalk.hex('#50fa7b'),
        diffRemove: chalk.hex('#ff5555'),
        diffContext: chalk.hex('#6272a4')
    }
};

// ============================================================================
// Theme Registry
// ============================================================================

const themes: Map<string, Theme> = new Map([
    ['default', defaultTheme],
    ['light', lightTheme],
    ['dracula', draculaTheme]
]);

let currentTheme: Theme = defaultTheme;

// ============================================================================
// Theme API
// ============================================================================

/**
 * Get all available themes
 */
export function getAvailableThemes(): Array<{ name: string; type: ThemeType }> {
    return Array.from(themes.values()).map(t => ({
        name: t.name,
        type: t.type
    }));
}

/**
 * Get a theme by name
 */
export function getTheme(name: string): Theme | undefined {
    return themes.get(name);
}

/**
 * Get the current active theme
 */
export function getCurrentTheme(): Theme {
    return currentTheme;
}

/**
 * Set the current active theme
 */
export function setCurrentTheme(name: string): boolean {
    const theme = themes.get(name);
    if (theme) {
        currentTheme = theme;
        return true;
    }
    return false;
}

/**
 * Get current theme colors (shorthand)
 */
export function colors(): ThemeColors {
    return currentTheme.colors;
}

/**
 * Register a custom theme
 */
export function registerTheme(theme: Theme): void {
    themes.set(theme.name, theme);
}

// ============================================================================
// Theme-aware chalk wrappers
// ============================================================================

export const themed = {
    // Primary colors
    primary: (text: string) => currentTheme.colors.primary(text),
    secondary: (text: string) => currentTheme.colors.secondary(text),
    accent: (text: string) => currentTheme.colors.accent(text),

    // Status
    success: (text: string) => currentTheme.colors.success(text),
    error: (text: string) => currentTheme.colors.error(text),
    warning: (text: string) => currentTheme.colors.warning(text),
    info: (text: string) => currentTheme.colors.info(text),

    // Text
    text: (text: string) => currentTheme.colors.text(text),
    muted: (text: string) => currentTheme.colors.textMuted(text),
    bold: (text: string) => currentTheme.colors.textBold(text),

    // UI
    border: (text: string) => currentTheme.colors.border(text),
    prompt: (text: string) => currentTheme.colors.prompt(text),
    selection: (text: string) => currentTheme.colors.selection(text),

    // Diff
    diffAdd: (text: string) => currentTheme.colors.diffAdd(text),
    diffRemove: (text: string) => currentTheme.colors.diffRemove(text),
    diffContext: (text: string) => currentTheme.colors.diffContext(text)
};
