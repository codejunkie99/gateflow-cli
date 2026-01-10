/**
 * Query API Module
 *
 * Provides a clean, high-level interface for IDE-style queries on the
 * merged index. These are the operations that power features like:
 *
 * - Go to Definition
 * - Find All References
 * - Hover Information
 * - Symbol Search
 * - Hierarchy Navigation
 *
 * @module merge/query-api
 */

import type { Declaration, DeclarationKind } from '../types/declaration.js';
import type { Reference } from '../types/reference.js';
import type { Instance } from '../types/instance.js';
import type { Location } from '../types/location.js';
import type { MergedIndex } from './index-merger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from a "go to definition" query.
 */
export interface DefinitionResult {
  /** Whether a definition was found */
  found: boolean;

  /** The declaration if found */
  declaration?: Declaration;

  /** Why the definition wasn't found */
  reason?: 'not_found' | 'no_reference_at_location' | 'unresolved_reference';
}

/**
 * Result from a "find all references" query.
 */
export interface ReferencesResult {
  /** References found */
  references: Reference[];

  /** Instances of this declaration */
  instances: Instance[];

  /** Total count (references + instances) */
  totalCount: number;
}

/**
 * Hover information for a symbol.
 */
export interface HoverInfo {
  /** Symbol kind */
  kind: DeclarationKind | 'reference' | 'instance';

  /** Symbol name */
  name: string;

  /** Full signature or declaration text */
  signature: string;

  /** Documentation or description */
  documentation?: string;

  /** File where defined */
  definedIn?: string;

  /** Additional details based on kind */
  details?: Record<string, string>;
}

/**
 * Symbol match from search.
 */
export interface SymbolMatch {
  /** The declaration */
  declaration: Declaration;

  /** Match score (higher is better) */
  score: number;

  /** Which parts of the name matched */
  matchedParts?: string[];
}

/**
 * Query interface for the merged index.
 */
export interface IndexQuery {
  /** Go to definition from a location */
  goToDefinition(file: string, line: number, col: number): DefinitionResult;

  /** Find all references to a declaration */
  findReferences(declarationId: string): ReferencesResult;

  /** Get hover information for a location */
  getHoverInfo(file: string, line: number, col: number): HoverInfo | null;

  /** Search symbols by name */
  searchSymbols(query: string, options?: SearchOptions): SymbolMatch[];

  /** Get declaration by ID */
  getDeclaration(id: string): Declaration | undefined;

  /** Get all declarations in a file */
  getFileDeclarations(file: string): Declaration[];

  /** Get children of a declaration */
  getChildren(parentId: string): Declaration[];

  /** Get instances of a module */
  getModuleInstances(moduleName: string): Instance[];
}

/**
 * Options for symbol search.
 */
export interface SearchOptions {
  /** Maximum results to return */
  limit?: number;

  /** Filter by kind */
  kinds?: DeclarationKind[];

  /** Filter by file */
  file?: string;

  /** Include fuzzy matches */
  fuzzy?: boolean;
}

// ============================================================================
// QueryAPI Class
// ============================================================================

/**
 * Query API for the merged index.
 *
 * @example
 * ```typescript
 * const api = new QueryAPI(mergedIndex);
 *
 * // Go to definition
 * const def = api.goToDefinition('/path/file.sv', 10, 5);
 * if (def.found) {
 *   console.log(`Definition at ${def.declaration.location.file}:${def.declaration.location.line}`);
 * }
 *
 * // Find all references
 * const refs = api.findReferences('decl:abc123');
 * console.log(`Found ${refs.totalCount} usages`);
 *
 * // Search symbols
 * const matches = api.searchSymbols('counter', { limit: 10 });
 * for (const match of matches) {
 *   console.log(`${match.declaration.kind}: ${match.declaration.name}`);
 * }
 * ```
 */
export class QueryAPI implements IndexQuery {
  private readonly index: MergedIndex;

  // Lookup tables built on construction
  private readonly declById: Map<string, Declaration>;
  private readonly declByLocation: Map<string, Declaration>;
  private readonly refByLocation: Map<string, Reference>;
  private readonly instByLocation: Map<string, Instance>;
  private readonly refsByTarget: Map<string, Reference[]>;
  private readonly instsByTarget: Map<string, Instance[]>;
  private readonly declsByFile: Map<string, Declaration[]>;
  private readonly declsByParent: Map<string, Declaration[]>;

  constructor(index: MergedIndex) {
    this.index = index;

    // Build lookup tables
    this.declById = new Map();
    this.declByLocation = new Map();
    this.declsByFile = new Map();
    this.declsByParent = new Map();

    for (const decl of index.declarations) {
      this.declById.set(decl.id, decl);
      this.declByLocation.set(locationKey(decl.location), decl);

      // By file
      const fileDecs = this.declsByFile.get(decl.location.file) || [];
      fileDecs.push(decl);
      this.declsByFile.set(decl.location.file, fileDecs);

      // By parent
      if (decl.parentId) {
        const parentDecs = this.declsByParent.get(decl.parentId) || [];
        parentDecs.push(decl);
        this.declsByParent.set(decl.parentId, parentDecs);
      }
    }

    this.refByLocation = new Map();
    this.refsByTarget = new Map();
    for (const ref of index.references) {
      this.refByLocation.set(locationKey(ref.location), ref);

      // By resolved target
      if (ref.resolvedId) {
        const targetRefs = this.refsByTarget.get(ref.resolvedId) || [];
        targetRefs.push(ref);
        this.refsByTarget.set(ref.resolvedId, targetRefs);
      }
    }

    this.instByLocation = new Map();
    this.instsByTarget = new Map();
    for (const inst of index.instances) {
      this.instByLocation.set(locationKey(inst.location), inst);

      // By resolved target
      if (inst.resolvedId) {
        const targetInsts = this.instsByTarget.get(inst.resolvedId) || [];
        targetInsts.push(inst);
        this.instsByTarget.set(inst.resolvedId, targetInsts);
      }

      // Also by name for unresolved
      const nameInsts = this.instsByTarget.get(inst.targetName) || [];
      nameInsts.push(inst);
      this.instsByTarget.set(inst.targetName, nameInsts);
    }
  }

  // ---------------------------------------------------------------------------
  // Go to Definition
  // ---------------------------------------------------------------------------

  goToDefinition(file: string, line: number, col: number): DefinitionResult {
    // First, check if we're on a declaration itself
    const declAtLocation = this.findDeclarationAt(file, line, col);
    if (declAtLocation) {
      return {
        found: true,
        declaration: declAtLocation,
      };
    }

    // Check if we're on a reference
    const ref = this.findReferenceAt(file, line, col);
    if (ref) {
      if (ref.resolvedId) {
        const decl = this.declById.get(ref.resolvedId);
        if (decl) {
          return {
            found: true,
            declaration: decl,
          };
        }
      }
      return {
        found: false,
        reason: 'unresolved_reference',
      };
    }

    // Check if we're on an instance
    const inst = this.findInstanceAt(file, line, col);
    if (inst) {
      if (inst.resolvedId) {
        const decl = this.declById.get(inst.resolvedId);
        if (decl) {
          return {
            found: true,
            declaration: decl,
          };
        }
      }
      // Try by name
      const declByName = this.findDeclarationByName(inst.targetName, 'module');
      if (declByName) {
        return {
          found: true,
          declaration: declByName,
        };
      }
      return {
        found: false,
        reason: 'unresolved_reference',
      };
    }

    return {
      found: false,
      reason: 'no_reference_at_location',
    };
  }

  // ---------------------------------------------------------------------------
  // Find References
  // ---------------------------------------------------------------------------

  findReferences(declarationId: string): ReferencesResult {
    const references = this.refsByTarget.get(declarationId) || [];
    const instances = this.instsByTarget.get(declarationId) || [];

    return {
      references,
      instances,
      totalCount: references.length + instances.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Hover Info
  // ---------------------------------------------------------------------------

  getHoverInfo(file: string, line: number, col: number): HoverInfo | null {
    // Check declaration
    const decl = this.findDeclarationAt(file, line, col);
    if (decl) {
      return this.buildDeclHover(decl);
    }

    // Check reference
    const ref = this.findReferenceAt(file, line, col);
    if (ref) {
      if (ref.resolvedId) {
        const targetDecl = this.declById.get(ref.resolvedId);
        if (targetDecl) {
          return {
            ...this.buildDeclHover(targetDecl),
            name: ref.targetName,
          };
        }
      }
      return {
        kind: 'reference',
        name: ref.targetName,
        signature: `${ref.kind}: ${ref.targetName}`,
        documentation: 'Unresolved reference',
      };
    }

    // Check instance
    const inst = this.findInstanceAt(file, line, col);
    if (inst) {
      return this.buildInstanceHover(inst);
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Symbol Search
  // ---------------------------------------------------------------------------

  searchSymbols(query: string, options: SearchOptions = {}): SymbolMatch[] {
    const { limit = 100, kinds, file, fuzzy = true } = options;
    const lowerQuery = query.toLowerCase();
    const matches: SymbolMatch[] = [];

    for (const decl of this.index.declarations) {
      // Apply filters
      if (kinds && !kinds.includes(decl.kind)) {
        continue;
      }
      if (file && decl.location.file !== file) {
        continue;
      }

      // Score the match
      const score = this.scoreMatch(decl.name, lowerQuery, fuzzy);
      if (score > 0) {
        matches.push({ declaration: decl, score });
      }
    }

    // Sort by score (descending) and limit
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Direct Lookups
  // ---------------------------------------------------------------------------

  getDeclaration(id: string): Declaration | undefined {
    return this.declById.get(id);
  }

  getFileDeclarations(file: string): Declaration[] {
    return this.declsByFile.get(file) || [];
  }

  getChildren(parentId: string): Declaration[] {
    return this.declsByParent.get(parentId) || [];
  }

  getModuleInstances(moduleName: string): Instance[] {
    return this.instsByTarget.get(moduleName) || [];
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private findDeclarationAt(file: string, line: number, col: number): Declaration | undefined {
    // Exact match first
    const exact = this.declByLocation.get(locationKey({ file, line, col }));
    if (exact) return exact;

    // Search all declarations in file for line match (declarations span multiple columns)
    const fileDecs = this.declsByFile.get(file) || [];
    for (const decl of fileDecs) {
      if (decl.location.line === line) {
        return decl;
      }
    }

    return undefined;
  }

  private findReferenceAt(file: string, line: number, col: number): Reference | undefined {
    const exact = this.refByLocation.get(locationKey({ file, line, col }));
    if (exact) return exact;

    // Search for line match
    for (const ref of this.index.references) {
      if (ref.location.file === file && ref.location.line === line) {
        return ref;
      }
    }

    return undefined;
  }

  private findInstanceAt(file: string, line: number, col: number): Instance | undefined {
    const exact = this.instByLocation.get(locationKey({ file, line, col }));
    if (exact) return exact;

    // Search for line match
    for (const inst of this.index.instances) {
      if (inst.location.file === file && inst.location.line === line) {
        return inst;
      }
    }

    return undefined;
  }

  private findDeclarationByName(name: string, kind?: DeclarationKind): Declaration | undefined {
    for (const decl of this.index.declarations) {
      if (decl.name === name && (!kind || decl.kind === kind)) {
        return decl;
      }
    }
    return undefined;
  }

  private buildDeclHover(decl: Declaration): HoverInfo {
    const signature = this.buildSignature(decl);
    const details: Record<string, string> = {};

    // Add kind-specific details
    switch (decl.data.kind) {
      case 'module':
        if (decl.data.params.length > 0) {
          details['Parameters'] = decl.data.params.map((p) => p.name).join(', ');
        }
        break;
      case 'function':
        details['Return Type'] = decl.data.returnType;
        if (decl.data.args.length > 0) {
          details['Arguments'] = decl.data.args.map((a) => a.name).join(', ');
        }
        break;
      case 'port':
        details['Direction'] = decl.data.direction;
        details['Type'] = decl.data.portType;
        break;
      case 'parameter':
        details['Type'] = decl.data.paramType;
        if (decl.data.defaultValue) {
          details['Default'] = decl.data.defaultValue;
        }
        break;
      case 'class':
        if (decl.data.extendsName) {
          details['Extends'] = decl.data.extendsName;
        }
        if (decl.data.isVirtual) {
          details['Virtual'] = 'true';
        }
        break;
    }

    return {
      kind: decl.kind,
      name: decl.name,
      signature,
      definedIn: decl.location.file,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }

  private buildInstanceHover(inst: Instance): HoverInfo {
    const details: Record<string, string> = {
      'Instance Name': inst.instanceName,
      'Module': inst.targetName,
    };

    if (inst.paramOverrides && Object.keys(inst.paramOverrides).length > 0) {
      details['Parameters'] = Object.entries(inst.paramOverrides)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
    }

    if (inst.arrayRange) {
      details['Array'] = inst.arrayRange;
    }

    return {
      kind: 'instance',
      name: inst.instanceName,
      signature: `${inst.targetName} ${inst.instanceName}`,
      definedIn: inst.location.file,
      details,
    };
  }

  private buildSignature(decl: Declaration): string {
    switch (decl.data.kind) {
      case 'module':
        if (decl.data.params.length > 0) {
          const params = decl.data.params.map((p) => p.name).join(', ');
          return `module ${decl.name} #(${params})`;
        }
        return `module ${decl.name}`;

      case 'function':
        const fArgs = decl.data.args.map((a) => `${a.direction} ${a.type} ${a.name}`).join(', ');
        return `function ${decl.data.returnType} ${decl.name}(${fArgs})`;

      case 'task':
        const tArgs = decl.data.args.map((a) => `${a.direction} ${a.type} ${a.name}`).join(', ');
        return `task ${decl.name}(${tArgs})`;

      case 'class':
        if (decl.data.extendsName) {
          return `class ${decl.name} extends ${decl.data.extendsName}`;
        }
        return `class ${decl.name}`;

      case 'port':
        const width = decl.data.width || '';
        return `${decl.data.direction} ${decl.data.portType}${width} ${decl.name}`;

      case 'parameter':
        const pDefault = decl.data.defaultValue ? ` = ${decl.data.defaultValue}` : '';
        return `parameter ${decl.data.paramType} ${decl.name}${pDefault}`;

      case 'typedef':
        return `typedef ${decl.data.underlyingType} ${decl.name}`;

      case 'signal':
        const sWidth = decl.data.width || '';
        return `${decl.data.signalType}${sWidth} ${decl.name}`;

      default:
        return `${decl.kind} ${decl.name}`;
    }
  }

  private scoreMatch(name: string, query: string, fuzzy: boolean): number {
    const lowerName = name.toLowerCase();

    // Exact match
    if (lowerName === query) {
      return 100;
    }

    // Prefix match
    if (lowerName.startsWith(query)) {
      return 80;
    }

    // Contains
    if (lowerName.includes(query)) {
      return 60;
    }

    // Fuzzy match (subsequence)
    if (fuzzy) {
      let qi = 0;
      for (const c of lowerName) {
        if (c === query[qi]) {
          qi++;
          if (qi === query.length) {
            return 40;
          }
        }
      }
    }

    return 0;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a location key for map lookup.
 */
function locationKey(loc: Location): string {
  return `${loc.file}:${loc.line}:${loc.col}`;
}

/**
 * Create a QueryAPI instance from a merged index.
 *
 * @param index - Merged index
 * @returns Query API instance
 */
export function createQueryAPI(index: MergedIndex): QueryAPI {
  return new QueryAPI(index);
}
