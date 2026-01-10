/**
 * Shared Types for CST Mappers
 *
 * Contains the MapperContext and CSTMapperResult types used across all mapper modules.
 *
 * @module verible/mappers/types
 */

import type { Declaration } from '../../types/declaration.js';
import type { Reference } from '../../types/reference.js';
import type { Instance } from '../../types/instance.js';
import type { Directive } from '../../types/directive.js';
import type { Guard, ParseError } from '../../types/location.js';

/**
 * Result from mapping a Verible CST.
 */
export interface CSTMapperResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  directives: Directive[];
  errors: ParseError[];
}

/**
 * Context passed during tree traversal.
 */
export interface MapperContext {
  /** Source file path */
  filePath: string;

  /** Source file content (for extracting text) */
  content: string;

  /** Line offsets for position calculation */
  lineOffsets: number[];

  /** Current scope chain */
  scope: string[];

  /** Current parent declaration ID */
  parentId?: string;

  /** Current guard condition */
  guard?: Guard;

  /** Accumulated declarations */
  declarations: Declaration[];

  /** Accumulated references */
  references: Reference[];

  /** Accumulated instances */
  instances: Instance[];

  /** Accumulated directives */
  directives: Directive[];

  /** Accumulated errors */
  errors: ParseError[];
}

/**
 * Create a new mapper context.
 */
export function createMapperContext(
  filePath: string,
  content: string,
  lineOffsets: number[]
): MapperContext {
  return {
    filePath,
    content,
    lineOffsets,
    scope: [],
    declarations: [],
    references: [],
    instances: [],
    directives: [],
    errors: [],
  };
}

/**
 * Create a child context with updated scope.
 */
export function createChildContext(
  parent: MapperContext,
  scopeName: string,
  parentId: string
): MapperContext {
  return {
    ...parent,
    scope: [...parent.scope, scopeName],
    parentId,
  };
}
