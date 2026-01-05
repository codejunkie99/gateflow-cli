/**
 * CLI Renderer
 * Renders agent events to the terminal with colors and formatting
 */
import type { AgentStreamEvent } from './agents/index.js';
/**
 * Render a stream event to the terminal
 */
export declare function renderEvent(event: AgentStreamEvent): void;
/**
 * Clear the current line (for spinners, etc.)
 */
export declare function clearLine(): void;
/**
 * Show a spinner with a message
 */
export declare function showSpinner(message: string): NodeJS.Timeout;
/**
 * Stop a spinner
 */
export declare function stopSpinner(interval: NodeJS.Timeout, finalMessage?: string): void;
