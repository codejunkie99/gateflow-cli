/**
 * Slang Mappers Index
 *
 * Re-exports all mapper modules for slang AST to indexer type mapping.
 *
 * @module slang/mappers
 */

// Types and context
export type {
  SlangMappingResult,
  MappingContext,
  ProcessResult,
} from './types.js';
export { createChildContext } from './types.js';

// Helpers
export {
  mapLocation,
  buildLookupKey,
  extractWidth,
} from './helpers.js';

// Declaration mappers
export * from './declaration/index.js';

// Instance and reference mappers
export { mapInstance } from './instance-mapper.js';
export { createExtendsReference } from './reference-mapper.js';

// Resolution utilities
export {
  resolveReferences,
  resolveInstances,
} from './resolution.js';
