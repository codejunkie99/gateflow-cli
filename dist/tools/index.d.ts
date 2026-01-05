/**
 * Tools Module
 * File operations, editing, and utilities
 */
export * from './file.js';
export * from './edit.js';
export * from './approval.js';
import { FileTools } from './file.js';
import { EditTools } from './edit.js';
import type { EventBus } from '../events/bus.js';
import type { PolicyEngine } from '../policy/engine.js';
/**
 * Create all tool instances with shared dependencies
 */
export declare function createTools(bus: EventBus, policy: PolicyEngine, projectRoot?: string): {
    file: FileTools;
    edit: EditTools;
};
export type Tools = ReturnType<typeof createTools>;
