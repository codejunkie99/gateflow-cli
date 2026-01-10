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
  type VisitChildrenFn,
} from './design-units.js';

// Functions and tasks
export {
  visitFunctionDeclaration,
  visitTaskDeclaration,
} from './functions.js';

// Typedefs
export { visitTypedefDeclaration } from './typedefs.js';

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
} from './procedural.js';
