/**
 * Project Resolver Module
 *
 * Resolves cross-file connections after parsing all files:
 * - Instances → Module declarations
 * - References → Target declarations
 * - Includes → Actual file paths
 *
 * @module resolver/project-resolver
 */

import type {
  FileUnderstanderResult,
  ResolvedProject,
  Declaration,
  Reference,
  Instance,
  Directive,
  FileRecord,
  HierarchyNode,
  FileDependency,
} from '../types/index.js';
import type { Recipe } from '../recipe/index.js';
import { DeclarationIndex } from './declaration-index.js';
import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// Project Resolver Class
// ============================================================================

/**
 * Resolves cross-file connections in a parsed project.
 *
 * @example
 * ```typescript
 * const resolver = new ProjectResolver(recipe);
 *
 * // Add parsed files
 * for (const result of parseResults) {
 *   resolver.addFile(result);
 * }
 *
 * // Resolve all connections
 * const project = await resolver.resolve();
 *
 * console.log(`Resolved ${project.instances.length} instances`);
 * console.log(`Found ${project.hierarchy.length} top modules`);
 * ```
 */
export class ProjectResolver {
  /** Declaration index for fast lookup */
  private index: DeclarationIndex;

  /** All file records */
  private files: Map<string, FileRecord> = new Map();

  /** All declarations (flat list) */
  private declarations: Declaration[] = [];

  /** All references (flat list) */
  private references: Reference[] = [];

  /** All instances (flat list) */
  private instances: Instance[] = [];

  /** All directives (flat list) */
  private directives: Directive[] = [];

  /** Recipe for include path resolution */
  private recipe?: Recipe;

  /** Macro index: macro name -> file where it's defined */
  private macroIndex: Map<string, string> = new Map();

  /**
   * Create a new project resolver.
   *
   * @param recipe - Optional recipe for include resolution
   */
  constructor(recipe?: Recipe) {
    this.index = new DeclarationIndex();
    this.recipe = recipe;
  }

  // --------------------------------------------------------------------------
  // Adding Files
  // --------------------------------------------------------------------------

  /**
   * Add a parsed file to the resolver.
   *
   * @param result - Result from FileUnderstander
   */
  addFile(result: FileUnderstanderResult): void {
    // Store file record
    this.files.set(result.file.path, result.file);

    // Add to flat lists
    this.declarations.push(...result.declarations);
    this.references.push(...result.references);
    this.instances.push(...result.instances);
    this.directives.push(...result.directives);

    // Index declarations
    this.index.addAll(result.declarations);

    // Index macro definitions for dependency tracking
    for (const directive of result.directives) {
      if (directive.data.kind === 'define' && directive.data.name) {
        // Store first definition of each macro (later definitions would override)
        if (!this.macroIndex.has(directive.data.name)) {
          this.macroIndex.set(directive.data.name, directive.location.file);
        }
      }
    }
  }

  /**
   * Add multiple parsed files.
   *
   * @param results - Array of parse results
   */
  addFiles(results: FileUnderstanderResult[]): void {
    for (const result of results) {
      this.addFile(result);
    }
  }

  // --------------------------------------------------------------------------
  // Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve all cross-file connections.
   *
   * @returns Fully resolved project
   */
  async resolve(): Promise<ResolvedProject> {
    // Resolve instances → modules
    this.resolveInstances();

    // Resolve references → declarations
    this.resolveReferences();

    // Resolve includes → file paths
    await this.resolveIncludes();

    // Build hierarchy tree
    const hierarchy = this.buildHierarchy();

    // Build file dependencies
    const dependencies = this.buildDependencies();

    return {
      files: Array.from(this.files.values()),
      declarations: this.declarations,
      references: this.references,
      instances: this.instances,
      directives: this.directives,
      hierarchy,
      dependencies,
      hasSemanticAnalysis: false, // Layer A only - no semantic analysis
    };
  }

  // --------------------------------------------------------------------------
  // Instance Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve all instances to their module declarations.
   */
  private resolveInstances(): void {
    for (const instance of this.instances) {
      // Skip if already resolved
      if (instance.resolvedId) continue;

      // Find the target module/interface/checker
      const target = this.findInstanceTarget(instance);

      if (target) {
        instance.resolvedId = target.id;
      }
    }
  }

  /**
   * Find the declaration that an instance points to.
   */
  private findInstanceTarget(instance: Instance): Declaration | undefined {
    const targetName = instance.targetName;

    // Try to find by kind based on instance kind
    switch (instance.instanceKind) {
      case 'module':
      case 'generate':
        // Could be module or interface
        return (
          this.index.getByNameAndKind(targetName, 'module') ||
          this.index.getByNameAndKind(targetName, 'interface')
        );

      case 'interface':
        return this.index.getByNameAndKind(targetName, 'interface');

      case 'checker':
        return this.index.getByNameAndKind(targetName, 'checker');

      case 'bind':
        // Bind instantiates a checker/module
        return (
          this.index.getByNameAndKind(targetName, 'checker') ||
          this.index.getByNameAndKind(targetName, 'module')
        );

      default:
        return this.index.getByNameAndKind(targetName, 'module');
    }
  }

  // --------------------------------------------------------------------------
  // Reference Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve all references to their declarations.
   */
  private resolveReferences(): void {
    for (const reference of this.references) {
      // Skip if already resolved
      if (reference.resolvedId) continue;

      // Find the target based on reference kind
      const target = this.findReferenceTarget(reference);

      if (target) {
        reference.resolvedId = target.id;
      }
    }
  }

  /**
   * Find the declaration that a reference points to.
   */
  private findReferenceTarget(reference: Reference): Declaration | undefined {
    const targetName = reference.targetName;

    switch (reference.kind) {
      case 'import':
        // Import references a package
        return this.index.getByNameAndKind(targetName, 'package');

      case 'extends':
        // Extends references a class
        return this.resolveClassName(targetName, reference.scope);

      case 'type_usage':
        // Could be typedef, struct, enum, class, or scoped reference
        return this.resolveTypeName(targetName, reference.scope);

      case 'macro_usage':
        // References a macro (define directive)
        // We don't have macros in declaration index currently
        return undefined;

      case 'assert_usage':
      case 'assume_usage':
      case 'cover_usage':
        // References a property
        return this.index.getByNameInScope(targetName, reference.scope) ||
               this.index.getByNameAndKind(targetName, 'property');

      case 'func_call':
        // References a function
        return this.index.getByNameInScope(targetName, reference.scope) ||
               this.index.getByNameAndKind(targetName, 'function');

      case 'task_call':
        // References a task
        return this.index.getByNameInScope(targetName, reference.scope) ||
               this.index.getByNameAndKind(targetName, 'task');

      default:
        // Generic lookup
        return this.index.getByNameInScope(targetName, reference.scope);
    }
  }

  /**
   * Resolve a class name, handling scoped references.
   *
   * Handles multi-level scoped names like `pkg::subpkg::class` or `a::b::c::d`.
   */
  private resolveClassName(name: string, scope: string[]): Declaration | undefined {
    // Check for scoped reference (pkg::class or pkg::subpkg::class, etc.)
    if (name.includes('::')) {
      const parts = name.split('::');
      const className = parts[parts.length - 1];
      const scopeParts = parts.slice(0, -1);

      // Find all classes with this name
      const candidates = this.index.getByName(className);
      for (const candidate of candidates) {
        if (candidate.kind !== 'class') continue;

        // Check if all scope parts are present in the candidate's scope
        // The scope parts must appear in order in the candidate's scope
        let matchIndex = 0;
        for (const scopePart of candidate.scope) {
          if (matchIndex < scopeParts.length && scopePart === scopeParts[matchIndex]) {
            matchIndex++;
          }
        }

        // All scope parts must have been matched
        if (matchIndex === scopeParts.length) {
          return candidate;
        }
      }
    }

    // Try scoped lookup first
    const scoped = this.index.getByNameInScope(name, scope);
    if (scoped?.kind === 'class') return scoped;

    // Fall back to global lookup
    return this.index.getByNameAndKind(name, 'class');
  }

  /**
   * Resolve a type name (could be typedef, struct, enum, class).
   *
   * Handles multi-level scoped names like `pkg::subpkg::type_t` or `a::b::c::d`.
   */
  private resolveTypeName(name: string, scope: string[]): Declaration | undefined {
    // Check for scoped reference
    if (name.includes('::')) {
      const parts = name.split('::');
      const typeName = parts[parts.length - 1];
      const scopeParts = parts.slice(0, -1);

      // Search in the specified scope
      const candidates = this.index.getByName(typeName);
      for (const candidate of candidates) {
        if (
          candidate.kind === 'typedef' ||
          candidate.kind === 'struct' ||
          candidate.kind === 'union' ||
          candidate.kind === 'enum' ||
          candidate.kind === 'class'
        ) {
          // Check if all scope parts are present in the candidate's scope
          // The scope parts must appear in order in the candidate's scope
          let matchIndex = 0;
          for (const scopePart of candidate.scope) {
            if (matchIndex < scopeParts.length && scopePart === scopeParts[matchIndex]) {
              matchIndex++;
            }
          }

          // All scope parts must have been matched
          if (matchIndex === scopeParts.length) {
            return candidate;
          }
        }
      }
    }

    // Try scoped lookup
    const scoped = this.index.getByNameInScope(name, scope);
    if (scoped) return scoped;

    // Try type-specific lookups
    return (
      this.index.getByNameAndKind(name, 'typedef') ||
      this.index.getByNameAndKind(name, 'struct') ||
      this.index.getByNameAndKind(name, 'union') ||
      this.index.getByNameAndKind(name, 'enum') ||
      this.index.getByNameAndKind(name, 'class')
    );
  }

  // --------------------------------------------------------------------------
  // Include Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve all include directives to actual file paths.
   */
  private async resolveIncludes(): Promise<void> {
    for (const directive of this.directives) {
      if (directive.data.kind !== 'include') continue;
      if (directive.data.resolvedPath) continue; // Already resolved

      const includePath = directive.data.path;
      const resolved = await this.resolveIncludePath(
        includePath,
        directive.location.file
      );

      if (resolved) {
        directive.data.resolvedPath = resolved;
      }
    }
  }

  /**
   * Resolve an include path.
   *
   * Resolution order (matches typical SystemVerilog compiler behavior):
   * 1. Relative to the including file (same directory first)
   * 2. Recipe include paths (in order specified)
   */
  private async resolveIncludePath(
    includePath: string,
    fromFile: string
  ): Promise<string | null> {
    // 1. Try relative to the including file FIRST
    // This matches typical compiler behavior where local includes take priority
    const fromDir = path.dirname(fromFile);
    const relative = path.join(fromDir, includePath);
    if (await this.fileExists(relative)) {
      return relative;
    }

    // 2. Try include paths from recipe (in order)
    if (this.recipe) {
      for (const incDir of this.recipe.includePaths) {
        const candidate = path.join(incDir, includePath);
        if (await this.fileExists(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * Check if a file exists.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Hierarchy Building
  // --------------------------------------------------------------------------

  /**
   * Build the module hierarchy tree.
   */
  private buildHierarchy(): HierarchyNode[] {
    // Find top-level modules (not instantiated anywhere)
    const instantiatedModules = new Set(
      this.instances
        .filter((i) => i.resolvedId)
        .map((i) => i.resolvedId!)
    );

    const topModules = this.index.getByKind('module').filter(
      (m) => !instantiatedModules.has(m.id)
    );

    // Build tree for each top module
    return topModules.map((m) => this.buildHierarchyNode(m, 'root', new Set()));
  }

  /**
   * Build a hierarchy node for a module.
   *
   * @param module - The module declaration
   * @param instanceName - Name of this instance
   * @param visited - Set of module IDs already visited in current path (for cycle detection)
   */
  private buildHierarchyNode(
    module: Declaration,
    instanceName: string,
    visited: Set<string>
  ): HierarchyNode {
    // Check for cycle (module instantiates itself directly or indirectly)
    if (visited.has(module.id)) {
      return {
        instanceName,
        moduleName: module.name,
        moduleId: module.id,
        file: module.location.file,
        line: module.location.line,
        children: [],
        isCyclic: true,
      };
    }

    // Add to visited set for this path
    const newVisited = new Set(visited);
    newVisited.add(module.id);

    // Find instances inside this module
    const childInstances = this.instances.filter(
      (i) => i.parentScope.length > 0 && i.parentScope[0] === module.name
    );

    const children: HierarchyNode[] = [];

    for (const inst of childInstances) {
      if (!inst.resolvedId) continue;

      const childModule = this.index.getById(inst.resolvedId);
      if (!childModule) continue;

      children.push(this.buildHierarchyNode(childModule, inst.instanceName, newVisited));
    }

    return {
      instanceName,
      moduleName: module.name,
      moduleId: module.id,
      file: module.location.file,
      line: module.location.line,
      children,
    };
  }

  // --------------------------------------------------------------------------
  // Dependency Building
  // --------------------------------------------------------------------------

  /**
   * Build file dependency graph.
   */
  private buildDependencies(): FileDependency[] {
    const deps: FileDependency[] = [];
    const seen = new Set<string>();

    // From instances
    for (const inst of this.instances) {
      if (!inst.resolvedId) continue;

      const target = this.index.getById(inst.resolvedId);
      if (!target) continue;

      const key = `${inst.location.file}|${target.location.file}|instantiates`;
      if (seen.has(key)) continue;
      seen.add(key);

      deps.push({
        fromFile: inst.location.file,
        toFile: target.location.file,
        reason: 'instantiates',
        entityName: inst.targetName,
      });
    }

    // From imports
    for (const ref of this.references) {
      if (ref.kind !== 'import' || !ref.resolvedId) continue;

      const target = this.index.getById(ref.resolvedId);
      if (!target) continue;

      const key = `${ref.location.file}|${target.location.file}|imports`;
      if (seen.has(key)) continue;
      seen.add(key);

      deps.push({
        fromFile: ref.location.file,
        toFile: target.location.file,
        reason: 'imports',
        entityName: ref.targetName,
      });
    }

    // From includes
    for (const dir of this.directives) {
      if (dir.data.kind !== 'include' || !dir.data.resolvedPath) continue;

      const key = `${dir.location.file}|${dir.data.resolvedPath}|includes`;
      if (seen.has(key)) continue;
      seen.add(key);

      deps.push({
        fromFile: dir.location.file,
        toFile: dir.data.resolvedPath,
        reason: 'includes',
        entityName: dir.data.path,
      });
    }

    // From extends
    for (const ref of this.references) {
      if (ref.kind !== 'extends' || !ref.resolvedId) continue;

      const target = this.index.getById(ref.resolvedId);
      if (!target) continue;

      const key = `${ref.location.file}|${target.location.file}|extends`;
      if (seen.has(key)) continue;
      seen.add(key);

      deps.push({
        fromFile: ref.location.file,
        toFile: target.location.file,
        reason: 'extends',
        entityName: ref.targetName,
      });
    }

    // From macro usages
    for (const ref of this.references) {
      if (ref.kind !== 'macro_usage') continue;

      const macroFile = this.macroIndex.get(ref.targetName);
      if (!macroFile) continue;

      // Skip self-references (macro defined and used in same file)
      if (macroFile === ref.location.file) continue;

      const key = `${ref.location.file}|${macroFile}|uses_macro`;
      if (seen.has(key)) continue;
      seen.add(key);

      deps.push({
        fromFile: ref.location.file,
        toFile: macroFile,
        reason: 'uses_macro',
        entityName: ref.targetName,
      });
    }

    return deps;
  }

  // --------------------------------------------------------------------------
  // Index Access
  // --------------------------------------------------------------------------

  /**
   * Get the declaration index.
   *
   * Useful for custom queries.
   */
  getIndex(): DeclarationIndex {
    return this.index;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new project resolver.
 *
 * @param recipe - Optional recipe for include resolution
 * @returns New ProjectResolver instance
 */
export function createProjectResolver(recipe?: Recipe): ProjectResolver {
  return new ProjectResolver(recipe);
}
