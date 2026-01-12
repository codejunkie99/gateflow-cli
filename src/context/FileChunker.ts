/**
 * FileChunker - AST-aware file splitting for large VHDL/SystemVerilog files
 *
 * Implements intelligent file chunking based on code structure:
 * - Splits at module/function/always boundaries
 * - Maintains 5-10 line overlap for context continuity
 * - Targets 500 tokens per chunk, max 1000
 * - Supports query-based chunk selection
 *
 * This enables Cursor's "files as universal context primitive" for large HDL files
 * by providing bite-sized, semantically meaningful chunks.
 *
 * ## Two Modes of Operation
 *
 * 1. **With Indexer (preferred)**: Uses Slang/Verible AST for accurate boundaries
 * 2. **Fallback (regex)**: Uses regex patterns when indexer unavailable
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getTokenBudgetManager, TokenBudgetManager } from './TokenBudgetManager.js';
import type { Declaration, Location, DeclarationKind } from '../indexer/types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A chunk of a file with semantic boundaries
 */
export interface FileChunk {
    /** Chunk index (0-based) */
    index: number;

    /** Start line (1-indexed) */
    startLine: number;

    /** End line (1-indexed, inclusive) */
    endLine: number;

    /** Chunk content */
    content: string;

    /** Estimated token count */
    tokenCount: number;

    /** Chunk type/context */
    chunkType: ChunkType;

    /** Name of the construct (module name, function name, etc.) */
    name?: string;

    /** Parent scope (e.g., module name for functions inside module) */
    parentScope?: string;

    /** Overlap lines from previous chunk (for context) */
    overlapLines: number;

    /** Keywords found in this chunk (for relevance scoring) */
    keywords: string[];
}

/**
 * Type of code construct that defines chunk boundaries
 */
export type ChunkType =
    | 'module'
    | 'interface'
    | 'package'
    | 'class'
    | 'function'
    | 'task'
    | 'always_block'
    | 'generate_block'
    | 'initial_block'
    | 'typedef'
    | 'header'        // File header/imports
    | 'continuation'; // Overflow from large construct

/**
 * Configuration for chunking behavior
 */
export interface FileChunkerConfig {
    /** Target tokens per chunk (default: 500) */
    targetTokens: number;

    /** Maximum tokens per chunk (default: 1000) */
    maxTokens: number;

    /** Overlap lines for context (default: 5) */
    overlapLines: number;

    /** Maximum overlap lines (default: 10) */
    maxOverlapLines: number;

    /** File extensions to treat as HDL (default: sv, v, vhd, vhdl) */
    hdlExtensions: string[];

    /** Use indexer for boundary detection when available (default: true) */
    useIndexer: boolean;
}

/**
 * Interface for indexer integration
 * Allows FileChunker to use the project indexer for accurate AST boundaries
 */
export interface IndexerProvider {
    /**
     * Get declarations from a file
     * Returns declarations with their locations (start/end lines)
     */
    getFileDeclarations(filePath: string): Promise<Declaration[]>;

    /**
     * Check if the indexer has data for this file
     */
    hasFile(filePath: string): boolean;
}

/**
 * Chunk index for a file
 */
export interface ChunkIndex {
    /** Absolute path to the source file */
    filePath: string;

    /** Total line count */
    totalLines: number;

    /** Total token estimate */
    totalTokens: number;

    /** File modification time */
    mtime: number;

    /** All chunks */
    chunks: FileChunk[];

    /** Chunk type index for fast lookup */
    byType: Map<ChunkType, number[]>;

    /** Name index for fast lookup */
    byName: Map<string, number>;
}

/**
 * Result of chunk selection
 */
export interface ChunkSelection {
    /** Selected chunks */
    chunks: FileChunk[];

    /** Total tokens in selection */
    totalTokens: number;

    /** Coverage percentage (0-100) */
    coveragePercent: number;

    /** Whether the full file was included */
    fullFile: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CHUNKER_CONFIG: FileChunkerConfig = {
    targetTokens: 500,
    maxTokens: 1000,
    overlapLines: 5,
    maxOverlapLines: 10,
    hdlExtensions: ['sv', 'v', 'svh', 'vh', 'vhd', 'vhdl'],
    useIndexer: true
};

// ============================================================================
// Patterns for HDL construct detection
// ============================================================================

// SystemVerilog/Verilog patterns
const SV_MODULE_START = /^\s*(module|macromodule)\s+(\w+)/;
const SV_MODULE_END = /^\s*end(module|macromodule)/;
const SV_INTERFACE_START = /^\s*interface\s+(\w+)/;
const SV_INTERFACE_END = /^\s*endinterface/;
const SV_PACKAGE_START = /^\s*package\s+(\w+)/;
const SV_PACKAGE_END = /^\s*endpackage/;
const SV_CLASS_START = /^\s*(virtual\s+)?class\s+(\w+)/;
const SV_CLASS_END = /^\s*endclass/;
const SV_FUNCTION_START = /^\s*(function|static\s+function|virtual\s+function)\s+(\w+\s+)?(\w+)/;
const SV_FUNCTION_END = /^\s*endfunction/;
const SV_TASK_START = /^\s*(task|virtual\s+task)\s+(\w+)/;
const SV_TASK_END = /^\s*endtask/;
const SV_ALWAYS_START = /^\s*(always|always_ff|always_comb|always_latch)\s*(@|\(|begin)/;
const SV_GENERATE_START = /^\s*(for|if)\s*\(.*\)\s*(begin)?/;
const SV_GENERATE_END = /^\s*end\s*$/;
const SV_INITIAL_START = /^\s*initial\s+(begin|@)/;
const SV_TYPEDEF = /^\s*typedef\s+/;

// VHDL patterns
const VHDL_ENTITY_START = /^\s*entity\s+(\w+)\s+is/i;
const VHDL_ENTITY_END = /^\s*end\s+(entity\s+)?(\w+)?;/i;
const VHDL_ARCHITECTURE_START = /^\s*architecture\s+(\w+)\s+of\s+(\w+)/i;
const VHDL_ARCHITECTURE_END = /^\s*end\s+(architecture\s+)?(\w+)?;/i;
const VHDL_PACKAGE_START = /^\s*package\s+(\w+)\s+is/i;
const VHDL_PACKAGE_END = /^\s*end\s+(package\s+)?(\w+)?;/i;
const VHDL_PROCESS_START = /^\s*(\w+\s*:)?\s*process/i;
const VHDL_PROCESS_END = /^\s*end\s+process/i;
const VHDL_FUNCTION_START = /^\s*(function|procedure)\s+(\w+)/i;
const VHDL_FUNCTION_END = /^\s*end\s+(function|procedure)/i;

// ============================================================================
// FileChunker Implementation
// ============================================================================

/**
 * FileChunker for large VHDL/SystemVerilog files
 *
 * @example
 * ```typescript
 * const chunker = new FileChunker();
 *
 * // Chunk a large file
 * const index = await chunker.chunkFile('/path/to/large_module.sv');
 *
 * // Select relevant chunks for a query
 * const selection = chunker.selectRelevantChunks(
 *   index.chunks,
 *   'always_ff clock reset',
 *   2000  // max tokens
 * );
 *
 * // Get chunk containing a specific line
 * const chunk = chunker.getChunkForLine(index.chunks, 150);
 * ```
 */
export class FileChunker {
    private config: FileChunkerConfig;
    private tokenManager: TokenBudgetManager;
    private cache: Map<string, ChunkIndex> = new Map();
    private indexerProvider: IndexerProvider | null = null;

    constructor(config: Partial<FileChunkerConfig> = {}, indexerProvider?: IndexerProvider) {
        this.config = { ...DEFAULT_CHUNKER_CONFIG, ...config };
        this.tokenManager = getTokenBudgetManager();
        if (indexerProvider) {
            this.indexerProvider = indexerProvider;
        }
    }

    /**
     * Set the indexer provider for AST-based boundary detection
     * The indexer provides accurate AST boundaries from Slang/Verible
     */
    setIndexerProvider(provider: IndexerProvider): void {
        this.indexerProvider = provider;
    }

    /**
     * Check if indexer is configured
     */
    hasIndexer(): boolean {
        return this.indexerProvider !== null;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Chunk a file into semantically meaningful pieces
     */
    async chunkFile(filePath: string): Promise<ChunkIndex> {
        // Check cache
        const cached = this.cache.get(filePath);
        if (cached) {
            try {
                const stat = await fs.stat(filePath);
                if (stat.mtimeMs === cached.mtime) {
                    return cached;
                }
            } catch {
                // File changed or deleted, re-chunk
            }
        }

        // Read file
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const stat = await fs.stat(filePath);

        // Determine file type
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const isVHDL = ext === 'vhd' || ext === 'vhdl';

        // Detect construct boundaries using indexer (always preferred for accuracy)
        let boundaries: ConstructBoundary[];

        if (this.indexerProvider) {
            // Always use indexer for accurate AST-based boundaries from Slang/Verible
            boundaries = await this.detectBoundariesFromIndexer(filePath);

            // If indexer returned no boundaries (file not indexed yet), fall back to regex
            if (boundaries.length === 0) {
                boundaries = isVHDL
                    ? this.detectVHDLBoundaries(lines)
                    : this.detectSVBoundaries(lines);
            }
        } else {
            // No indexer configured - use regex-based detection
            boundaries = isVHDL
                ? this.detectVHDLBoundaries(lines)
                : this.detectSVBoundaries(lines);
        }

        // Create chunks from boundaries
        const chunks = this.createChunks(lines, boundaries);

        // Build index
        const index: ChunkIndex = {
            filePath,
            totalLines: lines.length,
            totalTokens: this.tokenManager.countTokens(content).tokens,
            mtime: stat.mtimeMs,
            chunks,
            byType: new Map(),
            byName: new Map()
        };

        // Build lookup indexes
        for (const chunk of chunks) {
            // By type
            const typeList = index.byType.get(chunk.chunkType) || [];
            typeList.push(chunk.index);
            index.byType.set(chunk.chunkType, typeList);

            // By name
            if (chunk.name) {
                index.byName.set(chunk.name, chunk.index);
            }
        }

        // Cache
        this.cache.set(filePath, index);

        return index;
    }

    /**
     * Detect boundaries using the indexer's AST data
     * This provides accurate boundaries from Slang/Verible parsing
     */
    private async detectBoundariesFromIndexer(filePath: string): Promise<ConstructBoundary[]> {
        if (!this.indexerProvider) return [];

        const declarations = await this.indexerProvider.getFileDeclarations(filePath);
        const boundaries: ConstructBoundary[] = [];

        // Map DeclarationKind to ChunkType
        const kindToChunkType: Partial<Record<DeclarationKind, ChunkType>> = {
            'module': 'module',
            'interface': 'interface',
            'package': 'package',
            'class': 'class',
            'function': 'function',
            'task': 'task',
            'always_block': 'always_block',
            'generate_block': 'generate_block',
            'initial_block': 'initial_block',
            'typedef': 'typedef'
        };

        for (const decl of declarations) {
            const chunkType = kindToChunkType[decl.kind];
            if (!chunkType) continue;

            // Only include declarations with valid location info
            if (!decl.location.endLine) continue;

            boundaries.push({
                type: chunkType,
                name: decl.name,
                startLine: decl.location.line,
                endLine: decl.location.endLine,
                parentScope: decl.scope.length > 0 ? decl.scope[decl.scope.length - 1] : undefined
            });
        }

        return boundaries;
    }

    /**
     * Get the chunk containing a specific line number
     */
    getChunkForLine(chunks: FileChunk[], lineNumber: number): FileChunk | null {
        for (const chunk of chunks) {
            if (lineNumber >= chunk.startLine && lineNumber <= chunk.endLine) {
                return chunk;
            }
        }
        return null;
    }

    /**
     * Select chunks relevant to a query within token budget
     */
    selectRelevantChunks(
        chunks: FileChunk[],
        query: string,
        maxTokens: number
    ): ChunkSelection {
        if (chunks.length === 0) {
            return { chunks: [], totalTokens: 0, coveragePercent: 0, fullFile: false };
        }

        // Score chunks by relevance to query
        const scored = chunks.map(chunk => ({
            chunk,
            score: this.scoreChunkRelevance(chunk, query)
        }));

        // Sort by score (descending)
        scored.sort((a, b) => b.score - a.score);

        // Select chunks within budget
        const selected: FileChunk[] = [];
        let totalTokens = 0;
        const totalFileTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

        for (const { chunk, score } of scored) {
            if (score === 0) continue; // Skip completely irrelevant chunks

            if (totalTokens + chunk.tokenCount <= maxTokens) {
                selected.push(chunk);
                totalTokens += chunk.tokenCount;
            }
        }

        // Sort selected by line order for coherent reading
        selected.sort((a, b) => a.startLine - b.startLine);

        return {
            chunks: selected,
            totalTokens,
            coveragePercent: Math.round((totalTokens / totalFileTokens) * 100),
            fullFile: selected.length === chunks.length
        };
    }

    /**
     * Get chunks by type (e.g., all always blocks)
     */
    getChunksByType(index: ChunkIndex, type: ChunkType): FileChunk[] {
        const indices = index.byType.get(type) || [];
        return indices.map(i => index.chunks[i]);
    }

    /**
     * Get chunk by construct name (e.g., module name, function name)
     */
    getChunkByName(index: ChunkIndex, name: string): FileChunk | null {
        const idx = index.byName.get(name);
        return idx !== undefined ? index.chunks[idx] : null;
    }

    /**
     * Clear the chunk cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    // ========================================================================
    // Boundary Detection
    // ========================================================================

    private detectSVBoundaries(lines: string[]): ConstructBoundary[] {
        const boundaries: ConstructBoundary[] = [];
        const stack: ConstructContext[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Module
            let match = line.match(SV_MODULE_START);
            if (match) {
                stack.push({ type: 'module', name: match[2], startLine: lineNum });
                continue;
            }
            if (SV_MODULE_END.test(line) && this.findContext(stack, 'module')) {
                const ctx = this.popContext(stack, 'module');
                if (ctx) {
                    boundaries.push({
                        type: 'module',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum
                    });
                }
                continue;
            }

            // Interface
            match = line.match(SV_INTERFACE_START);
            if (match) {
                stack.push({ type: 'interface', name: match[1], startLine: lineNum });
                continue;
            }
            if (SV_INTERFACE_END.test(line) && this.findContext(stack, 'interface')) {
                const ctx = this.popContext(stack, 'interface');
                if (ctx) {
                    boundaries.push({
                        type: 'interface',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum
                    });
                }
                continue;
            }

            // Package
            match = line.match(SV_PACKAGE_START);
            if (match) {
                stack.push({ type: 'package', name: match[1], startLine: lineNum });
                continue;
            }
            if (SV_PACKAGE_END.test(line) && this.findContext(stack, 'package')) {
                const ctx = this.popContext(stack, 'package');
                if (ctx) {
                    boundaries.push({
                        type: 'package',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum
                    });
                }
                continue;
            }

            // Class
            match = line.match(SV_CLASS_START);
            if (match) {
                const name = match[2] || match[1]; // Handle 'virtual class Name'
                stack.push({ type: 'class', name, startLine: lineNum });
                continue;
            }
            if (SV_CLASS_END.test(line) && this.findContext(stack, 'class')) {
                const ctx = this.popContext(stack, 'class');
                if (ctx) {
                    boundaries.push({
                        type: 'class',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum,
                        parentScope: this.getParentScope(stack)
                    });
                }
                continue;
            }

            // Function
            match = line.match(SV_FUNCTION_START);
            if (match) {
                const name = match[3] || match[2];
                stack.push({ type: 'function', name, startLine: lineNum });
                continue;
            }
            if (SV_FUNCTION_END.test(line) && this.findContext(stack, 'function')) {
                const ctx = this.popContext(stack, 'function');
                if (ctx) {
                    boundaries.push({
                        type: 'function',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum,
                        parentScope: this.getParentScope(stack)
                    });
                }
                continue;
            }

            // Task
            match = line.match(SV_TASK_START);
            if (match) {
                stack.push({ type: 'task', name: match[2], startLine: lineNum });
                continue;
            }
            if (SV_TASK_END.test(line) && this.findContext(stack, 'task')) {
                const ctx = this.popContext(stack, 'task');
                if (ctx) {
                    boundaries.push({
                        type: 'task',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum,
                        parentScope: this.getParentScope(stack)
                    });
                }
                continue;
            }

            // Always blocks (simple detection - count begin/end)
            if (SV_ALWAYS_START.test(line)) {
                stack.push({ type: 'always_block', startLine: lineNum, beginCount: 0 });
                continue;
            }

            // Initial blocks
            if (SV_INITIAL_START.test(line)) {
                stack.push({ type: 'initial_block', startLine: lineNum, beginCount: 0 });
                continue;
            }

            // Track begin/end for procedural blocks
            const alwaysCtx = this.findContext(stack, 'always_block');
            const initialCtx = this.findContext(stack, 'initial_block');
            const procCtx = alwaysCtx || initialCtx;

            if (procCtx) {
                if (/\bbegin\b/.test(line)) {
                    procCtx.beginCount = (procCtx.beginCount || 0) + 1;
                }
                if (/\bend\b/.test(line)) {
                    procCtx.beginCount = (procCtx.beginCount || 1) - 1;
                    if (procCtx.beginCount <= 0) {
                        const ctx = this.popContext(stack, procCtx.type);
                        if (ctx) {
                            boundaries.push({
                                type: ctx.type as ChunkType,
                                startLine: ctx.startLine,
                                endLine: lineNum,
                                parentScope: this.getParentScope(stack)
                            });
                        }
                    }
                }
            }

            // Typedef (single line usually)
            if (SV_TYPEDEF.test(line)) {
                // Find the semicolon end
                let endLine = lineNum;
                let combined = line;
                while (!combined.includes(';') && endLine < lines.length) {
                    endLine++;
                    combined += lines[endLine - 1];
                }
                boundaries.push({
                    type: 'typedef',
                    startLine: lineNum,
                    endLine
                });
            }
        }

        return boundaries;
    }

    private detectVHDLBoundaries(lines: string[]): ConstructBoundary[] {
        const boundaries: ConstructBoundary[] = [];
        const stack: ConstructContext[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Entity
            let match = line.match(VHDL_ENTITY_START);
            if (match) {
                stack.push({ type: 'module', name: match[1], startLine: lineNum });
                continue;
            }
            if (VHDL_ENTITY_END.test(line) && this.findContext(stack, 'module')) {
                const ctx = this.popContext(stack, 'module');
                if (ctx) {
                    boundaries.push({
                        type: 'module',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum
                    });
                }
                continue;
            }

            // Architecture
            match = line.match(VHDL_ARCHITECTURE_START);
            if (match) {
                stack.push({
                    type: 'module', // Treat as module continuation
                    name: `${match[2]}.${match[1]}`,
                    startLine: lineNum
                });
                continue;
            }
            if (VHDL_ARCHITECTURE_END.test(line) && this.findContext(stack, 'module')) {
                const ctx = this.popContext(stack, 'module');
                if (ctx) {
                    boundaries.push({
                        type: 'module',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum
                    });
                }
                continue;
            }

            // Package
            match = line.match(VHDL_PACKAGE_START);
            if (match) {
                stack.push({ type: 'package', name: match[1], startLine: lineNum });
                continue;
            }
            if (VHDL_PACKAGE_END.test(line) && this.findContext(stack, 'package')) {
                const ctx = this.popContext(stack, 'package');
                if (ctx) {
                    boundaries.push({
                        type: 'package',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum
                    });
                }
                continue;
            }

            // Process
            match = line.match(VHDL_PROCESS_START);
            if (match) {
                const name = match[1]?.replace(':', '').trim();
                stack.push({ type: 'always_block', name, startLine: lineNum });
                continue;
            }
            if (VHDL_PROCESS_END.test(line) && this.findContext(stack, 'always_block')) {
                const ctx = this.popContext(stack, 'always_block');
                if (ctx) {
                    boundaries.push({
                        type: 'always_block',
                        name: ctx.name,
                        startLine: ctx.startLine,
                        endLine: lineNum,
                        parentScope: this.getParentScope(stack)
                    });
                }
                continue;
            }

            // Function/Procedure
            match = line.match(VHDL_FUNCTION_START);
            if (match) {
                const type = match[1].toLowerCase() === 'function' ? 'function' : 'task';
                stack.push({ type, name: match[2], startLine: lineNum });
                continue;
            }
            if (VHDL_FUNCTION_END.test(line)) {
                const funcCtx = this.findContext(stack, 'function') || this.findContext(stack, 'task');
                if (funcCtx) {
                    const ctx = this.popContext(stack, funcCtx.type);
                    if (ctx) {
                        boundaries.push({
                            type: ctx.type as ChunkType,
                            name: ctx.name,
                            startLine: ctx.startLine,
                            endLine: lineNum,
                            parentScope: this.getParentScope(stack)
                        });
                    }
                }
            }
        }

        return boundaries;
    }

    // ========================================================================
    // Chunk Creation
    // ========================================================================

    private createChunks(lines: string[], boundaries: ConstructBoundary[]): FileChunk[] {
        const chunks: FileChunk[] = [];

        // Sort boundaries by start line
        boundaries.sort((a, b) => a.startLine - b.startLine);

        // Process each boundary
        let lastEndLine = 0;

        for (const boundary of boundaries) {
            // Handle gap before this boundary (header/misc code)
            if (boundary.startLine > lastEndLine + 1) {
                const gapChunks = this.createChunksForRange(
                    lines,
                    lastEndLine + 1,
                    boundary.startLine - 1,
                    'header',
                    undefined,
                    chunks.length
                );
                chunks.push(...gapChunks);
            }

            // Create chunk(s) for this boundary
            const boundaryChunks = this.createChunksForRange(
                lines,
                boundary.startLine,
                boundary.endLine,
                boundary.type,
                boundary.name,
                chunks.length,
                boundary.parentScope
            );
            chunks.push(...boundaryChunks);

            lastEndLine = boundary.endLine;
        }

        // Handle trailing code after last boundary
        if (lastEndLine < lines.length) {
            const trailingChunks = this.createChunksForRange(
                lines,
                lastEndLine + 1,
                lines.length,
                'header', // Footer/misc
                undefined,
                chunks.length
            );
            chunks.push(...trailingChunks);
        }

        // Re-index chunks
        chunks.forEach((chunk, i) => chunk.index = i);

        return chunks;
    }

    private createChunksForRange(
        lines: string[],
        startLine: number,
        endLine: number,
        chunkType: ChunkType,
        name: string | undefined,
        startIndex: number,
        parentScope?: string
    ): FileChunk[] {
        const chunks: FileChunk[] = [];
        const content = lines.slice(startLine - 1, endLine).join('\n');
        const tokenCount = this.tokenManager.countTokens(content).tokens;

        // If within budget, create single chunk
        if (tokenCount <= this.config.maxTokens) {
            chunks.push({
                index: startIndex,
                startLine,
                endLine,
                content,
                tokenCount,
                chunkType,
                name,
                parentScope,
                overlapLines: 0,
                keywords: this.extractKeywords(content)
            });
            return chunks;
        }

        // Split into multiple chunks with overlap
        let currentStart = startLine;
        let chunkIndex = startIndex;

        while (currentStart <= endLine) {
            // Calculate end line for target token count
            let currentEnd = currentStart;
            let currentContent = '';
            let currentTokens = 0;

            while (currentEnd <= endLine && currentTokens < this.config.targetTokens) {
                currentContent = lines.slice(currentStart - 1, currentEnd).join('\n');
                currentTokens = this.tokenManager.countTokens(currentContent).tokens;
                currentEnd++;
            }
            currentEnd--; // Back up one since we went over

            // Ensure minimum progress
            if (currentEnd < currentStart) {
                currentEnd = Math.min(currentStart + 10, endLine);
            }

            const chunkContent = lines.slice(currentStart - 1, currentEnd).join('\n');

            chunks.push({
                index: chunkIndex,
                startLine: currentStart,
                endLine: currentEnd,
                content: chunkContent,
                tokenCount: this.tokenManager.countTokens(chunkContent).tokens,
                chunkType: chunks.length === 0 ? chunkType : 'continuation',
                name: chunks.length === 0 ? name : `${name || 'chunk'}_cont_${chunks.length}`,
                parentScope,
                overlapLines: currentStart > startLine ? this.config.overlapLines : 0,
                keywords: this.extractKeywords(chunkContent)
            });

            // Move to next chunk with overlap
            currentStart = currentEnd - this.config.overlapLines + 1;
            chunkIndex++;
        }

        return chunks;
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private findContext(stack: ConstructContext[], type: string): ConstructContext | undefined {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].type === type) {
                return stack[i];
            }
        }
        return undefined;
    }

    private popContext(stack: ConstructContext[], type: string): ConstructContext | undefined {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].type === type) {
                return stack.splice(i, 1)[0];
            }
        }
        return undefined;
    }

    private getParentScope(stack: ConstructContext[]): string | undefined {
        // Find nearest module/class/package parent
        for (let i = stack.length - 1; i >= 0; i--) {
            const ctx = stack[i];
            if (['module', 'class', 'package', 'interface'].includes(ctx.type)) {
                return ctx.name;
            }
        }
        return undefined;
    }

    private extractKeywords(content: string): string[] {
        const keywords: string[] = [];
        const contentLower = content.toLowerCase();

        // Common HDL keywords for relevance matching
        const hdlKeywords = [
            'module', 'endmodule', 'always', 'always_ff', 'always_comb',
            'wire', 'reg', 'logic', 'input', 'output', 'inout',
            'assign', 'initial', 'generate', 'genvar',
            'if', 'else', 'case', 'for', 'while',
            'posedge', 'negedge', 'clock', 'clk', 'reset', 'rst',
            'function', 'task', 'begin', 'end',
            'entity', 'architecture', 'process', 'signal',
            'port', 'generic', 'component'
        ];

        for (const kw of hdlKeywords) {
            if (contentLower.includes(kw)) {
                keywords.push(kw);
            }
        }

        // Extract identifiers (module names, signal names, etc.)
        const identifiers = content.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
        const uniqueIdentifiers = [...new Set(identifiers)]
            .filter(id => id.length > 2 && !hdlKeywords.includes(id.toLowerCase()))
            .slice(0, 20); // Limit to top 20 unique identifiers

        keywords.push(...uniqueIdentifiers);

        return keywords;
    }

    private scoreChunkRelevance(chunk: FileChunk, query: string): number {
        const queryTerms = query.toLowerCase().split(/\s+/);
        let score = 0;

        // Score based on chunk type match
        if (queryTerms.some(t => chunk.chunkType.includes(t))) {
            score += 0.3;
        }

        // Score based on name match
        if (chunk.name) {
            const nameLower = chunk.name.toLowerCase();
            for (const term of queryTerms) {
                if (nameLower.includes(term)) {
                    score += 0.4;
                    break;
                }
            }
        }

        // Score based on keyword overlap
        const chunkKeywordsLower = chunk.keywords.map(k => k.toLowerCase());
        let keywordMatches = 0;
        for (const term of queryTerms) {
            if (chunkKeywordsLower.some(kw => kw.includes(term))) {
                keywordMatches++;
            }
        }
        score += (keywordMatches / queryTerms.length) * 0.3;

        // Boost design units (modules, interfaces, packages)
        if (['module', 'interface', 'package', 'class'].includes(chunk.chunkType)) {
            score += 0.1;
        }

        return Math.min(score, 1.0);
    }
}

// ============================================================================
// Internal Types
// ============================================================================

interface ConstructBoundary {
    type: ChunkType;
    name?: string;
    startLine: number;
    endLine: number;
    parentScope?: string;
}

interface ConstructContext {
    type: string;
    name?: string;
    startLine: number;
    beginCount?: number;
}

// ============================================================================
// Singleton Management
// ============================================================================

let globalFileChunker: FileChunker | null = null;

/**
 * Get the global FileChunker instance
 */
export function getFileChunker(): FileChunker {
    if (!globalFileChunker) {
        globalFileChunker = new FileChunker();
    }
    return globalFileChunker;
}

/**
 * Create a new FileChunker with custom config and optional indexer
 */
export function createFileChunker(
    config?: Partial<FileChunkerConfig>,
    indexerProvider?: IndexerProvider
): FileChunker {
    return new FileChunker(config, indexerProvider);
}

/**
 * Set the global FileChunker instance
 */
export function setGlobalFileChunker(chunker: FileChunker): void {
    globalFileChunker = chunker;
}
