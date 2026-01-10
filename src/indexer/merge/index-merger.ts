/**
 * Index Merger Module
 *
 * Combines Layer A (Verible/regex) and Layer B (slang) results into a
 * unified index. This module is the heart of the two-layer architecture,
 * taking the best of both worlds:
 *
 * - Layer A provides instant, syntactic-level indexing
 * - Layer B provides accurate, semantic-level resolution
 *
 * The merger:
 * 1. Takes Layer A as the base (always available)
 * 2. Overlays Layer B data where available (resolved references, evaluated params)
 * 3. Produces a unified view with the best possible data
 *
 * @module merge/index-merger
 */

import type { Declaration } from '../types/declaration.js';
import type { Reference } from '../types/reference.js';
import type { Instance } from '../types/instance.js';
import type { Directive } from '../types/directive.js';
import type { FileUnderstanderResult, ResolvedProject, HierarchyNode, FileDependency } from '../types/result.js';
import type { FileRecord, ParseError } from '../types/index.js';
import type { SlangBackendResult } from '../slang/slang-backend.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Layer A result - syntactic parsing from Verible/regex.
 */
export interface LayerAResult {
  /** File records */
  files: FileRecord[];

  /** Declarations from syntactic parsing */
  declarations: Declaration[];

  /** References (unresolved) */
  references: Reference[];

  /** Instances (unresolved) */
  instances: Instance[];

  /** Directives */
  directives: Directive[];

  /** Parse errors */
  errors: ParseError[];
}

/**
 * Merged index containing data from both layers.
 */
export interface MergedIndex {
  /** All file records */
  files: FileRecord[];

  /** Declarations (Layer A base + Layer B additions) */
  declarations: Declaration[];

  /** References (Layer A base + Layer B resolution) */
  references: Reference[];

  /** Instances (Layer A base + Layer B resolution + evaluated params) */
  instances: Instance[];

  /** Directives from Layer A */
  directives: Directive[];

  /** Combined errors/diagnostics */
  errors: ParseError[];

  /** Merge metadata */
  meta: MergeMeta;
}

/**
 * Metadata about the merge operation.
 */
export interface MergeMeta {
  /** Whether Layer B (slang) was used */
  hasSemanticData: boolean;

  /** Layer B source (if used) */
  semanticSource?: 'slang';

  /** Statistics */
  stats: {
    /** Layer A declaration count */
    layerADeclCount: number;

    /** Layer B declaration count (if available) */
    layerBDeclCount?: number;

    /** References resolved by Layer B */
    referencesResolved: number;

    /** Instances resolved by Layer B */
    instancesResolved: number;

    /** Merge time in milliseconds */
    mergeTimeMs: number;
  };
}

// ============================================================================
// Main Merger Function
// ============================================================================

/**
 * Merge Layer A and Layer B results into a unified index.
 *
 * @param layerA - Syntactic parsing results
 * @param layerB - Semantic analysis results (optional)
 * @returns Merged index with best available data
 *
 * @example
 * ```typescript
 * // Layer A from Verible/regex
 * const layerA = combineFileResults(fileResults);
 *
 * // Layer B from slang (if available)
 * const layerB = await slangBackend.analyzeRecipe(recipe);
 *
 * // Merge
 * const merged = mergeIndices(layerA, layerB.success ? layerB : undefined);
 * ```
 */
export function mergeIndices(
  layerA: LayerAResult,
  layerB?: SlangBackendResult
): MergedIndex {
  const startTime = performance.now();

  // If no Layer B, just wrap Layer A
  if (!layerB || !layerB.success) {
    return {
      files: layerA.files,
      declarations: layerA.declarations,
      references: layerA.references,
      instances: layerA.instances,
      directives: layerA.directives,
      errors: layerA.errors,
      meta: {
        hasSemanticData: false,
        stats: {
          layerADeclCount: layerA.declarations.length,
          referencesResolved: 0,
          instancesResolved: 0,
          mergeTimeMs: performance.now() - startTime,
        },
      },
    };
  }

  // Build lookup maps from Layer B
  const layerBDeclById = new Map<string, Declaration>();
  const layerBDeclByNameScope = new Map<string, Declaration>();
  for (const decl of layerB.declarations) {
    layerBDeclById.set(decl.id, decl);
    const key = buildLookupKey(decl.name, decl.scope);
    layerBDeclByNameScope.set(key, decl);
  }

  const layerBRefById = new Map<string, Reference>();
  for (const ref of layerB.references) {
    layerBRefById.set(ref.id, ref);
  }

  const layerBInstById = new Map<string, Instance>();
  for (const inst of layerB.instances) {
    layerBInstById.set(inst.id, inst);
  }

  // Merge declarations (union of both, Layer B takes precedence for duplicates)
  const mergedDeclarations = mergeDeclarations(layerA.declarations, layerB.declarations);

  // Merge references (overlay Layer B resolution onto Layer A)
  const { merged: mergedReferences, resolvedCount: refsResolved } = mergeReferences(
    layerA.references,
    layerBRefById
  );

  // Merge instances (overlay Layer B resolution + params onto Layer A)
  const { merged: mergedInstances, resolvedCount: instsResolved } = mergeInstances(
    layerA.instances,
    layerBInstById
  );

  // Combine errors (only include diagnostics with locations)
  const mergedErrors: ParseError[] = [
    ...layerA.errors,
    ...layerB.diagnostics
      .filter((d) => d.severity === 'error' && d.location)
      .map((d) => ({
        message: d.message,
        location: {
          file: d.location!.file,
          line: d.location!.line,
          col: d.location!.column,
        },
        severity: 'error' as const,
      })),
  ];

  return {
    files: layerA.files,
    declarations: mergedDeclarations,
    references: mergedReferences,
    instances: mergedInstances,
    directives: layerA.directives,
    errors: mergedErrors,
    meta: {
      hasSemanticData: true,
      semanticSource: 'slang',
      stats: {
        layerADeclCount: layerA.declarations.length,
        layerBDeclCount: layerB.declarations.length,
        referencesResolved: refsResolved,
        instancesResolved: instsResolved,
        mergeTimeMs: performance.now() - startTime,
      },
    },
  };
}

// ============================================================================
// Individual Merge Functions
// ============================================================================

/**
 * Merge declarations from both layers.
 *
 * Strategy:
 * - Start with Layer A declarations
 * - Add Layer B declarations not in Layer A
 * - Layer B takes precedence for duplicates (by ID)
 */
function mergeDeclarations(layerA: Declaration[], layerB: Declaration[]): Declaration[] {
  // Build map from Layer A
  const merged = new Map<string, Declaration>();
  for (const decl of layerA) {
    merged.set(decl.id, decl);
  }

  // Overlay Layer B (takes precedence)
  for (const decl of layerB) {
    merged.set(decl.id, decl);
  }

  return Array.from(merged.values());
}

/**
 * Merge references, applying Layer B resolution to Layer A references.
 */
function mergeReferences(
  layerA: Reference[],
  layerBById: Map<string, Reference>
): { merged: Reference[]; resolvedCount: number } {
  let resolvedCount = 0;

  const merged = layerA.map((ref) => {
    // Check if Layer B has resolution for this reference
    const layerBRef = layerBById.get(ref.id);

    if (layerBRef?.resolvedId && !ref.resolvedId) {
      resolvedCount++;
      return {
        ...ref,
        resolvedId: layerBRef.resolvedId,
      };
    }

    return ref;
  });

  // Add any Layer B references not in Layer A
  for (const [id, ref] of layerBById) {
    if (!layerA.some((r) => r.id === id)) {
      merged.push(ref);
      if (ref.resolvedId) {
        resolvedCount++;
      }
    }
  }

  return { merged, resolvedCount };
}

/**
 * Merge instances, applying Layer B resolution and evaluated params.
 */
function mergeInstances(
  layerA: Instance[],
  layerBById: Map<string, Instance>
): { merged: Instance[]; resolvedCount: number } {
  let resolvedCount = 0;

  const merged = layerA.map((inst) => {
    const layerBInst = layerBById.get(inst.id);

    if (layerBInst) {
      const updates: Partial<Instance> = {};

      // Apply resolved ID if Layer B has it
      if (layerBInst.resolvedId && !inst.resolvedId) {
        updates.resolvedId = layerBInst.resolvedId;
        resolvedCount++;
      }

      // Apply evaluated parameters from Layer B
      if (layerBInst.paramOverrides) {
        updates.paramOverrides = {
          ...inst.paramOverrides,
          ...layerBInst.paramOverrides,
        };
      }

      if (Object.keys(updates).length > 0) {
        return { ...inst, ...updates };
      }
    }

    return inst;
  });

  // Add any Layer B instances not in Layer A
  for (const [id, inst] of layerBById) {
    if (!layerA.some((i) => i.id === id)) {
      merged.push(inst);
      if (inst.resolvedId) {
        resolvedCount++;
      }
    }
  }

  return { merged, resolvedCount };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build a lookup key from name and scope.
 */
function buildLookupKey(name: string, scope: string[]): string {
  if (scope.length === 0) {
    return name;
  }
  return `${scope.join('.')}.${name}`;
}

/**
 * Combine multiple FileUnderstanderResults into a LayerAResult.
 *
 * @param results - Individual file parse results
 * @returns Combined Layer A result
 */
export function combineFileResults(results: FileUnderstanderResult[]): LayerAResult {
  const files: FileRecord[] = [];
  const declarations: Declaration[] = [];
  const references: Reference[] = [];
  const instances: Instance[] = [];
  const directives: Directive[] = [];
  const errors: ParseError[] = [];

  for (const result of results) {
    files.push(result.file);
    declarations.push(...result.declarations);
    references.push(...result.references);
    instances.push(...result.instances);
    directives.push(...result.directives);
    errors.push(...result.errors);
  }

  return {
    files,
    declarations,
    references,
    instances,
    directives,
    errors,
  };
}

// ============================================================================
// Hierarchy Building
// ============================================================================

/**
 * Build module hierarchy from merged index.
 *
 * @param index - Merged index
 * @returns Hierarchy tree with roots as top-level modules
 */
export function buildHierarchy(index: MergedIndex): HierarchyNode[] {
  // Build declaration lookup
  const declById = new Map<string, Declaration>();
  for (const decl of index.declarations) {
    declById.set(decl.id, decl);
  }

  // Build lookup of which modules are instantiated
  const instantiatedModules = new Set<string>();
  for (const inst of index.instances) {
    if (inst.resolvedId) {
      instantiatedModules.add(inst.resolvedId);
    }
  }

  // Find top-level modules (not instantiated anywhere)
  const topModules = index.declarations.filter(
    (d) => d.kind === 'module' && !instantiatedModules.has(d.id)
  );

  // Build hierarchy tree for each top module
  const visited = new Set<string>();

  function buildNode(decl: Declaration, instanceName: string): HierarchyNode {
    // Check for cycles
    if (visited.has(decl.id)) {
      return {
        instanceName,
        moduleName: decl.name,
        moduleId: decl.id,
        file: decl.location.file,
        line: decl.location.line,
        children: [],
        isCyclic: true,
      };
    }

    visited.add(decl.id);

    // Find instances inside this module
    const childInstances = index.instances.filter((inst) =>
      inst.parentScope.length > 0 &&
      inst.parentScope[inst.parentScope.length - 1] === decl.name
    );

    const children: HierarchyNode[] = [];
    for (const inst of childInstances) {
      if (inst.resolvedId) {
        const childDecl = declById.get(inst.resolvedId);
        if (childDecl) {
          children.push(buildNode(childDecl, inst.instanceName));
        }
      } else {
        // Unresolved instance - still include but no children
        children.push({
          instanceName: inst.instanceName,
          moduleName: inst.targetName,
          moduleId: '',
          file: inst.location.file,
          line: inst.location.line,
          children: [],
        });
      }
    }

    visited.delete(decl.id);

    return {
      instanceName,
      moduleName: decl.name,
      moduleId: decl.id,
      file: decl.location.file,
      line: decl.location.line,
      children,
    };
  }

  return topModules.map((m) => buildNode(m, m.name));
}

/**
 * Build file dependencies from merged index.
 *
 * @param index - Merged index
 * @returns File dependency list
 */
export function buildDependencies(index: MergedIndex): FileDependency[] {
  const dependencies: FileDependency[] = [];

  // Build declaration location lookup
  const declLocations = new Map<string, string>(); // id -> file
  for (const decl of index.declarations) {
    declLocations.set(decl.id, decl.location.file);
  }

  // Instance dependencies
  for (const inst of index.instances) {
    if (inst.resolvedId) {
      const toFile = declLocations.get(inst.resolvedId);
      if (toFile && toFile !== inst.location.file) {
        dependencies.push({
          fromFile: inst.location.file,
          toFile,
          reason: 'instantiates',
          entityName: inst.targetName,
        });
      }
    }
  }

  // Import dependencies
  for (const ref of index.references) {
    if (ref.kind === 'import' && ref.resolvedId) {
      const toFile = declLocations.get(ref.resolvedId);
      if (toFile && toFile !== ref.location.file) {
        dependencies.push({
          fromFile: ref.location.file,
          toFile,
          reason: 'imports',
          entityName: ref.targetName,
        });
      }
    }

    // Extends dependencies
    if (ref.kind === 'extends' && ref.resolvedId) {
      const toFile = declLocations.get(ref.resolvedId);
      if (toFile && toFile !== ref.location.file) {
        dependencies.push({
          fromFile: ref.location.file,
          toFile,
          reason: 'extends',
          entityName: ref.targetName,
        });
      }
    }
  }

  // Include dependencies
  for (const dir of index.directives) {
    if (dir.kind === 'include' && dir.data.kind === 'include') {
      const resolvedPath = dir.data.resolvedPath;
      if (resolvedPath && resolvedPath !== dir.location.file) {
        dependencies.push({
          fromFile: dir.location.file,
          toFile: resolvedPath,
          reason: 'includes',
          entityName: dir.data.path,
        });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return dependencies.filter((dep) => {
    const key = `${dep.fromFile}:${dep.toFile}:${dep.reason}:${dep.entityName}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Convert merged index to ResolvedProject format.
 *
 * @param index - Merged index
 * @returns ResolvedProject for compatibility with existing code
 */
export function toResolvedProject(index: MergedIndex): ResolvedProject {
  return {
    files: index.files,
    declarations: index.declarations,
    references: index.references,
    instances: index.instances,
    directives: index.directives,
    hierarchy: buildHierarchy(index),
    dependencies: buildDependencies(index),
    hasSemanticAnalysis: index.meta.hasSemanticData,
  };
}
