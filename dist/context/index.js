/**
 * Project Index
 * Maintains an index of all modules, packages, interfaces in the project
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import { SVParser } from './parser.js';
// ============================================================================
// Project Indexer
// ============================================================================
export class ProjectIndexer {
    rootPath;
    bus;
    parser;
    index;
    includePaths;
    constructor(rootPath, bus, options) {
        this.rootPath = rootPath;
        this.bus = bus;
        this.parser = new SVParser();
        this.includePaths = options?.includePaths ?? ['src', 'rtl', 'include'];
        this.index = this.createEmptyIndex();
    }
    // ========================================================================
    // Full Index
    // ========================================================================
    /**
     * Build full project index
     */
    async buildIndex(options) {
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
        const files = [];
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
            await this.indexFile(fullPath); // Result ignored during bulk indexing
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
    async updateFile(filePath, event) {
        const absolutePath = path.resolve(filePath);
        const relativePath = path.relative(this.rootPath, absolutePath);
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
        // Re-index file - FIX B: capture result for better error handling
        const indexResult = await this.indexFile(absolutePath);
        // Rebuild affected dependencies
        this.buildDependencies();
        this.bus.emit({
            type: 'index_update',
            added: event === 'add' ? 1 : 0,
            removed: 0,
            modified: event === 'change' ? 1 : 0,
            // Include indexing result info
            ...(indexResult.success ? { modules: indexResult.modules } : { error: indexResult.error })
        });
    }
    /**
     * Index a single file
     * FIX B: Propagate errors instead of swallowing them, so callers can handle failures
     */
    async indexFile(filePath) {
        try {
            const result = await this.parser.parseFile(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            const stats = await fs.stat(filePath);
            // Store file metadata
            this.index.files.set(filePath, {
                path: filePath,
                hash: this.hashContent(content),
                lastModified: stats.mtimeMs,
                modules: result.modules.map(m => m.name),
                packages: result.packages.map(p => p.name),
                interfaces: result.interfaces.map(i => i.name),
                imports: result.imports,
                includes: result.includes
            });
            // Store modules
            for (const module of result.modules) {
                this.index.modules.set(module.name, module);
            }
            // Store packages
            for (const pkg of result.packages) {
                this.index.packages.set(pkg.name, pkg);
            }
            // Store interfaces
            for (const iface of result.interfaces) {
                this.index.interfaces.set(iface.name, iface);
            }
            return { success: true, modules: result.modules.map(m => m.name) };
        }
        catch (error) {
            // Log but don't fail on parse errors - return failure info
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to index ${filePath}:`, errorMsg);
            return { success: false, modules: [], error: errorMsg };
        }
    }
    /**
     * Remove file entries from index
     */
    removeFileFromIndex(filePath) {
        const metadata = this.index.files.get(filePath);
        if (!metadata)
            return;
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
    buildDependencies() {
        this.index.dependencies.clear();
        this.index.dependents.clear();
        for (const [name, module] of this.index.modules) {
            const deps = module.instantiates.filter(inst => this.index.modules.has(inst));
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
    getDependencyGraph(topModule) {
        const graph = {
            topModule,
            nodes: new Map(),
            compilationOrder: [],
            cycles: [],
            missing: []
        };
        const visited = new Set();
        const stack = []; // For cycle detection
        const levels = new Map();
        const visit = (name, level) => {
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
    getCompilationOrder(modules) {
        const visited = new Set();
        const order = [];
        const visit = (name) => {
            if (visited.has(name))
                return;
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
    async resolveIncludes() {
        this.index.includeMap.clear();
        const allIncludes = new Set();
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
    async resolveInclude(includePath) {
        // Check in configured include paths
        for (const base of this.includePaths) {
            const candidate = path.join(this.rootPath, base, includePath);
            try {
                await fs.access(candidate);
                return candidate;
            }
            catch { }
        }
        // Check in project root
        const rootCandidate = path.join(this.rootPath, includePath);
        try {
            await fs.access(rootCandidate);
            return rootCandidate;
        }
        catch { }
        return null;
    }
    // ========================================================================
    // Queries
    // ========================================================================
    /**
     * Find a module by name
     */
    findModule(name) {
        return this.index.modules.get(name);
    }
    /**
     * Find a package by name
     */
    findPackage(name) {
        return this.index.packages.get(name);
    }
    /**
     * Find an interface by name
     */
    findInterface(name) {
        return this.index.interfaces.get(name);
    }
    /**
     * Get all modules in a file
     */
    getModulesInFile(filePath) {
        const metadata = this.index.files.get(path.resolve(filePath));
        if (!metadata)
            return [];
        return metadata.modules
            .map(name => this.index.modules.get(name))
            .filter((m) => m !== undefined);
    }
    /**
     * Search modules by pattern
     */
    searchModules(pattern) {
        const regex = new RegExp(pattern, 'i');
        return Array.from(this.index.modules.values())
            .filter(m => regex.test(m.name));
    }
    /**
     * Get index statistics
     */
    getStats() {
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
    export() {
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
    import(data) {
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
    createEmptyIndex() {
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
            version: 1
        };
    }
    hashContent(content) {
        return crypto.createHash('md5').update(content).digest('hex');
    }
    /**
     * Get the current index
     */
    getIndex() {
        return this.index;
    }
}
// ============================================================================
// Re-exports
// ============================================================================
export * from './parser.js';
