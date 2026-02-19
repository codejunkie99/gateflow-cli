/**
 * Declaration Mappers Index
 *
 * Re-exports all declaration mapping functions.
 *
 * @module verible/mappers/declaration
 */

// Design units
export {
  visitModuleDeclaration,
  visitPackageDeclaration,
  visitInterfaceDeclaration,
  visitClassDeclaration,
  visitProgramDeclaration,
  visitCheckerDeclaration,
  visitConfigDeclaration,
  
} from './design-units.js';

// Functions and tasks
export {
  visitFunctionDeclaration,
  visitTaskDeclaration,
  visitDpiFunctionDeclaration,
} from './functions.js';

// Typedefs
export { visitTypedefDeclaration } from './typedefs.js';

// Enums
export {
  
  processEnumTypedef,
} from './enums.js';

// Structs and Unions
export {
  
  
  processStructTypedef,
  processUnionTypedef,
} from './structs.js';

// Variables/Signals
export {
  visitNetDeclaration,
  visitDataDeclaration,
  visitVariableDeclaration,
  visitRegDeclaration,
} from './variables.js';

// Parameters and ports
export {
  visitParameterDeclaration,
  visitPortDeclaration,
} from './params-ports.js';

// Procedural and interface constructs
export {
  visitAlwaysStatement,
  visitInitialStatement,
  visitGenerateBlock,
  visitModportDeclaration,
  visitClockingDeclaration,
  visitSequenceDeclaration,
  visitPropertyDeclaration,
  visitCovergroupDeclaration,
  visitConstraintDeclaration,
} from './procedural.js';
