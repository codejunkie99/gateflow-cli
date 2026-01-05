/**
 * File Tools
 * File operations with policy enforcement and event emission
 */
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { requestApprovalSync, shouldAutoApprove, isApproved } from './approval.js';
// ============================================================================
// File Tools Class
// ============================================================================
export class FileTools {
    bus;
    policy;
    projectRoot;
    constructor(bus, policy, projectRoot = process.cwd()) {
        this.bus = bus;
        this.policy = policy;
        this.projectRoot = projectRoot;
    }
    resolvePath(filePath) {
        // If already absolute, use as-is
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        // Resolve relative to project root
        return path.resolve(this.projectRoot, filePath);
    }
    // ========================================================================
    // Read File
    // ========================================================================
    async readFile(filePath, options) {
        const absolutePath = this.resolvePath(filePath);
        this.bus.emit({
            type: 'tool_call',
            tool: 'read_file',
            argsSummary: path.basename(filePath),
            args: { filePath, ...options }
        });
        const startTime = Date.now();
        try {
            const content = await fs.readFile(absolutePath, 'utf-8');
            let lines = content.split('\n');
            const totalLines = lines.length;
            // Apply line range if specified
            if (options?.startLine || options?.endLine) {
                const start = (options.startLine ?? 1) - 1;
                const end = options.endLine ?? lines.length;
                lines = lines.slice(start, end);
            }
            // Add line numbers if requested
            let outputContent;
            if (options?.includeLineNumbers) {
                const startNum = options?.startLine ?? 1;
                outputContent = lines
                    .map((line, i) => `${(startNum + i).toString().padStart(6)}| ${line}`)
                    .join('\n');
            }
            else {
                outputContent = lines.join('\n');
            }
            this.bus.emit({
                type: 'tool_result',
                tool: 'read_file',
                ok: true,
                summary: `Read ${totalLines} lines from ${path.basename(filePath)}`,
                duration: Date.now() - startTime
            });
            return {
                success: true,
                path: absolutePath,
                content: outputContent,
                lines: totalLines
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'tool_result',
                tool: 'read_file',
                ok: false,
                summary: `Failed: ${errorMsg}`,
                duration: Date.now() - startTime
            });
            return {
                success: false,
                path: absolutePath,
                error: errorMsg
            };
        }
    }
    // ========================================================================
    // Write File
    // ========================================================================
    async writeFile(filePath, content, options) {
        const absolutePath = this.resolvePath(filePath);
        // Policy check
        const decision = this.policy.checkTool('write_file', { filePath: absolutePath });
        if (!decision.allowed) {
            this.bus.emit({
                type: 'error',
                message: decision.reason ?? 'Write not allowed',
                code: 3
            });
            return {
                success: false,
                path: absolutePath,
                error: decision.reason ?? 'Write not allowed by policy'
            };
        }
        // Request approval if required (using synchronous prompt to avoid deadlock)
        if (decision.requiresApproval && !options?.skipApproval) {
            // Auto-approve SystemVerilog files
            const autoApprove = shouldAutoApprove(filePath) || isApproved('write_file');
            if (!autoApprove) {
                this.bus.emit({
                    type: 'tool_call',
                    tool: 'write_file',
                    argsSummary: `${path.basename(filePath)} (${content.length} bytes)`,
                    args: { filePath, contentLength: content.length }
                });
                // Use synchronous approval to avoid readline deadlock
                const approval = requestApprovalSync('write_file', `Write ${content.length} bytes to ${filePath}`);
                if (!approval.approved) {
                    this.bus.emit({
                        type: 'tool_result',
                        tool: 'write_file',
                        ok: false,
                        summary: 'User rejected'
                    });
                    return {
                        success: false,
                        path: absolutePath,
                        error: 'User rejected write operation'
                    };
                }
                // Store approval if session scope
                if (approval.scope === 'session') {
                    this.policy.grantApproval('write_file', 'session', filePath);
                }
            }
        }
        const startTime = Date.now();
        try {
            // Check if file exists
            let created = false;
            try {
                await fs.access(absolutePath);
            }
            catch {
                created = true;
            }
            // Create directories if needed
            if (options?.createDirs ?? true) {
                await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            }
            // Write file
            await fs.writeFile(absolutePath, content, 'utf-8');
            this.bus.emit({
                type: 'tool_result',
                tool: 'write_file',
                ok: true,
                summary: `${created ? 'Created' : 'Updated'} ${path.basename(filePath)}`,
                duration: Date.now() - startTime
            });
            return {
                success: true,
                path: absolutePath,
                bytesWritten: content.length,
                created
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'tool_result',
                tool: 'write_file',
                ok: false,
                summary: `Failed: ${errorMsg}`,
                duration: Date.now() - startTime
            });
            return {
                success: false,
                path: absolutePath,
                error: errorMsg
            };
        }
    }
    // ========================================================================
    // List Files
    // ========================================================================
    // Directories to always exclude from listing
    static EXCLUDED_DIRS = new Set([
        'node_modules',
        'dist',
        'dist-electron',
        'obj_dir',
        '.git',
        'target',
        'build',
        '__pycache__',
        '.cache',
        'coverage'
    ]);
    async listFiles(dirPath, options) {
        const absolutePath = path.resolve(dirPath);
        this.bus.emit({
            type: 'tool_call',
            tool: 'list_files',
            argsSummary: dirPath,
            args: { dirPath, ...options }
        });
        const startTime = Date.now();
        try {
            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const files = [];
            for (const entry of entries) {
                // Skip hidden files unless requested
                if (!options?.includeHidden && entry.name.startsWith('.')) {
                    continue;
                }
                // Skip excluded directories (node_modules, dist, etc.)
                if (entry.isDirectory() && FileTools.EXCLUDED_DIRS.has(entry.name)) {
                    continue;
                }
                const fullPath = path.join(absolutePath, entry.name);
                if (entry.isDirectory()) {
                    files.push({
                        name: entry.name,
                        path: fullPath,
                        type: 'directory'
                    });
                    // Recurse if requested
                    if (options?.recursive) {
                        const subResult = await this.listFiles(fullPath, options);
                        if (subResult.success) {
                            files.push(...subResult.files);
                        }
                    }
                }
                else if (entry.isFile()) {
                    // Filter by extension if specified
                    if (options?.extensions && options.extensions.length > 0) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (!options.extensions.includes(ext)) {
                            continue;
                        }
                    }
                    const stats = await fs.stat(fullPath);
                    files.push({
                        name: entry.name,
                        path: fullPath,
                        type: 'file',
                        size: stats.size,
                        modified: stats.mtime
                    });
                }
            }
            this.bus.emit({
                type: 'tool_result',
                tool: 'list_files',
                ok: true,
                summary: `Found ${files.length} items in ${path.basename(dirPath)}`,
                duration: Date.now() - startTime
            });
            return {
                success: true,
                directory: absolutePath,
                files,
                count: files.length
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'tool_result',
                tool: 'list_files',
                ok: false,
                summary: `Failed: ${errorMsg}`,
                duration: Date.now() - startTime
            });
            return {
                success: false,
                directory: absolutePath,
                files: [],
                count: 0,
                error: errorMsg
            };
        }
    }
    // ========================================================================
    // Find Files (Glob)
    // ========================================================================
    async findFiles(pattern, options) {
        const cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd();
        const ignore = options?.ignore || [
            '**/node_modules/**',
            '**/dist/**',
            '**/dist-electron/**',
            '**/obj_dir/**',
            '**/.git/**',
            '**/target/**'
        ];
        // Ensure pattern is glob-friendly (forward slashes)
        const globPattern = pattern.replace(/\\/g, '/');
        try {
            const files = await glob(globPattern, {
                cwd,
                ignore,
                maxDepth: options?.maxDepth,
                nodir: true,
                windowsPathsNoEscape: true
            });
            return files;
        }
        catch (error) {
            return [];
        }
    }
    // ========================================================================
    // Scan Project
    // ========================================================================
    async scanProject(rootPath, options) {
        const absolutePath = path.resolve(rootPath);
        const maxDepth = options?.maxDepth ?? 10;
        const excludePatterns = options?.excludePatterns ?? [
            '**/node_modules/**',
            '**/obj_dir/**',
            '**/.git/**',
            '**/dist/**'
        ];
        this.bus.emit({
            type: 'tool_call',
            tool: 'scan_project',
            argsSummary: rootPath,
            args: { rootPath, maxDepth }
        });
        this.bus.emit({
            type: 'status',
            phase: 'indexing',
            label: `Scanning ${rootPath}...`
        });
        const startTime = Date.now();
        try {
            // Find all SV files
            const pattern = '**/*.{sv,svh,v,vh}';
            const files = await glob(pattern, {
                cwd: absolutePath,
                ignore: excludePatterns,
                maxDepth,
                nodir: true
            });
            const scannedFiles = [];
            let modules = 0;
            let testbenches = 0;
            let packages = 0;
            let includes = 0;
            for (const file of files) {
                const fullPath = path.join(absolutePath, file);
                const baseName = path.basename(file);
                const ext = path.extname(file).toLowerCase();
                // Classify file
                let type = 'other';
                if (ext === '.svh' || ext === '.vh') {
                    type = 'include';
                    includes++;
                }
                else if (baseName.startsWith('tb_') || baseName.endsWith('_tb.sv') || baseName.includes('test')) {
                    type = 'testbench';
                    testbenches++;
                }
                else if (baseName.endsWith('_pkg.sv') || baseName.includes('package')) {
                    type = 'package';
                    packages++;
                }
                else {
                    type = 'module';
                    modules++;
                }
                scannedFiles.push({
                    path: fullPath,
                    name: baseName,
                    type,
                    relativePath: file
                });
            }
            this.bus.emit({
                type: 'tool_result',
                tool: 'scan_project',
                ok: true,
                summary: `Found ${files.length} files (${modules} modules, ${testbenches} TBs)`,
                duration: Date.now() - startTime
            });
            this.bus.emit({
                type: 'index_update',
                added: files.length,
                removed: 0,
                modified: 0
            });
            return {
                success: true,
                rootPath: absolutePath,
                summary: {
                    totalFiles: files.length,
                    modules,
                    testbenches,
                    packages,
                    includes
                },
                files: scannedFiles
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'tool_result',
                tool: 'scan_project',
                ok: false,
                summary: `Failed: ${errorMsg}`,
                duration: Date.now() - startTime
            });
            return {
                success: false,
                rootPath: absolutePath,
                summary: {
                    totalFiles: 0,
                    modules: 0,
                    testbenches: 0,
                    packages: 0,
                    includes: 0
                },
                files: [],
                error: errorMsg
            };
        }
    }
    // ========================================================================
    // Search Code
    // ========================================================================
    async searchCode(pattern, options) {
        const rootPath = path.resolve(options?.rootPath ?? this.policy.getProjectRoot());
        const filePattern = options?.filePattern ?? '**/*.{sv,svh,v,vh}';
        const maxResults = options?.maxResults ?? 100;
        const contextLines = options?.contextLines ?? 2;
        const caseSensitive = options?.caseSensitive ?? false;
        this.bus.emit({
            type: 'tool_call',
            tool: 'search_code',
            argsSummary: pattern,
            args: { pattern, rootPath, filePattern }
        });
        const startTime = Date.now();
        try {
            const files = await glob(filePattern, {
                cwd: rootPath,
                ignore: ['**/node_modules/**', '**/obj_dir/**', '**/.git/**'],
                nodir: true
            });
            const matches = [];
            // #region agent log
            // FIX D: Sanitize pattern - remove inline flags like (?i), (?m), (?s) that JS doesn't support
            let sanitizedPattern = pattern.replace(/\(\?[imsx]+\)/g, '');
            fetch('http://127.0.0.1:7242/ingest/a4f00bdc-6d66-4cb0-9b9b-8714458232cc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'file.ts:searchCode-pattern-sanitized', message: 'Pattern sanitization', data: { original: pattern, sanitized: sanitizedPattern, wasModified: pattern !== sanitizedPattern }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'D' }) }).catch(() => { });
            let regex;
            try {
                regex = new RegExp(sanitizedPattern, caseSensitive ? 'g' : 'gi');
            }
            catch (regexError) {
                fetch('http://127.0.0.1:7242/ingest/a4f00bdc-6d66-4cb0-9b9b-8714458232cc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'file.ts:searchCode-regex-error', message: 'Regex creation failed', data: { pattern: sanitizedPattern, caseSensitive, error: regexError.message }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'D' }) }).catch(() => { });
                throw regexError;
            }
            // #endregion
            for (const file of files) {
                if (matches.length >= maxResults)
                    break;
                const fullPath = path.join(rootPath, file);
                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (matches.length >= maxResults)
                        break;
                    const line = lines[i];
                    let match;
                    // Reset regex lastIndex for global flag
                    regex.lastIndex = 0;
                    while ((match = regex.exec(line)) !== null) {
                        if (matches.length >= maxResults)
                            break;
                        // Get context
                        const beforeStart = Math.max(0, i - contextLines);
                        const afterEnd = Math.min(lines.length, i + contextLines + 1);
                        matches.push({
                            file: fullPath,
                            line: i + 1,
                            column: match.index + 1,
                            content: line,
                            context: {
                                before: lines.slice(beforeStart, i),
                                after: lines.slice(i + 1, afterEnd)
                            }
                        });
                    }
                }
            }
            this.bus.emit({
                type: 'tool_result',
                tool: 'search_code',
                ok: true,
                summary: `Found ${matches.length} matches for "${pattern}"`,
                duration: Date.now() - startTime
            });
            return {
                success: true,
                pattern,
                matches,
                totalMatches: matches.length
            };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.bus.emit({
                type: 'tool_result',
                tool: 'search_code',
                ok: false,
                summary: `Failed: ${errorMsg}`,
                duration: Date.now() - startTime
            });
            return {
                success: false,
                pattern,
                matches: [],
                totalMatches: 0,
                error: errorMsg
            };
        }
    }
    // ========================================================================
    // Utility: Check File Exists
    // ========================================================================
    async exists(filePath) {
        try {
            await fs.access(this.resolvePath(filePath));
            return true;
        }
        catch {
            return false;
        }
    }
    // ========================================================================
    // Utility: Get File Info
    // ========================================================================
    async getFileInfo(filePath) {
        try {
            const stats = await fs.stat(this.resolvePath(filePath));
            return {
                exists: true,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                size: stats.size,
                modified: stats.mtime
            };
        }
        catch {
            return { exists: false };
        }
    }
}
