/**
 * File Tools
 * File operations with policy enforcement and event emission
 */
import type { EventBus } from '../events/bus.js';
import type { PolicyEngine } from '../approval/engine.js';
export interface FileReadResult {
    success: boolean;
    path: string;
    content?: string;
    lines?: number;
    error?: string;
}
export interface FileWriteResult {
    success: boolean;
    path: string;
    bytesWritten?: number;
    created?: boolean;
    error?: string;
}
export interface FileListResult {
    success: boolean;
    directory: string;
    files: FileEntry[];
    count: number;
    error?: string;
}
export interface FileEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: Date;
}
export interface ProjectScanResult {
    success: boolean;
    rootPath: string;
    summary: {
        totalFiles: number;
        modules: number;
        testbenches: number;
        packages: number;
        includes: number;
    };
    files: ScannedFile[];
    error?: string;
}
export interface ScannedFile {
    path: string;
    name: string;
    type: 'module' | 'testbench' | 'package' | 'include' | 'other';
    relativePath: string;
}
export interface SearchResult {
    success: boolean;
    pattern: string;
    matches: SearchMatch[];
    totalMatches: number;
    error?: string;
}
export interface SearchMatch {
    file: string;
    line: number;
    column: number;
    content: string;
    context?: {
        before: string[];
        after: string[];
    };
}
export declare class FileTools {
    private bus;
    private policy;
    private projectRoot;
    constructor(bus: EventBus, policy: PolicyEngine, projectRoot?: string);
    private resolvePath;
    readFile(filePath: string, options?: {
        startLine?: number;
        endLine?: number;
        includeLineNumbers?: boolean;
    }): Promise<FileReadResult>;
    writeFile(filePath: string, content: string, options?: {
        createDirs?: boolean;
        skipApproval?: boolean;
    }): Promise<FileWriteResult>;
    private static readonly EXCLUDED_DIRS;
    listFiles(dirPath: string, options?: {
        extensions?: string[];
        recursive?: boolean;
        includeHidden?: boolean;
    }): Promise<FileListResult>;
    findFiles(pattern: string, options?: {
        cwd?: string;
        ignore?: string[];
        maxDepth?: number;
    }): Promise<string[]>;
    scanProject(rootPath: string, options?: {
        maxDepth?: number;
        excludePatterns?: string[];
    }): Promise<ProjectScanResult>;
    searchCode(pattern: string, options?: {
        rootPath?: string;
        filePattern?: string;
        maxResults?: number;
        contextLines?: number;
        caseSensitive?: boolean;
    }): Promise<SearchResult>;
    exists(filePath: string): Promise<boolean>;
    getFileInfo(filePath: string): Promise<{
        exists: boolean;
        isFile?: boolean;
        isDirectory?: boolean;
        size?: number;
        modified?: Date;
    }>;
}
