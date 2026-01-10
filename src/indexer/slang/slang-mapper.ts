/**
 * Slang AST Mapper
 *
 * Maps slang's JSON AST output to our indexer types (Declaration, Reference, Instance).
 * This is the orchestrator that dispatches to specialized sub-mappers.
 *
 * Key responsibilities:
 * - Traverse slang's AST structure
 * - Dispatch to appropriate mapper functions
 * - Aggregate results and manage context
 * - Handle scope chains and parent relationships
 *
 * @module slang/slang-mapper
 */

import type {
  SlangCompilation,
  SlangSymbol,
} from './slang-types.js';
import {
  isModuleDefinition,
  isInterfaceDefinition,
  isInstance,
  isPackage,
  isClass,
  isFunction,
  isTask,
  isPort,
  isParameter,
  isVariable,
  isNet,
  isTypeAlias,
  isEnum,
  isStructOrUnion,
} from './slang-types.js';

// Context and result types
import type {
  SlangMappingResult,
  MappingContext,
  ProcessResult,
} from './mappers/types.js';
import { createChildContext } from './mappers/types.js';

// Helpers
import { buildLookupKey } from './mappers/helpers.js';

// Declaration mappers
import {
  mapModuleDefinition,
  mapInterfaceDefinition,
  mapPackage,
  mapClass,
} from './mappers/declaration/design-units.js';
import {
  mapPort,
  mapParameter,
  mapVariable,
  mapNet,
} from './mappers/declaration/signals.js';
import {
  mapFunction,
  mapTask,
} from './mappers/declaration/functions.js';
import {
  mapTypeAlias,
  mapEnum,
  mapEnumValue,
  mapStructOrUnion,
} from './mappers/declaration/types.js';

// Instance and reference mappers
import { mapInstance } from './mappers/instance-mapper.js';
import { createExtendsReference } from './mappers/reference-mapper.js';

// Re-export types for external use
export type { SlangMappingResult } from './mappers/types.js';

// Re-export batch resolution utilities
export { resolveReferences, resolveInstances } from './mappers/resolution.js';

// ============================================================================
// Main Mapper Function
// ============================================================================

/**
 * Map slang compilation output to our indexer types.
 *
 * @param compilation - Slang's AST JSON output
 * @returns Mapped declarations, references, and instances
 *
 * @example
 * ```typescript
 * const result = await runSlangForRecipe(recipe);
 * if (result.success && result.compilation) {
 *   const mapped = mapSlangAst(result.compilation);
 *   console.log(`Found ${mapped.declarations.length} declarations`);
 * }
 * ```
 */
export function mapSlangAst(compilation: SlangCompilation): SlangMappingResult {
  const startTime = performance.now();

  const declarations = [];
  const references = [];
  const instances = [];

  let symbolsProcessed = 0;
  let unmappedSymbols = 0;

  // Create initial context
  const context: MappingContext = {
    scope: [],
    parentId: undefined,
    declLookup: new Map(),
  };

  // Process design root
  const design = compilation.design;
  if (design && design.members) {
    for (const member of design.members) {
      const result = processSymbol(member, context);
      symbolsProcessed += result.processed;
      unmappedSymbols += result.unmapped;

      declarations.push(...result.declarations);
      references.push(...result.references);
      instances.push(...result.instances);

      // Update lookup for resolution
      for (const decl of result.declarations) {
        context.declLookup.set(buildLookupKey(decl.name, decl.scope), decl.id);
      }
    }
  }

  const mappingTimeMs = performance.now() - startTime;

  return {
    declarations,
    references,
    instances,
    stats: {
      symbolsProcessed,
      unmappedSymbols,
      mappingTimeMs,
    },
  };
}

// ============================================================================
// Symbol Processing
// ============================================================================

/**
 * Process a single slang symbol and its children.
 */
function processSymbol(symbol: SlangSymbol, context: MappingContext): ProcessResult {
  const result: ProcessResult = {
    declarations: [],
    references: [],
    instances: [],
    processed: 1,
    unmapped: 0,
  };

  // Map symbol to appropriate type
  if (isModuleDefinition(symbol)) {
    const decl = mapModuleDefinition(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      // Process children with updated context
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isInterfaceDefinition(symbol)) {
    const decl = mapInterfaceDefinition(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isPackage(symbol)) {
    const decl = mapPackage(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isClass(symbol)) {
    const decl = mapClass(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      // Add extends reference if present
      if (symbol.baseClass) {
        const ref = createExtendsReference(symbol, context);
        if (ref) {
          result.references.push(ref);
        }
      }
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isInstance(symbol)) {
    const inst = mapInstance(symbol, context);
    if (inst) {
      result.instances.push(inst);
      // Process instance body if present
      if (symbol.body?.members) {
        const childContext = createChildContext(context, inst.instanceName, undefined);
        processChildren(symbol.body.members, childContext, result);
      }
    }
  } else if (isPort(symbol)) {
    const decl = mapPort(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isParameter(symbol)) {
    const decl = mapParameter(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isVariable(symbol)) {
    const decl = mapVariable(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isNet(symbol)) {
    const decl = mapNet(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isFunction(symbol)) {
    const decl = mapFunction(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isTask(symbol)) {
    const decl = mapTask(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      if (symbol.members) {
        const childContext = createChildContext(context, decl.name, decl.id);
        processChildren(symbol.members, childContext, result);
      }
    }
  } else if (isTypeAlias(symbol)) {
    const decl = mapTypeAlias(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else if (isEnum(symbol)) {
    const decl = mapEnum(symbol, context);
    if (decl) {
      result.declarations.push(decl);
      // Map enum values
      if (symbol.values) {
        for (let i = 0; i < symbol.values.length; i++) {
          const enumValue = symbol.values[i];
          const valueDecl = mapEnumValue(enumValue, i, symbol, context);
          if (valueDecl) {
            result.declarations.push(valueDecl);
          }
        }
      }
    }
  } else if (isStructOrUnion(symbol)) {
    const decl = mapStructOrUnion(symbol, context);
    if (decl) {
      result.declarations.push(decl);
    }
  } else {
    // Generic/unmapped symbol - try to extract children
    result.unmapped = 1;
    if (symbol.members) {
      processChildren(symbol.members, context, result);
    }
  }

  return result;
}

/**
 * Process child symbols.
 */
function processChildren(
  members: SlangSymbol[],
  context: MappingContext,
  result: ProcessResult
): void {
  for (const member of members) {
    const childResult = processSymbol(member, context);
    result.declarations.push(...childResult.declarations);
    result.references.push(...childResult.references);
    result.instances.push(...childResult.instances);
    result.processed += childResult.processed;
    result.unmapped += childResult.unmapped;
  }
}
