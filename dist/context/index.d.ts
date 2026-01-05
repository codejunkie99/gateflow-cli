/**
 * Project Index
 * Maintains an index of all modules, packages, interfaces in the project
 */
import { type ModuleInfo, type PackageInfo, type InterfaceInfo } from './parser.js';
import type { EventBus } from '../events/bus.js';
export interface ProjectIndex {
    modules: Map<string, ModuleInfo>;
    packages: Map<string, PackageInfo>;
    interfaces: Map<string, InterfaceInfo>;
    files: Map<string, FileMetadata>;
    dependencies: Map<string, string[]>;
    dependents: Map<string, string[]>;
    includeMap: Map<string, string>;
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
    level: number;
}
export declare class ProjectIndexer {
    private rootPath;
    private bus;
    private parser;
    private index;
    private includePaths;
    constructor(rootPath: string, bus: EventBus, options?: {
        includePaths?: string[];
    });
    /**
     * Build full project index
     */
    buildIndex(options?: {
        patterns?: string[];
        exclude?: string[];
    }): Promise<ProjectIndex>;
    /**
     * Update index for a single file
     */
    updateFile(filePath: string, event: 'add' | 'change' | 'unlink'): Promise<void>;
    /**
     * Index a single file
     * FIX B: Propagate errors instead of swallowing them, so callers can handle failures
     */
    private indexFile;
    /**
     * Remove file entries from index
     */
    private removeFileFromIndex;
    /**
     * Build dependency relationships
     */
    private buildDependencies;
    /**
     * Get dependency graph for a module
     */
    getDependencyGraph(topModule: string): DependencyGraph;
    /**
     * Get topological sort for compilation
     */
    getCompilationOrder(modules: string[]): string[];
    /**
     * Resolve all include paths
     */
    private resolveIncludes;
    /**
     * Resolve a single include path
     */
    resolveInclude(includePath: string): Promise<string | null>;
    /**
     * Find a module by name
     */
    findModule(name: string): ModuleInfo | undefined;
    /**
     * Find a package by name
     */
    findPackage(name: string): PackageInfo | undefined;
    /**
     * Find an interface by name
     */
    findInterface(name: string): InterfaceInfo | undefined;
    /**
     * Get all modules in a file
     */
    getModulesInFile(filePath: string): ModuleInfo[];
    /**
     * Search modules by pattern
     */
    searchModules(pattern: string): ModuleInfo[];
    /**
     * Get index statistics
     */
    getStats(): {
        files: number;
        modules: number;
        packages: number;
        interfaces: number;
        lastIndexed: number;
    };
    /**
     * Export index for persistence
     */
    export(): object;
    /**
     * Import index from persistence
     */
    import(data: any): void;
    private createEmptyIndex;
    private hashContent;
    /**
     * Get the current index
     */
    getIndex(): ProjectIndex;
}
export * from './parser.js';
