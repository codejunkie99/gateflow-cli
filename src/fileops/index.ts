/**
 * Tools Module
 * File operations, editing, and utilities
 */

export * from './file.js';
export * from './edit.js';
export * from './approval.js';

// Re-export for convenience
import { FileTools } from './file.js';
import { EditTools } from './edit.js';
import type { EventBus } from '../events/bus.js';
import type { PolicyEngine } from '../approval/engine.js';

/**
 * Create all tool instances with shared dependencies
 */
export function createTools(bus: EventBus, policy: PolicyEngine, projectRoot: string = process.cwd()) {
    return {
        file: new FileTools(bus, policy, projectRoot),
        edit: new EditTools(bus, policy, projectRoot),
    };
}

type Tools = ReturnType<typeof createTools>;

