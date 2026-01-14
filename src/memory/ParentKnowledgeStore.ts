/**
 * KnowledgeStore Facade
 * Re-export KnowledgeStore API and related types/constants.
 */

export { KnowledgeStore } from "./knowledge-store/KnowledgeStore.js";
export {
  getKnowledgeStore,
  createKnowledgeStore,
  setGlobalKnowledgeStore,
} from "./knowledge-store/factory.js";

// Re-export types/constants for compatibility
export type {
  KnowledgeIndex,
  KnowledgeItem,
  KnowledgeQuery,
  KnowledgeScope,
  KnowledgeSearchResult,
  KnowledgeStoreConfig,
  KnowledgeType,
} from "./knowledge-types.js";
export { DEFAULT_KNOWLEDGE_STORE_CONFIG } from "./knowledge-types.js";
