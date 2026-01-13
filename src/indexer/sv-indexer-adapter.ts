/**
 * SV Indexer Adapter
 *
 * This adapter wraps SVIndexer with the same interface as the legacy ProjectIndexer,
 * allowing the CLI commands to use the new indexer without changes.
 *
 * @module indexer/sv-indexer-adapter
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { glob } from 'glob';
import type { EventBus } from '../events/bus.js';
import { SVIndexer, type SVIndexerOptions } from './sv-indexer.js';
import type { ResolvedProject, Declaration } from './types/index.js';
import type {
    ProjectIndex,
    ModuleInfo,
    PackageInfo,
    InterfaceInfo,
    FileMetadata,
    DependencyGraph,
    GraphNode,
    PortInfo,
    ParameterInfo,
} from './index.js';
import { ProjectIndexCache, getProjectIndexCache } from './cache/index.js';
import {
    extractFromIndex,
    createExtractionOptions,
    formatExtractionSummary,
    type ExtractionResult
} from '../memory/extractors/index.js';
import { getKnowledgeStore } from '../memory/KnowledgeStore.js';

// ============================================================================
// Adapter Class
// ============================================================================

/**
 * Adapter that wraps SVIndexer with the legacy ProjectIndexer interface.
 *
 * This allows the CLI commands to use the new SVIndexer without changes,
 * while benefiting from the improved two-layer architecture and semantic analysis.
 */
export class SVIndexerAdapter {
    private svIndexer: SVIndexer;
    private project: ResolvedProject | null = null;
    private legacyIndex: ProjectIndex;
    private filePaths: string[] = [];
    private projectCache: ProjectIndexCache;

    constructor(
        private rootPath: string,
        private bus: EventBus,
        options?: SVIndexerOptions & { cache?: ProjectIndexCache }
    ) {
        this.svIndexer = new SVIndexer({
            ...options,
            verbose: options?.verbose ?? false,
        });
        this.legacyIndex = this.createEmptyIndex();
        this.projectCache = options?.cache ?? getProjectIndexCache();
    }

    // ========================================================================
    // Main Methods
    // ========================================================================

    /**
     * Build full project index by scanning for SV files.
     *
     * This mimics the legacy ProjectIndexer.buildIndex() behavior but uses
     * SVIndexer internally. Uses ProjectIndexCache for fast startup when
     * files haven't changed.
     */
    async buildIndex(options?: {
        patterns?: string[];
        exclude?: string[];
        skipCache?: boolean;
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

        // Convert to absolute paths
        this.filePaths = files.map(f => path.join(this.rootPath, f));

        // Reset index
        this.legacyIndex = this.createEmptyIndex();

        if (this.filePaths.length === 0) {
            this.bus.emit({
                type: 'tool_result',
                tool: 'build_index',
                ok: true,
                summary: 'No SystemVerilog files found',
                duration: Date.now() - startTime
            });
            return this.legacyIndex;
        }

        // Try project cache first (unless explicitly skipped)
        if (!options?.skipCache) {
            const cachedProject = await this.projectCache.get(this.rootPath, this.filePaths);
            if (cachedProject) {
                this.project = cachedProject;
                this.convertToLegacyIndex();

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
                    summary: `Loaded ${files.length} files from cache (${this.legacyIndex.modules.size} modules)${this.project.hasSemanticAnalysis ? ' [semantic]' : ''} [cached]`,
                    duration: Date.now() - startTime
                });

                return this.legacyIndex;
            }
        }

        // Cache miss - do full indexing
        this.bus.emit({
            type: 'status',
            phase: 'indexing',
            label: `Indexing ${this.filePaths.length} files...`
        });

        // Use SVIndexer to parse files
        try {
            this.project = await this.svIndexer.indexFiles(this.filePaths);

            // Convert to legacy format
            this.convertToLegacyIndex();

            // Cache the result
            await this.projectCache.set(this.rootPath, this.filePaths, this.project);

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
                summary: `Indexed ${files.length} files (${this.legacyIndex.modules.size} modules)${this.project.hasSemanticAnalysis ? ' [semantic]' : ''}`,
                duration: Date.now() - startTime
            });

            // Extract knowledge from indexed project
            await this.extractKnowledge();

        } catch (error) {
            this.bus.emit({
                type: 'tool_result',
                tool: 'build_index',
                ok: false,
                summary: `Indexing failed: ${error}`,
                duration: Date.now() - startTime
            });
            throw error;
        }

        return this.legacyIndex;
    }

    // ========================================================================
    // Incremental Update
    // ========================================================================

    /**
     * Update index for a single file.
     *
     * Invalidates the project cache and re-indexes. The file-level caches
     * (FileResultCache, VeribleCache, SlangCache) handle incremental updates
     * for unchanged files, making re-indexing fast.
     */
    async updateFile(filePath: string, event: 'add' | 'change' | 'unlink'): Promise<void> {
        const absolutePath = path.resolve(filePath);

        if (event === 'unlink') {
            // Remove from file list and re-index
            this.filePaths = this.filePaths.filter(f => f !== absolutePath);
        } else if (event === 'add') {
            // Add to file list
            if (!this.filePaths.includes(absolutePath)) {
                this.filePaths.push(absolutePath);
            }
        }
        // For 'change', file is already in the list

        // Invalidate project cache (file changed, cache is stale)
        this.projectCache.invalidate(this.rootPath);

        // Re-index all files
        // File-level caches handle unchanged files efficiently
        if (this.filePaths.length > 0) {
            try {
                this.project = await this.svIndexer.indexFiles(this.filePaths);
                this.convertToLegacyIndex();

                // Update project cache with new state
                await this.projectCache.set(this.rootPath, this.filePaths, this.project);

                // Re-extract knowledge after file update
                await this.extractKnowledge();

                this.bus.emit({
                    type: 'index_update',
                    added: event === 'add' ? 1 : 0,
                    removed: event === 'unlink' ? 1 : 0,
                    modified: event === 'change' ? 1 : 0
                });
            } catch (error) {
                this.bus.emit({
                    type: 'error',
                    message: `Index update failed: ${error}`
                });
            }
        }
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /**
     * Find a module by name.
     */
    findModule(name: string): ModuleInfo | undefined {
        return this.legacyIndex.modules.get(name);
    }

    /**
     * Find a package by name.
     */
    findPackage(name: string): PackageInfo | undefined {
        return this.legacyIndex.packages.get(name);
    }

    /**
     * Find an interface by name.
     */
    findInterface(name: string): InterfaceInfo | undefined {
        return this.legacyIndex.interfaces.get(name);
    }

    /**
     * Get all modules in a file.
     */
    getModulesInFile(filePath: string): ModuleInfo[] {
        const metadata = this.legacyIndex.files.get(path.resolve(filePath));
        if (!metadata) return [];

        return metadata.modules
            .map(name => this.legacyIndex.modules.get(name))
            .filter((m): m is ModuleInfo => m !== undefined);
    }

    /**
     * Search modules by pattern.
     */
    searchModules(pattern: string): ModuleInfo[] {
        const regex = new RegExp(pattern, 'i');
        return Array.from(this.legacyIndex.modules.values())
            .filter(m => regex.test(m.name));
    }

    /**
     * Get index statistics.
     */
    getStats(): {
        files: number;
        modules: number;
        packages: number;
        interfaces: number;
        lastIndexed: number;
        hasSemanticAnalysis?: boolean;
    } {
        return {
            files: this.legacyIndex.files.size,
            modules: this.legacyIndex.modules.size,
            packages: this.legacyIndex.packages.size,
            interfaces: this.legacyIndex.interfaces.size,
            lastIndexed: this.legacyIndex.lastFullIndex,
            hasSemanticAnalysis: this.project?.hasSemanticAnalysis ?? false,
        };
    }

    // ========================================================================
    // Dependencies
    // ========================================================================

    /**
     * Get dependency graph for a module.
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
        const stack: string[] = [];
        const levels = new Map<string, number>();

        const visit = (name: string, level: number): void => {
            if (stack.includes(name)) {
                const cycleStart = stack.indexOf(name);
                graph.cycles.push([...stack.slice(cycleStart), name]);
                return;
            }

            if (visited.has(name)) {
                const existing = levels.get(name) ?? 0;
                levels.set(name, Math.max(existing, level));
                return;
            }

            visited.add(name);
            stack.push(name);

            const module = this.legacyIndex.modules.get(name);
            if (!module) {
                graph.missing.push(name);
                stack.pop();
                return;
            }

            const deps = this.legacyIndex.dependencies.get(name) ?? [];

            for (const dep of deps) {
                visit(dep, level + 1);
            }

            stack.pop();
            levels.set(name, level);

            graph.nodes.set(name, {
                name,
                file: module.file,
                dependencies: deps,
                dependents: this.legacyIndex.dependents.get(name) ?? [],
                level
            });

            graph.compilationOrder.push(name);
        };

        visit(topModule, 0);
        graph.compilationOrder.reverse();

        return graph;
    }

    /**
     * Get topological sort for compilation.
     */
    getCompilationOrder(modules: string[]): string[] {
        const visited = new Set<string>();
        const order: string[] = [];

        const visit = (name: string): void => {
            if (visited.has(name)) return;
            visited.add(name);

            const deps = this.legacyIndex.dependencies.get(name) ?? [];
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
    // Serialization
    // ========================================================================

    /**
     * Export index for persistence or JSON output.
     */
    export(): object {
        return {
            version: this.legacyIndex.version,
            rootPath: this.legacyIndex.rootPath,
            lastFullIndex: this.legacyIndex.lastFullIndex,
            modules: Object.fromEntries(this.legacyIndex.modules),
            packages: Object.fromEntries(this.legacyIndex.packages),
            interfaces: Object.fromEntries(this.legacyIndex.interfaces),
            files: Object.fromEntries(this.legacyIndex.files),
            includeMap: Object.fromEntries(this.legacyIndex.includeMap),
            hasSemanticAnalysis: this.project?.hasSemanticAnalysis ?? false,
            semantic: this.project?.semantic ? {
                source: this.project.semantic.source,
                stats: this.project.semantic.stats,
            } : undefined,
        };
    }

    /**
     * Get the underlying ResolvedProject (new format).
     *
     * This provides access to the rich data from SVIndexer
     * for callers that want to use the new API.
     */
    getProject(): ResolvedProject | null {
        return this.project;
    }

    /**
     * Get the legacy index.
     */
    getIndex(): ProjectIndex {
        return this.legacyIndex;
    }

    // ========================================================================
    // IndexerProvider Interface (for FileChunker integration)
    // ========================================================================

    /**
     * Get declarations from a specific file.
     * Used by FileChunker for accurate AST-based chunk boundaries.
     */
    async getFileDeclarations(filePath: string): Promise<Declaration[]> {
        if (!this.project) return [];

        const normalizedPath = path.resolve(filePath);
        return this.project.declarations.filter(
            decl => path.resolve(decl.location.file) === normalizedPath
        );
    }

    /**
     * Check if the indexer has data for a specific file.
     */
    hasFile(filePath: string): boolean {
        if (!this.project) return false;

        const normalizedPath = path.resolve(filePath);
        return this.project.files.some(
            f => path.resolve(f.path) === normalizedPath
        );
    }

    /**
     * Get all declarations of a specific kind.
     */
    getDeclarationsByKind(kind: Declaration['kind']): Declaration[] {
        if (!this.project) return [];
        return this.project.declarations.filter(decl => decl.kind === kind);
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Extract knowledge from the current project into the knowledge store.
     * This is called after indexing completes to populate the knowledge store
     * with structural information about the project.
     */
    private async extractKnowledge(): Promise<void> {
        // Get global knowledge store
        const knowledgeStore = getKnowledgeStore();

        if (!knowledgeStore || !this.project) {
            return;  // No store available or no project to extract from
        }

        try {
            // Create extraction options
            const options = createExtractionOptions(
                knowledgeStore.getProjectId(),
                {
                    maxItemsPerCategory: 300,  // Reasonable limit for typical projects
                }
            );

            // Perform extraction
            const result = await extractFromIndex(
                this.project,
                knowledgeStore,
                options
            );

            // Emit result event
            this.bus.emit({
                type: 'tool_result',
                tool: 'knowledge_extraction',
                ok: result.success,
                summary: formatExtractionSummary(result)
            });

            // Log detailed stats in debug mode
            if (process.env.DEBUG) {
                console.log('[SVIndexerAdapter] Knowledge extraction:', result);
            }

        } catch (error) {
            // Non-fatal - log and continue
            console.warn(
                '[SVIndexerAdapter] Knowledge extraction failed:',
                error instanceof Error ? error.message : error
            );

            this.bus.emit({
                type: 'error',
                message: `Knowledge extraction failed: ${
                    error instanceof Error ? error.message : 'Unknown error'
                }`,
                recoverable: true
            });
        }
    }

    /**
     * Convert ResolvedProject to legacy ProjectIndex format.
     */
    private convertToLegacyIndex(): void {
        if (!this.project) return;

        this.legacyIndex = this.createEmptyIndex();
        this.legacyIndex.lastFullIndex = Date.now();

        // Group declarations by file
        const declsByFile = new Map<string, Declaration[]>();
        for (const decl of this.project.declarations) {
            const file = decl.location.file;
            if (!declsByFile.has(file)) {
                declsByFile.set(file, []);
            }
            declsByFile.get(file)!.push(decl);
        }

        // Process each file
        for (const fileRecord of this.project.files) {
            const filePath = fileRecord.path;
            const decls = declsByFile.get(filePath) ?? [];

            const moduleNames: string[] = [];
            const packageNames: string[] = [];
            const interfaceNames: string[] = [];
            const imports: string[] = [];
            const includes: string[] = [];

            // Extract modules, packages, interfaces
            for (const decl of decls) {
                if (decl.kind === 'module') {
                    moduleNames.push(decl.name);
                    this.legacyIndex.modules.set(decl.name, this.convertModule(decl, filePath, decls));
                } else if (decl.kind === 'package') {
                    packageNames.push(decl.name);
                    this.legacyIndex.packages.set(decl.name, {
                        name: decl.name,
                        file: filePath,
                        line: decl.location.line,
                        exports: [],
                    });
                } else if (decl.kind === 'interface') {
                    interfaceNames.push(decl.name);
                    this.legacyIndex.interfaces.set(decl.name, this.convertInterface(decl, filePath, decls));
                }
            }

            // Extract imports from references
            const fileRefs = this.project.references.filter(r => r.location.file === filePath);
            for (const ref of fileRefs) {
                if (ref.kind === 'import' && !imports.includes(ref.targetName)) {
                    imports.push(ref.targetName);
                }
            }

            // Extract includes from directives
            const fileDirectives = this.project.directives.filter(d => d.location.file === filePath);
            for (const directive of fileDirectives) {
                if (directive.kind === 'include' && directive.data.kind === 'include') {
                    includes.push(directive.data.path);
                }
            }

            // Store file metadata
            this.legacyIndex.files.set(filePath, {
                path: filePath,
                hash: fileRecord.hash,
                lastModified: Date.now(),
                modules: moduleNames,
                packages: packageNames,
                interfaces: interfaceNames,
                imports,
                includes,
            });
        }

        // Build dependencies from instances
        this.buildDependencies();
    }

    /**
     * Convert a module declaration to legacy ModuleInfo format.
     */
    private convertModule(moduleDecl: Declaration, filePath: string, allDecls: Declaration[]): ModuleInfo {
        const ports: PortInfo[] = [];
        const parameters: ParameterInfo[] = [];
        const instantiates: string[] = [];

        // Find ports and parameters belonging to this module
        for (const decl of allDecls) {
            if (decl.scope.length > 0 && decl.scope[decl.scope.length - 1] === moduleDecl.name) {
                if (decl.kind === 'port' && decl.data.kind === 'port') {
                    ports.push({
                        name: decl.name,
                        direction: decl.data.direction === 'ref' ? 'inout' : decl.data.direction,
                        type: decl.data.portType || 'logic',
                        width: decl.data.width,
                        line: decl.location.line,
                    });
                } else if (decl.kind === 'parameter' && decl.data.kind === 'parameter') {
                    parameters.push({
                        name: decl.name,
                        type: decl.data.paramType,
                        defaultValue: decl.data.defaultValue,
                        line: decl.location.line,
                    });
                }
            }
        }

        // Find instances from this module
        if (this.project) {
            const moduleInstances = this.project.instances.filter(
                inst => inst.parentScope.length > 0 && inst.parentScope[inst.parentScope.length - 1] === moduleDecl.name
            );
            for (const inst of moduleInstances) {
                if (!instantiates.includes(inst.targetName)) {
                    instantiates.push(inst.targetName);
                }
            }
        }

        return {
            name: moduleDecl.name,
            file: filePath,
            line: moduleDecl.location.line,
            ports,
            parameters,
            instantiates,
        };
    }

    /**
     * Convert an interface declaration to legacy InterfaceInfo format.
     */
    private convertInterface(ifaceDecl: Declaration, filePath: string, allDecls: Declaration[]): InterfaceInfo {
        const modports: string[] = [];

        // Find modports belonging to this interface
        for (const decl of allDecls) {
            if (decl.kind === 'modport' && decl.scope.length > 0 && decl.scope[decl.scope.length - 1] === ifaceDecl.name) {
                modports.push(decl.name);
            }
        }

        return {
            name: ifaceDecl.name,
            file: filePath,
            line: ifaceDecl.location.line,
            modports,
        };
    }

    /**
     * Build dependency relationships between modules.
     */
    private buildDependencies(): void {
        this.legacyIndex.dependencies.clear();
        this.legacyIndex.dependents.clear();

        for (const [name, module] of this.legacyIndex.modules) {
            const deps = module.instantiates.filter(inst =>
                this.legacyIndex.modules.has(inst)
            );

            this.legacyIndex.dependencies.set(name, deps);

            for (const dep of deps) {
                const existing = this.legacyIndex.dependents.get(dep) ?? [];
                existing.push(name);
                this.legacyIndex.dependents.set(dep, existing);
            }
        }
    }

    /**
     * Create an empty legacy index.
     */
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
            version: 3,  // Bump version for SVIndexer-based adapter
        };
    }
}
