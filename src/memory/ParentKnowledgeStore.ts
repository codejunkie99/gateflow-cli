/**
 * KnowledgeStore Facade
 * Re-export KnowledgeStore API and related types/constants.
 */

export { KnowledgeStore } from "./knowledge-store/KnowledgeStore.js";
export {
  getKnowledgeStore,
  
  
} from "./knowledge-store/factory.js";

// Re-export types/constants for compatibility
export type {
  
  KnowledgeItem,
  KnowledgeQuery,
  
  
  KnowledgeStoreConfig,
  
} from "./knowledge-types.js";
;
