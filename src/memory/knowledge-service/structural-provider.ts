// src/memory/knowledge-service/structural-provider.ts

import type {
  Declaration,
  Instance,
  HierarchyNode,
  FileDependency,
  ResolvedProject,
} from '../../indexer/types/index.js';
import * as path from 'path';
import type { UnifiedKnowledgeResult, UnifiedKnowledgeQuery } from './types.js';

interface FlatHierarchyNode extends HierarchyNode {
  depth: number;
  parentModule?: string;
  parentInstance?: string;
}

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
   * Find a module/interface/package by exact name.
   */
  findContainer(name: string): Declaration | undefined {
    const project = this.projectGetter();
    if (!project) return undefined;

    return this.findContainerInProject(project, name);
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

    const container = this.findContainerInProject(project, moduleName);
    if (!container) return [];
    const containerId = container.id;

    return project.declarations.filter(
      (d) => d.kind === 'port' && this.isDirectChildOf(d, moduleName, containerId)
    );
  }

  /**
   * Get all signals of a module.
   */
  getModuleSignals(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    const container = this.findContainerInProject(project, moduleName);
    if (!container) return [];
    const containerId = container.id;

    return project.declarations.filter(
      (d) => d.kind === 'signal' && this.isDirectChildOf(d, moduleName, containerId)
    );
  }

  /**
   * Get all parameters of a module.
   */
  getModuleParameters(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    const container = this.findContainerInProject(project, moduleName);
    if (!container) return [];
    const containerId = container.id;

    return project.declarations.filter(
      (d) =>
        (d.kind === 'parameter' || d.kind === 'localparam') &&
        this.isDirectChildOf(d, moduleName, containerId)
    );
  }

  /**
   * Get all functions in a module.
   */
  getModuleFunctions(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    const container = this.findContainerInProject(project, moduleName);
    if (!container) return [];
    const containerId = container.id;

    return project.declarations.filter(
      (d) => d.kind === 'function' && this.isDirectChildOf(d, moduleName, containerId)
    );
  }

  /**
   * Get all classes in a module or package.
   */
  getModuleClasses(moduleName: string): Declaration[] {
    const project = this.projectGetter();
    if (!project) return [];

    const container = this.findContainerInProject(project, moduleName);
    if (!container) return [];
    const containerId = container.id;

    return project.declarations.filter(
      (d) => d.kind === 'class' && this.isDirectChildOf(d, moduleName, containerId)
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

    return project.instances.filter(
      (i) =>
        i.parentScope.length > 0 &&
        i.parentScope[i.parentScope.length - 1] === moduleName
    );
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
      const containerDecl = this.findContainerInProject(project, moduleName);
      if (!containerDecl) return [];

      return project.dependencies.filter(
        (d) => d.fromFile === containerDecl.location.file
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
    const queryLower = (query.query ?? '').toLowerCase();
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

    if (!queryLower) {
      return declarations.slice(0, maxResults).map((decl) =>
        this.toUnifiedResult(decl, 0.5, 'structural match')
      );
    }

    // Score and filter by query
    for (const decl of declarations) {
      let relevance = 0.5; // Base relevance
      let matchReason = 'structural match';

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

      results.push(this.toUnifiedResult(decl, relevance, matchReason));
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    return results.slice(0, maxResults);
  }

  /**
   * Search file dependencies by query and filters.
   */
  searchDependencies(query: UnifiedKnowledgeQuery): UnifiedKnowledgeResult[] {
    const project = this.projectGetter();
    if (!project) return [];

    const queryLower = query.query?.toLowerCase();
    const maxResults = query.maxResults ?? 20;
    let dependencies = project.dependencies;

    if (query.moduleName) {
      const container = this.findContainerInProject(project, query.moduleName);
      if (!container) return [];
      dependencies = dependencies.filter(
        (d) => d.fromFile === container.location.file
      );
    }

    if (query.filePath) {
      dependencies = dependencies.filter(
        (d) => d.fromFile === query.filePath || d.toFile === query.filePath
      );
    }

    const results: UnifiedKnowledgeResult[] = [];

    for (const dep of dependencies) {
      let relevance = 0.5;
      let matchReason = 'dependency match';

      if (queryLower) {
        const entityLower = dep.entityName.toLowerCase();
        const fromLower = dep.fromFile.toLowerCase();
        const toLower = dep.toFile.toLowerCase();
        const reasonLower = dep.reason.toLowerCase();

        if (entityLower === queryLower) {
          relevance = 1.0;
          matchReason = 'exact entity match';
        } else if (entityLower.startsWith(queryLower)) {
          relevance = 0.9;
          matchReason = 'entity prefix match';
        } else if (entityLower.includes(queryLower)) {
          relevance = 0.7;
          matchReason = 'entity contains match';
        } else if (fromLower.includes(queryLower) || toLower.includes(queryLower)) {
          relevance = 0.6;
          matchReason = 'file match';
        } else if (reasonLower.includes(queryLower)) {
          relevance = 0.5;
          matchReason = 'reason match';
        } else {
          continue;
        }
      }

      results.push(this.toDependencyResult(dep, relevance, matchReason));
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, maxResults);
  }

  /**
   * Search hierarchy nodes by query and filters.
   */
  searchHierarchy(query: UnifiedKnowledgeQuery): UnifiedKnowledgeResult[] {
    const project = this.projectGetter();
    if (!project) return [];

    const queryLower = query.query?.toLowerCase();
    const maxResults = query.maxResults ?? 20;

    let nodes = this.flattenHierarchy(project.hierarchy);

    if (query.moduleName) {
      nodes = nodes.filter((n) => n.moduleName === query.moduleName);
    }

    if (query.filePath) {
      nodes = nodes.filter((n) => n.file === query.filePath);
    }

    if (!queryLower) {
      const topNodes = nodes.filter((n) => n.depth === 0);
      return topNodes.slice(0, maxResults).map((n) =>
        this.toHierarchyResult(n, 0.5, 'hierarchy node')
      );
    }

    const results: UnifiedKnowledgeResult[] = [];

    for (const node of nodes) {
      let relevance = 0.5;
      let matchReason = 'hierarchy match';

      const moduleLower = node.moduleName.toLowerCase();
      const instanceLower = node.instanceName.toLowerCase();

      if (moduleLower === queryLower || instanceLower === queryLower) {
        relevance = 1.0;
        matchReason = 'exact name match';
      } else if (
        moduleLower.startsWith(queryLower) ||
        instanceLower.startsWith(queryLower)
      ) {
        relevance = 0.9;
        matchReason = 'name prefix match';
      } else if (
        moduleLower.includes(queryLower) ||
        instanceLower.includes(queryLower)
      ) {
        relevance = 0.7;
        matchReason = 'name contains match';
      } else {
        continue;
      }

      results.push(this.toHierarchyResult(node, relevance, matchReason));
    }

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

  /**
   * Convert a dependency to a unified result.
   */
  toDependencyResult(
    dep: FileDependency,
    relevance: number,
    matchReason: string
  ): UnifiedKnowledgeResult {
    return {
      id: `${dep.fromFile}->${dep.toFile}:${dep.entityName}`,
      title: this.formatDependencyTitle(dep),
      content: this.formatDependencyContent(dep),
      relevance,
      matchReason,
      source: 'structural',
      dependency: dep,
    };
  }

  /**
   * Convert a hierarchy node to a unified result.
   */
  toHierarchyResult(
    node: FlatHierarchyNode,
    relevance: number,
    matchReason: string
  ): UnifiedKnowledgeResult {
    return {
      id: `hierarchy:${node.moduleName}:${node.instanceName}:${node.file}:${node.line}`,
      title: this.formatHierarchyTitle(node),
      content: this.formatHierarchyContent(node),
      relevance,
      matchReason,
      source: 'structural',
      hierarchyNode: node,
    };
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  /**
   * Find a container declaration (module/interface/package) within a project.
   */
  private findContainerInProject(
    project: ResolvedProject,
    name: string
  ): Declaration | undefined {
    return project.declarations.find(
      (d) =>
        (d.kind === 'module' || d.kind === 'interface' || d.kind === 'package') &&
        d.name === name
    );
  }

  /**
   * Check if a declaration is a direct child of a container.
   */
  private isDirectChildOf(
    decl: Declaration,
    containerName: string,
    containerId?: string
  ): boolean {
    if (containerId && decl.parentId) {
      return decl.parentId === containerId;
    }
    if (decl.scope.length === 0) return false;
    return decl.scope[decl.scope.length - 1] === containerName;
  }

  /**
   * Flatten hierarchy nodes with depth tracking.
   */
  private flattenHierarchy(roots: HierarchyNode[]): FlatHierarchyNode[] {
    const result: FlatHierarchyNode[] = [];
    const maxDepth = 100;

    const walk = (
      node: HierarchyNode,
      depth: number,
      parentModule?: string,
      parentInstance?: string
    ): void => {
      if (depth > maxDepth) return;
      result.push({
        ...node,
        depth,
        parentModule,
        parentInstance,
      });

      if (node.isCyclic) {
        return;
      }

      for (const child of node.children) {
        walk(child, depth + 1, node.moduleName, node.instanceName);
      }
    };

    for (const root of roots) {
      walk(root, 0);
    }

    return result;
  }

  /**
   * Format dependency title for display.
   */
  private formatDependencyTitle(dep: FileDependency): string {
    switch (dep.reason) {
      case 'instantiates':
        return `Instantiates: ${dep.entityName}`;
      case 'imports':
        return `Imports: ${dep.entityName}`;
      case 'includes':
        return `Includes: ${path.basename(dep.toFile)}`;
      case 'extends':
        return `Extends: ${dep.entityName}`;
      case 'uses_macro':
        return `Uses macro: ${dep.entityName}`;
      default:
        return `Depends on: ${dep.entityName}`;
    }
  }

  /**
   * Format dependency content for display.
   */
  private formatDependencyContent(dep: FileDependency): string {
    const fromBase = path.basename(dep.fromFile);
    const toBase = path.basename(dep.toFile);
    const lines: string[] = [];

    switch (dep.reason) {
      case 'instantiates':
        lines.push(`${fromBase} instantiates module ${dep.entityName} from ${toBase}`);
        break;
      case 'imports':
        lines.push(`${fromBase} imports package ${dep.entityName} from ${toBase}`);
        break;
      case 'includes':
        lines.push(`${fromBase} includes file ${toBase}`);
        break;
      case 'extends':
        lines.push(`${fromBase} extends class ${dep.entityName} from ${toBase}`);
        break;
      case 'uses_macro':
        lines.push(`${fromBase} uses macro ${dep.entityName} defined in ${toBase}`);
        break;
      default:
        lines.push(`${fromBase} depends on ${dep.entityName} from ${toBase}`);
    }

    if (dep.guard) {
      const prefix = dep.guard.inverted ? 'not ' : '';
      lines.push(`Conditional: ${prefix}${dep.guard.condition}`);
    }

    return lines.join('\n');
  }

  /**
   * Format hierarchy title for display.
   */
  private formatHierarchyTitle(node: FlatHierarchyNode): string {
    if (node.depth === 0) {
      return `Top: ${node.moduleName}`;
    }
    return `Instance: ${node.instanceName} (${node.moduleName})`;
  }

  /**
   * Format hierarchy content for display.
   */
  private formatHierarchyContent(node: FlatHierarchyNode): string {
    const fileBase = path.basename(node.file);
    const lines: string[] = [];

    if (node.depth === 0) {
      lines.push(`Top-level module ${node.moduleName}`);
      lines.push(`Defined in ${fileBase}:${node.line}`);
    } else {
      lines.push(`Instance ${node.instanceName} of module ${node.moduleName}`);
      lines.push(`Instantiated at ${fileBase}:${node.line}`);
      if (node.parentModule && node.parentInstance) {
        lines.push(`Parent: ${node.parentInstance} (${node.parentModule})`);
      }
      lines.push(`Depth: ${node.depth}`);
    }

    return lines.join('\n');
  }

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
