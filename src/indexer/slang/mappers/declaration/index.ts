/**
 * Declaration Mappers Index
 *
 * Re-exports all declaration mapper modules.
 *
 * @module slang/mappers/declaration
 */

// Design units
export {
  mapModuleDefinition,
  mapInterfaceDefinition,
  mapPackage,
  mapClass,
} from './design-units.js';

// Signals
export {
  mapPort,
  mapParameter,
  mapVariable,
  mapNet,
} from './signals.js';

// Functions
export {
  mapFunction,
  mapTask,
} from './functions.js';

// Types
export {
  mapTypeAlias,
  mapEnum,
  mapEnumValue,
  mapStructOrUnion,
} from './types.js';
