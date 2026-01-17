/**
 * KnowledgeStore Analysis Utilities
 * @module knowledge-store/analysis-utils
 *
 * Pure functions for analyzing code patterns, diffs, and error messages.
 * Used by extraction.ts to build meaningful knowledge items.
 *
 * ## Key Functions
 *
 * ### Error Analysis
 * - `normalizeErrorMessage()` - Canonicalize errors for deduplication
 * - `extractKeywordsFromError()` - Extract HDL-specific keywords
 *
 * ### Diff Analysis
 * - `analyzeDiff()` - Detect change patterns (always blocks, reset, naming)
 * - `detectNamingStyle()` - Identify snake_case vs camelCase
 * - `detectCorrectionType()` - Classify user corrections
 *
 * ### Code Analysis
 * - `analyzeGeneratedCode()` - Extract metadata from FSM/testbench/module
 *
 * ### Path Utilities
 * - `inferFilePatterns()` - Derive glob patterns from file sets
 * - `findCommonPrefix()` - Find common directory prefix
 * - `toGlobPattern()` - Convert file path to glob pattern
 *
 * All functions are stateless and side-effect free, making them easy to test.
 */

import * as path from 'path';
import type { KnowledgeType } from '../knowledge-types.js';

/**
 * Normalize an error message for pattern matching and deduplication.
 * Replaces variable parts (line numbers, identifiers) with placeholders.
 *
 * @example
 * normalizeErrorMessage("Signal 'clk_out' at line 42 is undriven")
 * // => "Signal 'ID' at line N is undriven"
 */
export function normalizeErrorMessage(message: string): string {
    return message
        .replace(/\b\d+\b/g, 'N')                    // Replace numbers
        .replace(/'[^']+'/g, "'ID'")                 // Replace quoted identifiers
        .replace(/"[^"]+"/g, '"ID"')                 // Replace double-quoted identifiers
        .replace(/\b[a-zA-Z_]\w*\b(?=\s+is\b)/g, 'ID') // Replace "X is" patterns
        .replace(/:\s*\d+/g, ':N')                   // Replace line numbers
        .replace(/\s+/g, ' ')                        // Normalize whitespace
        .trim();
}

/**
 * Extract HDL-specific keywords from an error message.
 * Used to build searchable keyword lists for lint_fix items.
 */
export function extractKeywordsFromError(message: string): string[] {
    const keywords: string[] = [];

    // Extract HDL-specific keywords
    const hdlKeywords = message.match(/\b(module|interface|signal|wire|reg|logic|port|assign|always|process|clk|reset|rst)\b/gi);
    if (hdlKeywords) {
        keywords.push(...hdlKeywords.map(k => k.toLowerCase()));
    }

    // Extract error type keywords
    const errorTypes = message.match(/\b(unused|undeclared|undriven|missing|syntax|type|width|mismatch)\b/gi);
    if (errorTypes) {
        keywords.push(...errorTypes.map(k => k.toLowerCase()));
    }

    return [...new Set(keywords)];
}

/**
 * Infer glob file patterns from a set of related files.
 * Returns undefined if files are too scattered to form a useful pattern.
 *
 * @param files - Set of file paths that share a common pattern
 * @returns Glob patterns like "src/rtl/**\/*.sv" or undefined
 */
export function inferFilePatterns(files: Set<string>): string[] | undefined {
    if (files.size === 0) return undefined;
    if (files.size > 5) return undefined; // Too many files, don't scope

    // Try to find common directory pattern
    const dirs = [...files].map(f => path.dirname(f));
    const commonDir = findCommonPrefix(dirs);

    if (commonDir && commonDir !== '.') {
        // Count extension frequencies (excluding files without extensions)
        const extCounts = new Map<string, number>();
        for (const f of files) {
            const ext = path.extname(f).toLowerCase();
            if (ext) {
                extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
            }
        }

        // If no files have extensions, don't scope by extension
        if (extCounts.size === 0) {
            return [`${commonDir}/**/*`];
        }

        // If single extension, use it; otherwise find most common
        let ext: string;
        if (extCounts.size === 1) {
            ext = [...extCounts.keys()][0];
        } else {
            // Find most common extension
            let maxCount = 0;
            ext = '.sv'; // fallback
            for (const [e, count] of extCounts) {
                if (count > maxCount) {
                    maxCount = count;
                    ext = e;
                }
            }
        }
        return [`${commonDir}/**/*${ext}`];
    }

    return undefined;
}

/**
 * Find the longest common directory prefix among paths.
 * Used to derive scope patterns for knowledge items.
 */
export function findCommonPrefix(paths: string[]): string {
    if (paths.length === 0) return '';
    if (paths.length === 1) return paths[0];

    const sorted = [...paths].sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    let i = 0;
    while (i < first.length && first[i] === last[i]) {
        i++;
    }

    const common = first.slice(0, i);
    // Return up to last path separator
    const lastSep = Math.max(common.lastIndexOf('/'), common.lastIndexOf('\\'));
    return lastSep > 0 ? common.slice(0, lastSep) : common;
}

/**
 * Analyze a code diff to detect common change patterns.
 *
 * Detects HDL-specific patterns:
 * - always → always_ff/always_comb (SystemVerilog 2001 style)
 * - Added reset handling
 * - Naming convention changes (snake_case ↔ camelCase)
 * - Formatting/whitespace changes
 * - Comment additions
 *
 * @returns Description, tags, and keywords for the detected pattern
 */
export function analyzeDiff(
    original: string,
    corrected: string
): { description: string; tags: string[]; keywords: string[] } | null {
    const origLines = original.split('\n');
    const corrLines = corrected.split('\n');

    // Simple diff analysis
    const tags: string[] = [];
    const keywords: string[] = [];
    let description = 'code change';

    // Check for always block type changes
    if (/always\s+@/.test(original) && /always_ff|always_comb/.test(corrected)) {
        tags.push('always-block', 'sv2k');
        keywords.push('always', 'always_ff', 'always_comb');
        description = 'always to always_ff/always_comb';
    }

    // Check for reset pattern changes
    if (/if\s*\(\s*!?\s*(rst|reset)/i.test(corrected) && !/if\s*\(\s*!?\s*(rst|reset)/i.test(original)) {
        tags.push('reset', 'synchronous');
        keywords.push('reset', 'rst');
        description = 'added reset handling';
    }

    // Check for naming convention changes
    const origIds = original.match(/\b[a-z][a-zA-Z0-9_]*\b/g) ?? [];
    const corrIds = corrected.match(/\b[a-z][a-zA-Z0-9_]*\b/g) ?? [];
    if (origIds.length > 0 && corrIds.length > 0) {
        const origStyle = detectNamingStyle(origIds);
        const corrStyle = detectNamingStyle(corrIds);
        if (origStyle !== corrStyle) {
            tags.push('naming', corrStyle);
            keywords.push('naming', 'convention', corrStyle);
            description = `naming: ${origStyle} to ${corrStyle}`;
        }
    }

    // Check for whitespace/formatting changes
    if (original.replace(/\s/g, '') === corrected.replace(/\s/g, '')) {
        tags.push('formatting', 'whitespace');
        keywords.push('format', 'indent');
        description = 'formatting/whitespace';
    }

    // Check for comment additions
    if (corrected.includes('//') && !original.includes('//')) {
        tags.push('documentation', 'comments');
        keywords.push('comment', 'documentation');
        description = 'added comments';
    }

    if (tags.length === 0) {
        // Generic change
        tags.push('code-change');
        const lineDiff = Math.abs(origLines.length - corrLines.length);
        if (lineDiff > 5) {
            description = lineDiff > origLines.length ? 'code expansion' : 'code reduction';
        }
    }

    return { description, tags, keywords };
}

/**
 * Detect the predominant naming convention in a list of identifiers.
 * @returns 'snake_case', 'camelCase', or 'mixed'
 */
export function detectNamingStyle(identifiers: string[]): string {
    const sample = identifiers.slice(0, 20);
    let snakeCount = 0;
    let camelCount = 0;

    for (const id of sample) {
        if (id.includes('_')) snakeCount++;
        if (/[a-z][A-Z]/.test(id)) camelCount++;
    }

    if (snakeCount > camelCount * 2) return 'snake_case';
    if (camelCount > snakeCount * 2) return 'camelCase';
    return 'mixed';
}

/**
 * Analyze generated code to extract metadata for knowledge items.
 *
 * Handles different code types:
 * - FSM: Extracts state names from typedef enum
 * - Testbench: Detects VCD, UVM patterns, DUT instantiation
 * - Module: Detects sequential/combinational logic
 * - Package: Extracts package name
 *
 * @returns Metadata or null if nothing interesting detected
 */
export function analyzeGeneratedCode(
    code: string,
    type: string
): { name: string; summary: string; tags: string[]; keywords: string[] } | null {
    const tags: string[] = [];
    const keywords: string[] = [];
    let name = type;
    let summary = '';

    if (type === 'fsm') {
        // Detect FSM states
        const stateMatch = code.match(/typedef\s+enum[^{]*\{([^}]+)\}/);
        if (stateMatch) {
            const states = stateMatch[1].split(',').map(s => s.trim().split(/\s/)[0]);
            name = `FSM with ${states.length} states`;
            summary = `State machine with states: ${states.slice(0, 5).join(', ')}${states.length > 5 ? '...' : ''}`;
            tags.push('fsm', 'state-machine');
            keywords.push('fsm', 'state', 'enum', ...states.slice(0, 5).map(s => s.toLowerCase()));
        }
    }

    if (type === 'testbench') {
        // Detect testbench patterns
        tags.push('testbench', 'verification');
        keywords.push('testbench', 'tb', 'dut');

        if (/\$dumpfile/.test(code)) {
            tags.push('vcd');
            keywords.push('vcd', 'waveform');
        }

        if (/class\s+\w+\s+extends/.test(code)) {
            tags.push('uvm-style');
            keywords.push('class', 'uvm');
        }

        const dutMatch = code.match(/(\w+)\s+(?:dut|DUT|uut|UUT)\s*\(/);
        if (dutMatch) {
            name = `Testbench for ${dutMatch[1]}`;
            summary = `Testbench instantiating ${dutMatch[1]}`;
        } else {
            summary = 'SystemVerilog testbench';
        }
    }

    if (type === 'module') {
        const moduleMatch = code.match(/module\s+(\w+)/);
        if (moduleMatch) {
            name = moduleMatch[1];
            summary = `Module ${moduleMatch[1]}`;
        }

        // Detect module features
        if (/always_ff/.test(code)) {
            tags.push('sequential');
            keywords.push('always_ff', 'sequential', 'clk');
        }
        if (/always_comb/.test(code)) {
            tags.push('combinational');
            keywords.push('always_comb', 'combinational');
        }
        if (/interface\s+\w+/.test(code)) {
            tags.push('interface');
            keywords.push('interface');
        }
    }

    if (type === 'package') {
        const pkgMatch = code.match(/package\s+(\w+)/);
        if (pkgMatch) {
            name = pkgMatch[1];
            summary = `Package ${pkgMatch[1]}`;
        }
        tags.push('package');
        keywords.push('package', 'typedef', 'parameter');
    }

    if (tags.length === 0) {
        return null; // Nothing interesting to extract
    }

    return { name, summary, tags, keywords };
}

/**
 * Classify a user correction into a KnowledgeType.
 * Used when the user doesn't explicitly specify the type.
 *
 * @returns 'style_preference' for formatting, 'code_pattern' for logic changes
 */
export function detectCorrectionType(original: string, corrected: string): KnowledgeType {
    // Check for style/formatting changes
    if (original.replace(/\s/g, '') === corrected.replace(/\s/g, '')) {
        return 'style_preference';
    }

    // Check for code pattern changes (always blocks, etc.)
    if (/always_ff|always_comb|always_latch/i.test(corrected) !==
        /always_ff|always_comb|always_latch/i.test(original)) {
        return 'code_pattern';
    }

    // Check for reset handling changes
    if (/\b(rst|reset)\b/i.test(corrected) !== /\b(rst|reset)\b/i.test(original)) {
        return 'code_pattern';
    }

    // Default to style preference
    return 'style_preference';
}

/**
 * Convert a specific file path to a directory glob pattern.
 * Example: "src/rtl/alu.sv" → "src/rtl/**\/*.sv"
 */
export function toGlobPattern(filePath: string): string {
    const ext = path.extname(filePath);
    const dir = path.dirname(filePath);
    return `${dir}/**/*${ext}`;
}

