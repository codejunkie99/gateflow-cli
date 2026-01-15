// src/memory/knowledge-service/knowledge-service.ts

import type {
  Declaration,
  Instance,
  HierarchyNode,
  FileDependency,
  ResolvedProject,
} from '../../indexer/types/index.js';
import type { KnowledgeStore } from '../knowledge-store/KnowledgeStore.js';
import type { KnowledgeItem } from '../knowledge-types.js';
import { estimateTokens } from '../utils.js';
import { StructuralQueryProvider } from './structural-provider.js';
import { LearnedKnowledgeProvider } from './learned-provider.js';
import type {
  IKnowledgeService,
  UnifiedKnowledgeQuery,
  UnifiedKnowledgeResult,
} from './types.js';

/**
 * KnowledgeService - Unified access to both structural and learned knowledge.
 *
 * This service combines:
 * - Structural knowledge from the indexer (modules, ports, signals, hierarchy)
 * - Learned knowledge from KnowledgeStore (patterns, fixes, preferences)
 *
 * It provides a unified interface for searching across both sources and
 * building context for AI assistants.
 */
export class KnowledgeService implements IKnowledgeService {
  private structuralProvider: StructuralQueryProvider;
  private learnedProvider: LearnedKnowledgeProvider;

  constructor(
    projectGetter: () => ResolvedProject | null,
    knowledgeStore: KnowledgeStore
  ) {
    this.structuralProvider = new StructuralQueryProvider(projectGetter);
    this.learnedProvider = new LearnedKnowledgeProvider(knowledgeStore);
  }

  // ========================================================================
  // Unified Search
  // ========================================================================

  /**
   * Search across both structural and learned knowledge.
   *
   * @param query The unified query parameters
   * @returns Merged and sorted results from both sources
   */
  search(query: UnifiedKnowledgeQuery): UnifiedKnowledgeResult[] {
    const sources = query.sources ?? ['structural', 'learned'];
    const results: UnifiedKnowledgeResult[] = [];

    // Search structural knowledge if requested
    if (sources.includes('structural')) {
      const structuralResults = this.structuralProvider.searchDeclarations(query);
      results.push(...structuralResults);
    }

    // Search learned knowledge if requested
    if (sources.includes('learned')) {
      const learnedResults = this.learnedProvider.search(query);
      results.push(...learnedResults);
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    // Apply max results limit
    const maxResults = query.maxResults ?? 20;
    return results.slice(0, maxResults);
  }

  // ========================================================================
  // Context for AI
  // ========================================================================

  /**
   * Build context string for AI injection.
   *
   * This method retrieves relevant knowledge from both structural and learned
   * sources and formats it for injection into AI prompts.
   *
   * @param query Optional text query for relevance matching
   * @param filePath Optional file path for scope filtering
   * @param moduleName Optional module name for scope filtering
   * @param maxTokens Maximum tokens to include in context
   * @returns Formatted context string
   */
  getContextForAI(
    query?: string,
    filePath?: string,
    moduleName?: string,
    maxTokens = 1000
  ): string {
    const parts: string[] = [];
    let currentTokens = 0;

    // Add structural context if we have a module name
    if (moduleName) {
      const structuralContext = this.buildStructuralContext(
        moduleName,
        maxTokens / 2
      );
      if (structuralContext) {
        const tokens = estimateTokens(structuralContext);
        if (currentTokens + tokens <= maxTokens) {
          parts.push(structuralContext);
          currentTokens += tokens;
        }
      }
    }

    // Add learned context
    const learnedContext = this.buildLearnedContext(
      query,
      filePath,
      moduleName,
      maxTokens - currentTokens
    );
    if (learnedContext) {
      parts.push(learnedContext);
    }

    return parts.join('\n\n');
  }

  /**
   * Build structural context for a module.
   */
  private buildStructuralContext(
    moduleName: string,
    maxTokens: number
  ): string {
    const parts: string[] = [];
    let tokens = 0;

    // Module info
    const module = this.structuralProvider.findModule(moduleName);
    if (module) {
      const header = `## Module: ${moduleName}\n`;
      parts.push(header);
      tokens += estimateTokens(header);

      // Ports
      const ports = this.structuralProvider.getModulePorts(moduleName);
      if (ports.length > 0) {
        const portSection =
          '### Ports\n' +
          ports
            .map((p) => {
              const data = p.data;
              if (data.kind === 'port') {
                return `- ${p.name}: ${data.direction} ${data.portType}${data.width ? ` ${data.width}` : ''}`;
              }
              return `- ${p.name}`;
            })
            .join('\n');
        const portTokens = estimateTokens(portSection);
        if (tokens + portTokens <= maxTokens) {
          parts.push(portSection);
          tokens += portTokens;
        }
      }

      // Parameters
      const params = this.structuralProvider.getModuleParameters(moduleName);
      if (params.length > 0 && tokens < maxTokens) {
        const paramSection =
          '### Parameters\n' +
          params
            .map((p) => {
              const data = p.data;
              if (data.kind === 'parameter' || data.kind === 'localparam') {
                const value =
                  'defaultValue' in data
                    ? data.defaultValue
                    : 'value' in data
                      ? data.value
                      : undefined;
                return `- ${p.name}: ${data.paramType}${value ? ` = ${value}` : ''}`;
              }
              return `- ${p.name}`;
            })
            .join('\n');
        const paramTokens = estimateTokens(paramSection);
        if (tokens + paramTokens <= maxTokens) {
          parts.push(paramSection);
          tokens += paramTokens;
        }
      }

      // Instances inside module
      const instances = this.structuralProvider.getInstancesInModule(moduleName);
      if (instances.length > 0 && tokens < maxTokens) {
        const instanceSection =
          '### Instances\n' +
          instances.map((i) => `- ${i.instanceName}: ${i.targetName}`).join('\n');
        const instanceTokens = estimateTokens(instanceSection);
        if (tokens + instanceTokens <= maxTokens) {
          parts.push(instanceSection);
          tokens += instanceTokens;
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Build learned context from KnowledgeStore.
   */
  private buildLearnedContext(
    query?: string,
    filePath?: string,
    moduleName?: string,
    maxTokens = 500
  ): string {
    const results = this.learnedProvider.search({
      query,
      filePath,
      moduleName,
      maxResults: 10,
      minConfidence: 0.5,
    });

    if (results.length === 0) return '';

    const parts: string[] = ['## Relevant Knowledge\n'];
    let tokens = estimateTokens(parts[0]);

    for (const result of results) {
      const section = `### ${result.title}\n${result.content}\n`;
      const sectionTokens = estimateTokens(section);
      if (tokens + sectionTokens > maxTokens) break;
      parts.push(section);
      tokens += sectionTokens;
    }

    return parts.join('\n');
  }

  // ========================================================================
  // Structural Queries (Pass-through)
  // ========================================================================

  /**
   * Find a module by exact name.
   */
  findModule(name: string): Declaration | undefined {
    return this.structuralProvider.findModule(name);
  }

  /**
   * Find modules matching a pattern (supports wildcards * and ?).
   */
  findModulesByPattern(pattern: string): Declaration[] {
    return this.structuralProvider.findModulesByPattern(pattern);
  }

  /**
   * Get all ports of a module.
   */
  getModulePorts(moduleName: string): Declaration[] {
    return this.structuralProvider.getModulePorts(moduleName);
  }

  /**
   * Get all signals of a module.
   */
  getModuleSignals(moduleName: string): Declaration[] {
    return this.structuralProvider.getModuleSignals(moduleName);
  }

  /**
   * Get all instances of a specific module (where it's instantiated).
   */
  getModuleInstances(moduleName: string): Instance[] {
    return this.structuralProvider.getModuleInstances(moduleName);
  }

  /**
   * Get the module hierarchy tree.
   */
  getHierarchy(topModule?: string): HierarchyNode[] {
    return this.structuralProvider.getHierarchy(topModule);
  }

  /**
   * Get file dependencies.
   */
  getDependencies(moduleName?: string): FileDependency[] {
    return this.structuralProvider.getDependencies(moduleName);
  }

  // ========================================================================
  // Learned Knowledge Operations
  // ========================================================================

  /**
   * Add learned knowledge.
   * Validates that the type is a learned type (not structural).
   */
  addLearnedKnowledge(
    item: Omit<
      KnowledgeItem,
      'id' | 'fingerprint' | 'created' | 'updated' | 'useCount' | 'lastAccessed'
    >
  ): KnowledgeItem {
    return this.learnedProvider.addKnowledge(item);
  }

  /**
   * Remove learned knowledge by ID.
   */
  removeLearnedKnowledge(id: string): boolean {
    return this.learnedProvider.removeKnowledge(id);
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Save the knowledge store.
   */
  async save(): Promise<void> {
    await this.learnedProvider.save();
  }
}
