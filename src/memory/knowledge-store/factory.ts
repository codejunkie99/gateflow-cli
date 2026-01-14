/**
 * KnowledgeStore Factory & Singleton Management
 * @module knowledge-store/factory
 *
 * Provides controlled access to KnowledgeStore instances:
 *
 * - `createKnowledgeStore()` - Create a new instance (for testing or multiple projects)
 * - `setGlobalKnowledgeStore()` - Register the app-wide singleton
 * - `getKnowledgeStore()` - Retrieve the singleton (returns null if not set)
 *
 * ## Usage Pattern
 * ```typescript
 * // During app initialization
 * const store = createKnowledgeStore(projectRoot, eventBus);
 * await store.load();
 * setGlobalKnowledgeStore(store);
 *
 * // Elsewhere in the app
 * const store = getKnowledgeStore();
 * if (store) {
 *     const results = store.search({ query: 'reset handling' });
 * }
 * ```
 *
 * The singleton pattern allows components to access knowledge without
 * explicit dependency injection, while still supporting testing scenarios
 * where isolated instances are needed.
 */

import type { EventBus } from '../../events/index.js';
import type { KnowledgeStoreConfig } from '../knowledge-types.js';
import { KnowledgeStore } from './KnowledgeStore.js';

/** Global singleton instance - null until explicitly set */
let globalStore: KnowledgeStore | null = null;

/**
 * Get the global KnowledgeStore singleton.
 * @returns The singleton instance, or null if not yet initialized
 */
export function getKnowledgeStore(): KnowledgeStore | null {
    return globalStore;
}

/**
 * Create a new KnowledgeStore instance.
 * Use this for testing or when managing multiple project stores.
 *
 * @param projectRoot - Absolute path to project root (used to derive project ID)
 * @param bus - EventBus for emitting knowledge events
 * @param config - Optional configuration overrides
 */
export function createKnowledgeStore(
    projectRoot: string,
    bus: EventBus,
    config?: Partial<KnowledgeStoreConfig>
): KnowledgeStore {
    return new KnowledgeStore(projectRoot, bus, config);
}

/**
 * Set the global KnowledgeStore singleton.
 * Call this once during app initialization after loading the store.
 *
 * @param store - The initialized KnowledgeStore instance
 */
export function setGlobalKnowledgeStore(store: KnowledgeStore): void {
    globalStore = store;
}

