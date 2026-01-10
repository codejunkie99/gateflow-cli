/**
 * Project Index (LEGACY)
 *
 * @deprecated This module is deprecated and will be removed in a future version.
 * Please use `SVIndexer` from `./sv-indexer.js` instead.
 *
 * ## Migration Guide
 *
 * ```typescript
 * // Old (deprecated):
 * import { ProjectIndexer } from './indexer/index.js';
 * const indexer = new ProjectIndexer(rootPath, bus);
 * const index = await indexer.buildIndex();
 *
 * // New (recommended):
 * import { SVIndexer, createSVIndexer } from './indexer/sv-indexer.js';
 * const indexer = createSVIndexer();
 * const project = await indexer.indexProject('/path/to/project.f');
 *
 * // Or with specific files:
 * const project = await indexer.indexFiles(['/path/to/file1.sv', '/path/to/file2.sv']);
 * ```
 *
 * The new SVIndexer provides:
 * - Two-layer architecture (syntactic + semantic analysis)
 * - Better type definitions
 * - slang integration for accurate resolution
 * - Query API for IDE features
 *
 * This legacy module is kept for backwards compatibility only.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import type { EventBus } from '../events/bus.js';
import {
  FileUnderstander,
} from './understander/index.js';
import type {
  FileUnderstanderResult,
  Declaration,
  Instance,
} from './types/index.js';

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
// Types
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
// Project Indexer
// ============================================================================

/**
 * @deprecated Use `SVIndexer` from `./sv-indexer.js` instead.
 * This class will be removed in a future version.
 */
export class ProjectIndexer {
    private understander: FileUnderstander;
    private index: ProjectIndex;
    private includePaths: string[];

    /**
     * @deprecated Use `SVIndexer` from `./sv-indexer.js` instead.
     */
    constructor(
        private rootPath: string,
        private bus: EventBus,
        options?: {
            includePaths?: string[];
        }
    ) {
        // Runtime deprecation warning
        console.warn(
            '[DEPRECATED] ProjectIndexer is deprecated and will be removed in a future version. ' +
            'Please use SVIndexer from ./sv-indexer.js instead. ' +
            'See: https://github.com/yourrepo/migration-guide'
        );

        this.understander = new FileUnderstander();
        this.includePaths = options?.includePaths ?? ['src', 'rtl', 'include'];
        this.index = this.createEmptyIndex();
    }

    // ========================================================================
    // Full Index
    // ========================================================================

    /**
     * Build full project index
     */
    async buildIndex(options?: {
        patterns?: string[];
        exclude?: string[];
    }): Promise<ProjectIndex> {
        const patterns = options?.patterns ?? ['**/*.{sv,svh,v,vh}'];
        const exclude = options?.exclude ?? [
            '**/node_modules/**',
            '**/obj_dir/**',
            '**/.git/**',
            '**/dist/**'
        ];

        this.bus.emit({
            type: 'status',
            phase: 'indexing',
            label: 'Building project index...'
        });

        const startTime = Date.now();

        // Find all files
        const files: string[] = [];
        for (const pattern of patterns) {
            const matches = await glob(pattern, {
                cwd: this.rootPath,
                ignore: exclude,
                nodir: true
            });
            files.push(...matches);
        }

        // Reset index
        this.index = this.createEmptyIndex();

        // Parse each file
        let processed = 0;
        for (const file of files) {
            const fullPath = path.join(this.rootPath, file);
            await this.indexFile(fullPath);

            processed++;
            if (processed % 10 === 0) {
                this.bus.emit({
                    type: 'status',
                    phase: 'indexing',
                    label: `Indexing... ${processed}/${files.length}`
                });
            }
        }

        // Build dependency graph
        this.buildDependencies();

        // Resolve includes
        await this.resolveIncludes();

        this.index.lastFullIndex = Date.now();

        this.bus.emit({
            type: 'index_update',
            added: files.length,
            removed: 0,
            modified: 0
        });

        this.bus.emit({
            type: 'tool_result',
            tool: 'build_index',
            ok: true,
            summary: `Indexed ${files.length} files (${this.index.modules.size} modules)`,
            duration: Date.now() - startTime
        });

        return this.index;
    }

    // ========================================================================
    // Incremental Update
    // ========================================================================

    /**
     * Update index for a single file
     */
    async updateFile(filePath: string, event: 'add' | 'change' | 'unlink'): Promise<void> {
        const absolutePath = path.resolve(filePath);

        if (event === 'unlink') {
            this.removeFileFromIndex(absolutePath);
            return;
        }

        // Check if content actually changed
        const content = await fs.readFile(absolutePath, 'utf-8');
        const hash = this.hashContent(content);

        const existing = this.index.files.get(absolutePath);
        if (existing && existing.hash === hash) {
            return; // No change
        }

        // Remove old entries
        if (existing) {
            this.removeFileFromIndex(absolutePath);
        }

        // Re-index file
        const indexResult = await this.indexFile(absolutePath);

        // Rebuild affected dependencies
        this.buildDependencies();

        this.bus.emit({
            type: 'index_update',
            added: event === 'add' ? 1 : 0,
            removed: 0,
            modified: event === 'change' ? 1 : 0,
            ...(indexResult.success ? { modules: indexResult.modules } : { error: indexResult.error })
        });
    }

    /**
     * Index a single file using the new Verible-based understander
     */
    private async indexFile(filePath: string): Promise<{ success: boolean; modules: string[]; error?: string }> {
        try {
            const result = await this.understander.understand(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            const stats = await fs.stat(filePath);

            // Convert new format to legacy format
            const parseResult = this.convertToLegacyFormat(result, filePath);

            // Store file metadata
            this.index.files.set(filePath, {
                path: filePath,
                hash: this.hashContent(content),
                lastModified: stats.mtimeMs,
                modules: parseResult.modules.map(m => m.name),
                packages: parseResult.packages.map(p => p.name),
                interfaces: parseResult.interfaces.map(i => i.name),
                imports: parseResult.imports,
                includes: parseResult.includes
            });

            // Store modules
            for (const module of parseResult.modules) {
                this.index.modules.set(module.name, module);
            }

            // Store packages
            for (const pkg of parseResult.packages) {
                this.index.packages.set(pkg.name, pkg);
            }

            // Store interfaces
            for (const iface of parseResult.interfaces) {
                this.index.interfaces.set(iface.name, iface);
            }

            return { success: true, modules: parseResult.modules.map(m => m.name) };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to index ${filePath}:`, errorMsg);
            return { success: false, modules: [], error: errorMsg };
        }
    }

    /**
     * Convert new FileUnderstanderResult to legacy FileParseResult format
     */
    private convertToLegacyFormat(result: FileUnderstanderResult, filePath: string): FileParseResult {
        const modules: ModuleInfo[] = [];
        const packages: PackageInfo[] = [];
        const interfaces: InterfaceInfo[] = [];
        const imports: string[] = [];
        const includes: string[] = [];
        const instantiations: string[] = [];

        // Group declarations by scope to find ports/params for each module
        const moduleDecls = result.declarations.filter(d => d.kind === 'module');
        const packageDecls = result.declarations.filter(d => d.kind === 'package');
        const interfaceDecls = result.declarations.filter(d => d.kind === 'interface');
        const portDecls = result.declarations.filter(d => d.kind === 'port');
        const paramDecls = result.declarations.filter(d => d.kind === 'parameter');
        const modportDecls = result.declarations.filter(d => d.kind === 'modport');

        // Build modules
        for (const moduleDecl of moduleDecls) {
            const modulePorts = portDecls
                .filter(p => p.scope.length > 0 && p.scope[p.scope.length - 1] === moduleDecl.name)
                .map(p => this.convertPort(p));

            const moduleParams = paramDecls
                .filter(p => p.scope.length > 0 && p.scope[p.scope.length - 1] === moduleDecl.name)
                .map(p => this.convertParameter(p));

            // Find instantiations for this module
            const moduleInstances = result.instances
                .filter(i => i.parentScope.length > 0 && i.parentScope[i.parentScope.length - 1] === moduleDecl.name)
                .map(i => i.targetName);

            // Deduplicate instantiations
            const uniqueInstances = [...new Set(moduleInstances)];

            modules.push({
                name: moduleDecl.name,
                file: filePath,
                line: moduleDecl.location.line,
                ports: modulePorts,
                parameters: moduleParams,
                instantiates: uniqueInstances
            });
        }

        // Build packages
        for (const pkgDecl of packageDecls) {
            packages.push({
                name: pkgDecl.name,
                file: filePath,
                line: pkgDecl.location.line,
                exports: []
            });
        }

        // Build interfaces
        for (const ifaceDecl of interfaceDecls) {
            const ifaceModports = modportDecls
                .filter(m => m.scope.length > 0 && m.scope[m.scope.length - 1] === ifaceDecl.name)
                .map(m => m.name);

            interfaces.push({
                name: ifaceDecl.name,
                file: filePath,
                line: ifaceDecl.location.line,
                modports: ifaceModports
            });
        }

        // Extract imports from references
        for (const ref of result.references) {
            if (ref.kind === 'import') {
                // targetName is the package name for import references
                const pkgName = ref.targetName;
                if (pkgName && !imports.includes(pkgName)) {
                    imports.push(pkgName);
                }
            }
        }

        // Extract includes from directives
        for (const directive of result.directives) {
            if (directive.kind === 'include' && directive.data.kind === 'include') {
                includes.push(directive.data.path);
            }
        }

        // Extract all instantiations
        for (const instance of result.instances) {
            if (!instantiations.includes(instance.targetName)) {
                instantiations.push(instance.targetName);
            }
        }

        return {
            file: filePath,
            modules,
            packages,
            interfaces,
            imports,
            includes,
            instantiations
        };
    }

    /**
     * Convert new Declaration (port) to legacy PortInfo
     */
    private convertPort(decl: Declaration): PortInfo {
        const data = decl.data;
        if (data.kind !== 'port') {
            return {
                name: decl.name,
                direction: 'input',
                type: 'logic',
                line: decl.location.line
            };
        }

        return {
            name: decl.name,
            direction: data.direction === 'ref' ? 'inout' : data.direction,
            type: data.portType || 'logic',
            width: data.width,
            line: decl.location.line
        };
    }

    /**
     * Convert new Declaration (parameter) to legacy ParameterInfo
     */
    private convertParameter(decl: Declaration): ParameterInfo {
        const data = decl.data;
        if (data.kind !== 'parameter') {
            return {
                name: decl.name,
                line: decl.location.line
            };
        }

        return {
            name: decl.name,
            type: data.paramType,
            defaultValue: data.defaultValue,
            line: decl.location.line
        };
    }

    /**
     * Remove file entries from index
     */
    private removeFileFromIndex(filePath: string): void {
        const metadata = this.index.files.get(filePath);
        if (!metadata) return;

        // Remove modules
        for (const name of metadata.modules) {
            this.index.modules.delete(name);
        }

        // Remove packages
        for (const name of metadata.packages) {
            this.index.packages.delete(name);
        }

        // Remove interfaces
        for (const name of metadata.interfaces) {
            this.index.interfaces.delete(name);
        }

        // Remove file metadata
        this.index.files.delete(filePath);
    }

    // ========================================================================
    // Dependencies
    // ========================================================================

    /**
     * Build dependency relationships
     */
    private buildDependencies(): void {
        this.index.dependencies.clear();
        this.index.dependents.clear();

        for (const [name, module] of this.index.modules) {
            const deps = module.instantiates.filter(inst =>
                this.index.modules.has(inst)
            );

            this.index.dependencies.set(name, deps);

            // Build reverse mapping
            for (const dep of deps) {
                const existing = this.index.dependents.get(dep) ?? [];
                existing.push(name);
                this.index.dependents.set(dep, existing);
            }
        }
    }

    /**
     * Get dependency graph for a module
     */
    getDependencyGraph(topModule: string): DependencyGraph {
        const graph: DependencyGraph = {
            topModule,
            nodes: new Map(),
            compilationOrder: [],
            cycles: [],
            missing: []
        };

        const visited = new Set<string>();
        const stack: string[] = [];  // For cycle detection
        const levels = new Map<string, number>();

        const visit = (name: string, level: number): void => {
            if (stack.includes(name)) {
                // Cycle detected
                const cycleStart = stack.indexOf(name);
                graph.cycles.push([...stack.slice(cycleStart), name]);
                return;
            }

            if (visited.has(name)) {
                // Update level if we found a longer path
                const existing = levels.get(name) ?? 0;
                levels.set(name, Math.max(existing, level));
                return;
            }

            visited.add(name);
            stack.push(name);

            const module = this.index.modules.get(name);
            if (!module) {
                graph.missing.push(name);
                stack.pop();
                return;
            }

            const deps = this.index.dependencies.get(name) ?? [];

            // Visit dependencies first
            for (const dep of deps) {
                visit(dep, level + 1);
            }

            stack.pop();
            levels.set(name, level);

            // Add to graph
            graph.nodes.set(name, {
                name,
                file: module.file,
                dependencies: deps,
                dependents: this.index.dependents.get(name) ?? [],
                level
            });

            graph.compilationOrder.push(name);
        };

        visit(topModule, 0);

        // Reverse compilation order (dependencies first)
        graph.compilationOrder.reverse();

        return graph;
    }

    /**
     * Get topological sort for compilation
     */
    getCompilationOrder(modules: string[]): string[] {
        const visited = new Set<string>();
        const order: string[] = [];

        const visit = (name: string): void => {
            if (visited.has(name)) return;
            visited.add(name);

            const deps = this.index.dependencies.get(name) ?? [];
            for (const dep of deps) {
                visit(dep);
            }

            order.push(name);
        };

        for (const module of modules) {
            visit(module);
        }

        return order;
    }

    // ========================================================================
    // Include Resolution
    // ========================================================================

    /**
     * Resolve all include paths
     */
    private async resolveIncludes(): Promise<void> {
        this.index.includeMap.clear();

        const allIncludes = new Set<string>();
        for (const metadata of this.index.files.values()) {
            for (const inc of metadata.includes) {
                allIncludes.add(inc);
            }
        }

        for (const includePath of allIncludes) {
            const resolved = await this.resolveInclude(includePath);
            if (resolved) {
                this.index.includeMap.set(includePath, resolved);
            }
        }
    }

    /**
     * Resolve a single include path
     */
    async resolveInclude(includePath: string): Promise<string | null> {
        // Check in configured include paths
        for (const base of this.includePaths) {
            const candidate = path.join(this.rootPath, base, includePath);
            try {
                await fs.access(candidate);
                return candidate;
            } catch {
                // File doesn't exist in this include path - try next
            }
        }

        // Check in project root
        const rootCandidate = path.join(this.rootPath, includePath);
        try {
            await fs.access(rootCandidate);
            return rootCandidate;
        } catch {
            // File doesn't exist in project root either
        }

        return null;
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /**
     * Find a module by name
     */
    findModule(name: string): ModuleInfo | undefined {
        return this.index.modules.get(name);
    }

    /**
     * Find a package by name
     */
    findPackage(name: string): PackageInfo | undefined {
        return this.index.packages.get(name);
    }

    /**
     * Find an interface by name
     */
    findInterface(name: string): InterfaceInfo | undefined {
        return this.index.interfaces.get(name);
    }

    /**
     * Get all modules in a file
     */
    getModulesInFile(filePath: string): ModuleInfo[] {
        const metadata = this.index.files.get(path.resolve(filePath));
        if (!metadata) return [];

        return metadata.modules
            .map(name => this.index.modules.get(name))
            .filter((m): m is ModuleInfo => m !== undefined);
    }

    /**
     * Search modules by pattern
     */
    searchModules(pattern: string): ModuleInfo[] {
        const regex = new RegExp(pattern, 'i');
        return Array.from(this.index.modules.values())
            .filter(m => regex.test(m.name));
    }

    /**
     * Get index statistics
     */
    getStats(): {
        files: number;
        modules: number;
        packages: number;
        interfaces: number;
        lastIndexed: number;
    } {
        return {
            files: this.index.files.size,
            modules: this.index.modules.size,
            packages: this.index.packages.size,
            interfaces: this.index.interfaces.size,
            lastIndexed: this.index.lastFullIndex
        };
    }

    // ========================================================================
    // Serialization
    // ========================================================================

    /**
     * Export index for persistence
     */
    export(): object {
        return {
            version: this.index.version,
            rootPath: this.index.rootPath,
            lastFullIndex: this.index.lastFullIndex,
            modules: Object.fromEntries(this.index.modules),
            packages: Object.fromEntries(this.index.packages),
            interfaces: Object.fromEntries(this.index.interfaces),
            files: Object.fromEntries(this.index.files),
            includeMap: Object.fromEntries(this.index.includeMap)
        };
    }

    /**
     * Import index from persistence
     */
    import(data: any): void {
        if (data.version !== this.index.version) {
            // Version mismatch - rebuild needed
            return;
        }

        this.index.rootPath = data.rootPath;
        this.index.lastFullIndex = data.lastFullIndex;
        this.index.modules = new Map(Object.entries(data.modules ?? {}));
        this.index.packages = new Map(Object.entries(data.packages ?? {}));
        this.index.interfaces = new Map(Object.entries(data.interfaces ?? {}));
        this.index.files = new Map(Object.entries(data.files ?? {}));
        this.index.includeMap = new Map(Object.entries(data.includeMap ?? {}));

        // Rebuild dependencies from modules
        this.buildDependencies();
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private createEmptyIndex(): ProjectIndex {
        return {
            modules: new Map(),
            packages: new Map(),
            interfaces: new Map(),
            files: new Map(),
            dependencies: new Map(),
            dependents: new Map(),
            includeMap: new Map(),
            rootPath: this.rootPath,
            lastFullIndex: 0,
            version: 2  // Bumped version for new Verible-based indexer
        };
    }

    private hashContent(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Get the current index
     */
    getIndex(): ProjectIndex {
        return this.index;
    }
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
