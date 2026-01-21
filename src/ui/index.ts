/**
 * UI Module
 * Terminal rendering and user interaction
 *
 * Exports:
 * - TerminalRenderer: Main event-driven renderer with spinner, tool tree, token tracking
 * - ToolTree: Hierarchical tool call display
 * - DiffDisplay: Syntax-highlighted diff rendering with box decoration
 * - BlockRenderer: Warp-style block rendering for grouped output
 * - InputManager: User input handling
 * - InteractiveMenu: Arrow-key navigable selection menus
 */

// Core renderer
export * from './renderer.js';

// Enhanced UI components
export * from './tool-tree.js';
export * from './diff-display.js';
export * from './block-renderer.js';

// Input management
export * from './InputManager.js';

// Interactive menus
export * from './InteractiveMenu.js';

// Blessed chatbox
export * from './BlessedChatbox.js';
