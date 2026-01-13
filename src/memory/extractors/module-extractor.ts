/**
 * Extract module/interface/package information from indexer output
 * @module memory/extractors/module-extractor
 */

import type { ResolvedProject, Declaration } from '../../indexer/types/index.js';
import type { KnowledgeStore } from '../KnowledgeStore.js';
import type { ExtractionOptions } from './types.js';
import * as path from 'path';
import picomatch from 'picomatch';

/**
 * Extract module_info knowledge items from declarations
 *
 * @param project - Resolved project from indexer
 * @param store - KnowledgeStore instance to add items to
 * @param options - Extraction configuration
 * @returns Number of items extracted
 */
export function extractModuleInfo(
    project: ResolvedProject,
    store: KnowledgeStore,
    options: ExtractionOptions
): number {
    let count = 0;
    const maxItems = options.maxItemsPerCategory ?? 500;

    // Filter to only module-like declarations
    const moduleDeclarations = project.declarations.filter(
        decl => ['module', 'interface', 'package'].includes(decl.kind)
    );

    for (const decl of moduleDeclarations) {
        // Check extraction limit
        if (count >= maxItems) {
            break;
        }

        // Check include/exclude patterns
        if (!shouldIncludeFile(decl.location.file, options)) {
            continue;
        }

        // Find child declarations (ports, parameters)
        const ports = findChildPorts(decl.id, decl.name, project.declarations);
        const params = findChildParameters(decl.id, decl.name, project.declarations);

        // Determine if this is a top-level module (not instantiated)
        const isTop = !project.instances.some(inst =>
            inst.targetName === decl.name || inst.resolvedId === decl.id
        );

        // Format port summary
        const portSummary = formatPortSummary(ports);

        // Format parameter summary
        const paramSummary = formatParamSummary(params);

        // Build keywords for search
        const keywords = buildKeywords(decl, ports, params);

        // Create knowledge item
        store.addKnowledge({
            type: 'module_info',
            title: `${capitalize(decl.kind)}: ${decl.name}`,
            content: formatModuleContent(decl, portSummary, paramSummary, isTop),
            tags: buildTags(decl, isTop),
            keywords,
            scope: {
                global: false,
                projectIds: [options.projectId],
                modules: [decl.name]
            },
            source: {
                method: 'extracted',
                sessionId: options.sessionId,
                filePath: decl.location.file,
                tool: 'indexer'
            },
            confidence: 1.0  // Deterministic from parser
        });

        count++;
    }

    return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find port declarations that belong to a parent module
 */
function findChildPorts(
    parentId: string,
    parentName: string,
    declarations: Declaration[]
): Declaration[] {
    return declarations.filter(
        d => d.kind === 'port' &&
             (d.parentId === parentId ||
              (d.scope.length > 0 && d.scope[d.scope.length - 1] === parentName))
    );
}

/**
 * Find parameter declarations that belong to a parent module
 */
function findChildParameters(
    parentId: string,
    parentName: string,
    declarations: Declaration[]
): Declaration[] {
    return declarations.filter(
        d => (d.kind === 'parameter' || d.kind === 'localparam') &&
             (d.parentId === parentId ||
              (d.scope.length > 0 && d.scope[d.scope.length - 1] === parentName))
    );
}

/**
 * Format port list as human-readable string
 */
function formatPortSummary(ports: Declaration[]): string {
    if (ports.length === 0) return '';

    const portStrings = ports.map(p => {
        const data = p.data as {
            direction?: string;
            portType?: string;
            width?: string;
            packed?: string;
        };

        const dir = data.direction || 'inout';
        const type = data.portType || 'logic';
        const width = data.width || data.packed || '';

        return `${dir} ${type}${width ? `[${width}]` : ''} ${p.name}`;
    });

    // Truncate if too many ports
    if (portStrings.length > 10) {
        return portStrings.slice(0, 10).join(', ') +
               `, ... (${ports.length - 10} more)`;
    }

    return portStrings.join(', ');
}

/**
 * Format parameter list as human-readable string
 */
function formatParamSummary(params: Declaration[]): string {
    if (params.length === 0) return '';

    const paramStrings = params.map(p => {
        const data = p.data as {
            paramType?: string;
            defaultValue?: string;
        };

        const defaultVal = data.defaultValue ? ` = ${data.defaultValue}` : '';
        const type = data.paramType ? `${data.paramType} ` : '';

        return `${type}${p.name}${defaultVal}`;
    });

    // Truncate if too many params
    if (paramStrings.length > 5) {
        return paramStrings.slice(0, 5).join(', ') +
               `, ... (${params.length - 5} more)`;
    }

    return paramStrings.join(', ');
}

/**
 * Format full module content for knowledge item
 */
function formatModuleContent(
    decl: Declaration,
    portSummary: string,
    paramSummary: string,
    isTop: boolean
): string {
    const lines: string[] = [];

    // Location line
    lines.push(`${decl.kind} ${decl.name} at ${formatLocation(decl)}`);

    // Top-level indicator
    if (isTop) {
        lines.push('This is a top-level module (not instantiated by others)');
    }

    // Parameters
    if (paramSummary) {
        lines.push(`Parameters: ${paramSummary}`);
    }

    // Ports
    if (portSummary) {
        lines.push(`Ports: ${portSummary}`);
    } else if (decl.kind === 'module') {
        lines.push('Ports: none');
    }

    return lines.join('\n');
}

/**
 * Format file location for display
 */
function formatLocation(decl: Declaration): string {
    const filename = path.basename(decl.location.file);
    return `${filename}:${decl.location.line}`;
}

/**
 * Build search keywords from declaration and children
 */
function buildKeywords(
    decl: Declaration,
    ports: Declaration[],
    params: Declaration[]
): string[] {
    const keywords: string[] = [];

    // Module name (split on underscores too)
    keywords.push(decl.name.toLowerCase());
    if (decl.name.includes('_')) {
        keywords.push(...decl.name.split('_').map(s => s.toLowerCase()));
    }

    // Port names
    for (const p of ports.slice(0, 20)) {  // Limit to avoid huge keyword lists
        keywords.push(p.name.toLowerCase());
    }

    // Parameter names
    for (const p of params.slice(0, 10)) {
        keywords.push(p.name.toLowerCase());
    }

    // Common HDL terms based on port patterns
    const portNames = ports.map(p => p.name.toLowerCase()).join(' ');
    if (portNames.includes('clk') || portNames.includes('clock')) {
        keywords.push('sequential', 'clocked');
    }
    if (portNames.includes('rst') || portNames.includes('reset')) {
        keywords.push('reset');
    }
    if (portNames.includes('axi') || portNames.includes('apb')) {
        keywords.push('bus', 'interface');
    }

    return [...new Set(keywords)];  // Deduplicate
}

/**
 * Build tags for filtering
 */
function buildTags(decl: Declaration, isTop: boolean): string[] {
    const tags = [
        decl.kind,           // 'module', 'interface', 'package'
        'structure',         // Category
        'namespace:facts'    // Namespace convention
    ];

    if (isTop) {
        tags.push('top-level');
    }

    // Add directory-based tag
    const dir = path.dirname(decl.location.file);
    if (dir.includes('rtl') || dir.includes('src')) {
        tags.push('rtl');
    } else if (dir.includes('tb') || dir.includes('test')) {
        tags.push('testbench');
    }

    return tags;
}

/**
 * Check if file should be included based on patterns
 */
function shouldIncludeFile(
    filePath: string,
    options: ExtractionOptions
): boolean {
    // Check exclude patterns first
    if (options.excludePatterns?.length) {
        for (const pattern of options.excludePatterns) {
            if (picomatch.isMatch(filePath, pattern)) {
                return false;
            }
        }
    }

    // Check include patterns
    if (options.includePatterns?.length) {
        for (const pattern of options.includePatterns) {
            if (picomatch.isMatch(filePath, pattern)) {
                return true;
            }
        }
        return false;  // Include patterns specified but none matched
    }

    return true;  // No include patterns = include all
}

/**
 * Capitalize first letter
 */
function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
