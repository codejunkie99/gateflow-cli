// src/memory/knowledge-service/types.ts

import type { Declaration, Instance, HierarchyNode, FileDependency, DeclarationKind } from '../../indexer/types/index.js';
import type { KnowledgeItem, KnowledgeType } from '../knowledge-types.js';

/**
 * Types that stay in KnowledgeStore (learned/user knowledge).
 * This matches KnowledgeType from knowledge-types.ts.
 */
export type LearnedKnowledgeType =
  | 'code_pattern'
  | 'lint_fix'
  | 'test_pattern'
  | 'style_preference'
  | 'workflow'
  | 'debug_solution'
  | 'tool_usage';

/**
 * Types that come from indexer (structural facts) - NO LONGER in KnowledgeStore.
 */
export type StructuralKnowledgeType =
  | 'module_info'
  | 'dependency'
  | 'project_context';

/**
 * Unified query for both structural and learned knowledge.
 */
export interface UnifiedKnowledgeQuery {
  // Text query (BM25 for learned, pattern match for structural)
  query?: string;

  // Structural filters
  declarationKinds?: DeclarationKind[];
  moduleName?: string;
  filePath?: string;
  // Optional structural categories (module_info, dependency, project_context)
  structuralTypes?: StructuralKnowledgeType[];

  // Learned knowledge filters
  knowledgeTypes?: LearnedKnowledgeType[];
  tags?: string[];

  // Learned knowledge scope controls (passed to KnowledgeStore)
  defineContextId?: string;
  compileOrderId?: string;
  relaxedScope?: boolean;

  // Result configuration
  maxResults?: number;
  minConfidence?: number;

  // Source selection
  sources?: ('structural' | 'learned')[];
}

/**
 * Unified result representing both structural and learned knowledge.
 */
export interface UnifiedKnowledgeResult {
  id: string;
  title: string;
  content: string;
  relevance: number;
  matchReason: string;
  source: 'structural' | 'learned';

  // Present when source === 'structural'
  declaration?: Declaration;
  instance?: Instance;
  hierarchyNode?: HierarchyNode;
  dependency?: FileDependency;

  // Present when source === 'learned'
  knowledgeItem?: KnowledgeItem;
}

/**
 * The unified KnowledgeService interface.
 */
export interface IKnowledgeService {
  // Unified search
  search(query: UnifiedKnowledgeQuery): UnifiedKnowledgeResult[];

  // Context retrieval for AI injection
  getContextForAI(
    query?: string,
    filePath?: string,
    moduleName?: string,
    maxTokens?: number
  ): string;
  getContextForAI(
    query?: UnifiedKnowledgeQuery,
    maxTokens?: number
  ): string;

  // Structural queries (pass-through to indexer)
  findModule(name: string): Declaration | undefined;
  findModulesByPattern(pattern: string): Declaration[];
  getModulePorts(moduleName: string): Declaration[];
  getModuleSignals(moduleName: string): Declaration[];
  getModuleInstances(moduleName: string): Instance[];
  getHierarchy(topModule?: string): HierarchyNode[];
  getDependencies(moduleName?: string): FileDependency[];

  // Learned knowledge operations
  addLearnedKnowledge(item: Omit<KnowledgeItem, 'id' | 'fingerprint' | 'created' | 'updated' | 'useCount' | 'lastAccessed'>): KnowledgeItem;
  removeLearnedKnowledge(id: string): boolean;

  // Lifecycle
  save(): Promise<void>;
}
