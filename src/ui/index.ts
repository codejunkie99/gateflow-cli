/**
 * UI Module
 * Terminal rendering and user interaction
 *
 * Exports:
 * - Renderer: Event-driven renderer (Ink by default)
 * - ToolTree: Hierarchical tool call display
 * - DiffDisplay: Syntax-highlighted diff rendering with box decoration
 * - BlockRenderer: Warp-style block rendering for grouped output
 * - InputManager: User input handling
 * - InteractiveMenu: Arrow-key navigable selection menus
 */

// Core renderer (Ink by default)
export * from './ink/renderer.js';
export type { Renderer, RendererOptions } from './ink/renderer.js';

// Enhanced UI components
export * from './tool-tree.js';
export * from './diff-display.js';
export * from './block-renderer.js';

// Input management
export * from './InputManager.js';
export * from './prompt-controller.js';

// Interactive menus
export * from './InteractiveMenu.js';
