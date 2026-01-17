/**
 * Project Index Types and Re-exports
 *
 * This module provides legacy type definitions for backwards compatibility
 * and re-exports from the new indexer modules.
 *
 * ## New Architecture
 *
 * Use `SVIndexer` from `./sv-indexer.js` for indexing:
 * ```typescript
 * import { SVIndexer, createSVIndexer } from './indexer/sv-indexer.js';
 * const indexer = createSVIndexer();
 * const project = await indexer.indexProject('/path/to/project.f');
 * ```
 *
 * Or use `SVIndexerAdapter` for CLI integration:
 * ```typescript
 * import { SVIndexerAdapter } from './indexer/sv-indexer-adapter.js';
 * const adapter = new SVIndexerAdapter(rootPath, bus);
 * const index = await adapter.buildIndex();
 * ```
 */

// ============================================================================
// Legacy Types (for backwards compatibility)
// ============================================================================

export interface PortInfo {
    name: string;
    direction: 'input' | 'output' | 'inout';
    type: string;
    width?: string;
    line: number;
}

export interface ParameterInfo {
    name: string;
    type?: string;
    defaultValue?: string;
    line: number;
}

export interface ModuleInfo {
    name: string;
    file: string;
    line: number;
    ports: PortInfo[];
    parameters: ParameterInfo[];
    instantiates: string[];  // Modules instantiated by this module
}

export interface PackageInfo {
    name: string;
    file: string;
    line: number;
    exports: string[];  // Exported items
}

export interface InterfaceInfo {
    name: string;
    file: string;
    line: number;
    modports: string[];
}

export interface FileParseResult {
    file: string;
    modules: ModuleInfo[];
    packages: PackageInfo[];
    interfaces: InterfaceInfo[];
    imports: string[];       // Package imports
    includes: string[];      // Include file references
    instantiations: string[]; // All module instantiations
}

// ============================================================================
// Index Types
// ============================================================================

export interface ProjectIndex {
    // Definitions
    modules: Map<string, ModuleInfo>;
    packages: Map<string, PackageInfo>;
    interfaces: Map<string, InterfaceInfo>;

    // File metadata
    files: Map<string, FileMetadata>;

    // Dependencies
    dependencies: Map<string, string[]>;  // module -> [dependency modules]
    dependents: Map<string, string[]>;    // module -> [modules that depend on it]

    // Include resolution
    includeMap: Map<string, string>;      // include path -> resolved file

    // Metadata
    rootPath: string;
    lastFullIndex: number;
    version: number;
}

export interface FileMetadata {
    path: string;
    hash: string;
    lastModified: number;
    modules: string[];
    packages: string[];
    interfaces: string[];
    imports: string[];
    includes: string[];
}

/**
 * Legacy module-level dependency graph.
 * Used by SVIndexerAdapter.getDependencyGraph() for backwards compatibility.
 *
 * Note: For file-level dependencies, use DependencyGraph from analyzer/
 */
export interface DependencyGraph {
    topModule: string;
    nodes: Map<string, GraphNode>;
    compilationOrder: string[];
    cycles: string[][];
    missing: string[];
}

export interface GraphNode {
    name: string;
    file: string;
    dependencies: string[];
    dependents: string[];
    level: number;  // 0 = leaf, higher = depends on more
}

// ============================================================================
// Re-exports
// ============================================================================

// Verible integration
export * from './verible/index.js';

// New understander with Verible support
export {
  FileUnderstander,
  createFileUnderstander,
  understandFiles,
  type FileUnderstanderOptions,
  type UnderstandFilesResult,
} from './understander/index.js';
