/**
 * Slang Mapper Types
 *
 * Shared types and context for slang AST mapping.
 *
 * @module slang/mappers/types
 */

import type { Declaration } from '../../types/declaration.js';
import type { Reference } from '../../types/reference.js';
import type { Instance } from '../../types/instance.js';

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from mapping slang AST.
 */
export interface SlangMappingResult {
  /** Declarations extracted from slang AST */
  declarations: Declaration[];

  /** References extracted from slang AST */
  references: Reference[];

  /** Instances extracted from slang AST (with resolved IDs) */
  instances: Instance[];

  /** Mapping stats */
  stats: {
    /** Total symbols processed */
    symbolsProcessed: number;

    /** Symbols that couldn't be mapped */
    unmappedSymbols: number;

    /** Time taken in milliseconds */
    mappingTimeMs: number;
  };
}

/**
 * Result from processing a single symbol and its children.
 */
export interface ProcessResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  processed: number;
  unmapped: number;
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context passed during AST traversal.
 */
export interface MappingContext {
  /** Current scope chain */
  scope: string[];

  /** Parent declaration ID (if any) */
  parentId?: string;

  /** Declaration ID lookup by name (for resolving references) */
  declLookup: Map<string, string>;
}

// ============================================================================
// Context Helpers
// ============================================================================

/**
 * Create child context with updated scope.
 */
export function createChildContext(
  parent: MappingContext,
  scopeName: string,
  parentId?: string
): MappingContext {
  return {
    scope: [...parent.scope, scopeName],
    parentId,
    declLookup: parent.declLookup,
  };
}
