/**
 * Resolver Module - Cross-File Connection Resolution
 *
 * After parsing all files individually, the resolver connects them together:
 * - Instances → Module declarations
 * - References → Target declarations
 * - Includes → Actual file paths
 *
 * ## Components
 *
 * ### Declaration Index
 * Fast lookup of declarations by ID, name, kind, or file.
 *
 * ### Project Resolver
 * Orchestrates resolution of all connections and builds:
 * - Module hierarchy tree
 * - File dependency graph
 *
 * ## Resolution Process
 *
 * ```
 * 1. Parse all files → FileUnderstanderResult[]
 * 2. Add to resolver → builds declaration index
 * 3. Resolve connections:
 *    - Instance.resolvedId → target module's declaration ID
 *    - Reference.resolvedId → target entity's declaration ID
 *    - Include.resolvedPath → actual file path
 * 4. Build relationships:
 *    - Hierarchy: module instantiation tree
 *    - Dependencies: file-to-file dependency graph
 * ```
 *
 * @example
 * ```typescript
 * import {
 *   ProjectResolver,
 *   createDeclarationIndex
 * } from './resolver/index.js';
 *
 * // Parse all files first
 * const parseResults = await understandFiles(recipe.files);
 *
 * // Create resolver with recipe
 * const resolver = new ProjectResolver(recipe);
 *
 * // Add parsed files
 * for (const result of parseResults) {
 *   if (result.success) {
 *     resolver.addFile(result.result);
 *   }
 * }
 *
 * // Resolve all connections
 * const project = await resolver.resolve();
 *
 * // Access results
 * console.log(`Files: ${project.files.length}`);
 * console.log(`Declarations: ${project.declarations.length}`);
 * console.log(`Top modules: ${project.hierarchy.length}`);
 * console.log(`Dependencies: ${project.dependencies.length}`);
 *
 * // Custom queries using index
 * const index = resolver.getIndex();
 * const counter = index.getByNameAndKind('counter', 'module');
 * ```
 *
 * @module resolver
 */

// ============================================================================
// Declaration Index
// ============================================================================

export {
  DeclarationIndex,
  
  
} from './declaration-index.js';

// ============================================================================
// Project Resolver
// ============================================================================

export {
  ProjectResolver,
  
} from './project-resolver.js';

// ============================================================================
// Macro Index
// ============================================================================

;
