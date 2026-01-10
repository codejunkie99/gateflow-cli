/**
 * Slang Integration Module
 *
 * Provides semantic analysis capabilities using slang, a SystemVerilog compiler
 * frontend. This module is Layer B of the two-layer indexer architecture.
 *
 * ## Architecture
 *
 * ```
 * Recipe ──► slang subprocess ──► JSON AST ──► Mapper ──► Declarations/References
 *                │                                             │
 *                ▼                                             ▼
 *            Diagnostics                                   Cache
 * ```
 *
 * ## What slang provides
 *
 * - **Preprocessor evaluation**: Expands macros, evaluates `ifdef/`ifndef
 * - **Full parsing**: Complete SystemVerilog syntax support
 * - **Elaboration**: Resolves parameters, generates instances
 * - **Type checking**: Validates expressions and connections
 * - **Name resolution**: Resolves all symbol references
 *
 * ## Usage
 *
 * @example Basic usage
 * ```typescript
 * import { SlangBackend, canUseSlang } from './slang/index.js';
 *
 * if (await canUseSlang()) {
 *   const backend = new SlangBackend();
 *   const result = await backend.analyzeRecipe(recipe);
 *
 *   if (result.success) {
 *     // All declarations have proper IDs and locations
 *     for (const decl of result.declarations) {
 *       console.log(`${decl.kind}: ${decl.name} at ${decl.location.file}:${decl.location.line}`);
 *     }
 *
 *     // All references are resolved
 *     for (const ref of result.references) {
 *       if (ref.resolvedId) {
 *         console.log(`${ref.targetName} resolves to ${ref.resolvedId}`);
 *       }
 *     }
 *
 *     // Instances have evaluated parameters
 *     for (const inst of result.instances) {
 *       console.log(`Instance ${inst.instanceName} of ${inst.targetName}`);
 *       if (inst.paramOverrides) {
 *         console.log(`  Parameters: ${JSON.stringify(inst.paramOverrides)}`);
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * @example Quick one-off analysis
 * ```typescript
 * import { analyzeWithSlang } from './slang/index.js';
 *
 * const result = await analyzeWithSlang(recipe, {
 *   topModule: 'top',
 *   detailedTypes: true,
 * });
 * ```
 *
 * @module slang
 */

// ============================================================================
// Main Backend Exports
// ============================================================================

export {
  // Main class
  SlangBackend,

  // Convenience functions
  getSlangBackend,
  analyzeWithSlang,
  canUseSlang,

  // Types
  type SlangBackendResult,
  type SlangBackendOptions,
} from './slang-backend.js';

// ============================================================================
// Binary Management Exports
// ============================================================================

export {
  // Class
  SlangBinaryManager,

  // Singleton instance
  slangBinaryManager,

  // Convenience functions
  findSlangBinary,
  isSlangAvailable,
  getSlangVersion,
  downloadSlang,

  // Types
  type BinaryLocation,
  type Platform,
  type Architecture,
  type DownloadProgressCallback,
} from './binary-manager.js';

// ============================================================================
// Subprocess Exports
// ============================================================================

export {
  // Functions
  buildSlangArgs,
  recipeToSlangArgs,
  runSlang,
  runSlangForRecipe,
  runSlangOnFiles,
  canRunSlang,

  // Types
  type SlangExecOptions,
  type SlangCommandArgs,
} from './subprocess.js';

// ============================================================================
// Mapper Exports
// ============================================================================

export {
  // Main function
  mapSlangAst,

  // Resolution helpers
  resolveReferences,
  resolveInstances,

  // Types
  type SlangMappingResult,
} from './slang-mapper.js';

// ============================================================================
// Cache Exports
// ============================================================================

export {
  // Class
  SlangCache,

  // Default instance
  slangCache,

  // Factory
  createPersistentCache,

  // Types
  type CacheEntry,
  type CacheOptions,
  type CacheStats,
} from './slang-cache.js';

// ============================================================================
// Type Exports
// ============================================================================

export {
  // Core types
  type SlangCompilation,
  type SlangDesignRoot,
  type SlangSymbolBase,
  type SlangLocation,

  // Symbol types
  type SlangSymbol,
  type SlangModuleSymbol,
  type SlangPackageSymbol,
  type SlangInterfaceSymbol,
  type SlangClassSymbol,
  type SlangProgramSymbol,
  type SlangInstanceSymbol,
  type SlangPortSymbol,
  type SlangParameterSymbol,
  type SlangVariableSymbol,
  type SlangNetSymbol,
  type SlangFunctionSymbol,
  type SlangTaskSymbol,
  type SlangTypeAliasSymbol,
  type SlangEnumSymbol,
  type SlangStructSymbol,
  type SlangGenericSymbol,

  // Helper types
  type SlangParameterValue,
  type SlangConnection,
  type SlangTypeInfo,
  type SlangArrayDimension,
  type SlangFieldInfo,
  type SlangArgumentSymbol,
  type SlangEnumValue,
  type SlangFieldSymbol,

  // Result types
  type SlangDiagnostic,
  type SlangParseResult,

  // Type guards
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
