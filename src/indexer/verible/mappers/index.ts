/**
 * Mappers Index
 *
 * Re-exports all mapper modules for CST to indexer type mapping.
 *
 * @module verible/mappers
 */

// Types
export {
  type CSTMapperResult,
  type MapperContext,
  createMapperContext,
  createChildContext,
} from './types.js';

// Utilities
export * from './ast-utils.js';
export * from './location-utils.js';

// Declaration mappers
export * from './declaration/index.js';

// Instance mapper
export {
  visitModuleInstantiation,
  visitBindDirective,
} from './instance-mapper.js';

// Reference mapper
export { visitPackageImport } from './reference-mapper.js';

// Directive mapper
export {
  visitPreprocessorInclude,
  visitPreprocessorDefine,
  visitPreprocessorIfdef,
} from './directive-mapper.js';
