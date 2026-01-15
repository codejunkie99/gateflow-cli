// src/memory/knowledge-service/structural-provider.ts

import type {
  Declaration,
  DeclarationKind,
  Instance,
  HierarchyNode,
  FileDependency,
  ResolvedProject,
} from '../../indexer/types/index.js';
import type { UnifiedKnowledgeResult, UnifiedKnowledgeQuery } from './types.js';

/**
 * StructuralQueryProvider - Provides structural knowledge from the indexer.
 *
 * This provider wraps access to the ResolvedProject data structure,
 * converting structural facts (modules, ports, instances, etc.) into
 * the unified knowledge format for querying.
 */
export class StructuralQueryProvider {
  constructor(private projectGetter: () => ResolvedProject | null) {}

  // ========================================================================
  // Module Queries
  // ========================================================================

  /**
   * Find a module by exact name.
   */
  findModule(name: string): Declaration | undefined {
    const project = this.projectGetter();
    if (!project) return undefined;

    return project.declarations.find(
      (d) => d.kind === 'module' && d.name === name
    );
  }

  /**
   * Find modules matching a pattern (supports wildcards * and ?).
   */
  findModulesByPattern(pattern: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    const regex = this.patternToRegex(pattern);
    return project.declarations.filter(
      (d) => d.kind === 'module' && regex.test(d.name)
    );
  }

  /**
   * Get all ports of a module.
   */
  getModulePorts(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    return project.declarations.filter(
      (d) => d.kind === 'port' && d.scope.includes(moduleName)
    );
  }

  /**
   * Get all signals of a module.
   */
  getModuleSignals(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    return project.declarations.filter(
      (d) => d.kind === 'signal' && d.scope.includes(moduleName)
    );
  }

  /**
   * Get all parameters of a module.
   */
  getModuleParameters(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    return project.declarations.filter(
      (d) =>
        (d.kind === 'parameter' || d.kind === 'localparam') &&
        d.scope.includes(moduleName)
    );
  }

  /**
   * Get all functions in a module.
   */
  getModuleFunctions(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    return project.declarations.filter(
      (d) => d.kind === 'function' && d.scope.includes(moduleName)
    );
  }

  /**
   * Get all classes in a module or package.
   */
  getModuleClasses(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    return project.declarations.filter(
      (d) => d.kind === 'class' && d.scope.includes(moduleName)
    );
  }

  // ========================================================================
  // Instance Queries
  // ========================================================================

  /**
   * Get all instances of a specific module (where it's instantiated).
   */
  getModuleInstances(moduleName: string): Instance[] {
    const project = this.projectGetter();
    if (!project) return [];

    return project.instances.filter((i) => i.targetName === moduleName);
  }

  /**
   * Get all instances inside a specific module.
   */
  getInstancesInModule(moduleName: string): Instance[] {
    const project = this.projectGetter();
    if (!project) return [];

    return project.instances.filter((i) => i.parentScope.includes(moduleName));
  }

  // ========================================================================
  // Hierarchy Queries
  // ========================================================================

  /**
   * Get the module hierarchy tree.
   * @param topModule Optional top module name to filter hierarchy
   */
  getHierarchy(topModule?: string): HierarchyNode[] {
    const project = this.projectGetter();
    if (!project) return [];

    if (topModule) {
      return project.hierarchy.filter((h) => h.moduleName === topModule);
    }
    return project.hierarchy;
  }

  // ========================================================================
  // Dependency Queries
  // ========================================================================

  /**
   * Get file dependencies.
   * @param moduleName Optional module name to filter dependencies
   */
  getDependencies(moduleName?: string): FileDependency[] {
    const project = this.projectGetter();
    if (!project) return [];

    if (moduleName) {
      // Find the file containing the module
      const moduleDecl = this.findModule(moduleName);
      if (!moduleDecl) return [];

      return project.dependencies.filter(
        (d) => d.fromFile === moduleDecl.location.file
      );
    }
    return project.dependencies;
  }

  // ========================================================================
  // Search
  // ========================================================================

  /**
   * Search declarations by query and filters.
   */
  searchDeclarations(query: UnifiedKnowledgeQuery): UnifiedKnowledgeResult[] {
    const project = this.projectGetter();
    if (!project) return [];

    const results: UnifiedKnowledgeResult[] = [];
    const queryLower = query.query?.toLowerCase();
    const maxResults = query.maxResults ?? 20;

    // Filter declarations
    let declarations = project.declarations;

    // Filter by declaration kinds
    if (query.declarationKinds && query.declarationKinds.length > 0) {
      declarations = declarations.filter((d) =>
        query.declarationKinds!.includes(d.kind)
      );
    }

    // Filter by module name (scope)
    if (query.moduleName) {
      declarations = declarations.filter((d) =>
        d.scope.includes(query.moduleName!)
      );
    }

    // Filter by file path
    if (query.filePath) {
      declarations = declarations.filter(
        (d) => d.location.file === query.filePath
      );
    }

    // Score and filter by query
    for (const decl of declarations) {
      let relevance = 0.5; // Base relevance
      let matchReason = 'structural match';

      if (queryLower) {
        const nameLower = decl.name.toLowerCase();

        // Exact match
        if (nameLower === queryLower) {
          relevance = 1.0;
          matchReason = 'exact name match';
        }
        // Starts with query
        else if (nameLower.startsWith(queryLower)) {
          relevance = 0.9;
          matchReason = 'name prefix match';
        }
        // Contains query
        else if (nameLower.includes(queryLower)) {
          relevance = 0.7;
          matchReason = 'name contains query';
        }
        // No match - skip
        else {
          continue;
        }
      }

      results.push(this.toUnifiedResult(decl, relevance, matchReason));

      if (results.length >= maxResults) break;
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    return results.slice(0, maxResults);
  }

  // ========================================================================
  // Conversion
  // ========================================================================

  /**
   * Convert a declaration to a unified result.
   */
  toUnifiedResult(
    decl: Declaration,
    relevance: number,
    matchReason: string
  ): UnifiedKnowledgeResult {
    return {
      id: decl.id,
      title: `${this.capitalize(decl.kind)}: ${decl.name}`,
      content: this.formatDeclarationContent(decl),
      relevance,
      matchReason,
      source: 'structural',
      declaration: decl,
    };
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  /**
   * Format declaration content for display.
   */
  private formatDeclarationContent(decl: Declaration): string {
    const parts: string[] = [];

    parts.push(`Kind: ${decl.kind}`);
    parts.push(`Name: ${decl.name}`);
    parts.push(`File: ${decl.location.file}`);
    parts.push(`Line: ${decl.location.line}`);

    if (decl.scope.length > 0) {
      parts.push(`Scope: ${decl.scope.join('.')}`);
    }

    // Add kind-specific info
    switch (decl.data.kind) {
      case 'module':
        if (decl.data.params.length > 0) {
          parts.push(
            `Parameters: ${decl.data.params.map((p) => p.name).join(', ')}`
          );
        }
        break;
      case 'port':
        parts.push(`Direction: ${decl.data.direction}`);
        parts.push(`Type: ${decl.data.portType}`);
        if (decl.data.width) {
          parts.push(`Width: ${decl.data.width}`);
        }
        break;
      case 'signal':
        parts.push(`Type: ${decl.data.signalType}`);
        if (decl.data.width) {
          parts.push(`Width: ${decl.data.width}`);
        }
        break;
      case 'function':
        parts.push(`Return: ${decl.data.returnType}`);
        if (decl.data.args.length > 0) {
          parts.push(
            `Args: ${decl.data.args.map((a) => `${a.name}: ${a.type}`).join(', ')}`
          );
        }
        break;
      case 'parameter':
      case 'localparam':
        parts.push(`Type: ${decl.data.paramType}`);
        if ('defaultValue' in decl.data && decl.data.defaultValue) {
          parts.push(`Default: ${decl.data.defaultValue}`);
        }
        if ('value' in decl.data) {
          parts.push(`Value: ${decl.data.value}`);
        }
        break;
      case 'class':
        if (decl.data.extendsName) {
          parts.push(`Extends: ${decl.data.extendsName}`);
        }
        if (decl.data.isVirtual) {
          parts.push(`Virtual: yes`);
        }
        break;
    }

    return parts.join('\n');
  }

  /**
   * Capitalize the first letter of a string.
   */
  private capitalize(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Convert a simple pattern with wildcards to a regex.
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }
}
