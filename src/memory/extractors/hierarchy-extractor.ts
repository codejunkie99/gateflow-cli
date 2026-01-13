/**
 * Extract module hierarchy from indexer output
 * @module memory/extractors/hierarchy-extractor
 */

import type { ResolvedProject, HierarchyNode } from '../../indexer/types/index.js';
import type { KnowledgeStore } from '../KnowledgeStore.js';
import type { ExtractionOptions } from './types.js';
import * as path from 'path';
import picomatch from 'picomatch';

/**
 * Extract hierarchy knowledge items from hierarchy tree
 *
 * @param project - Resolved project from indexer
 * @param store - KnowledgeStore instance to add items to
 * @param options - Extraction configuration
 * @returns Number of items extracted
 */
export function extractHierarchy(
    project: ResolvedProject,
    store: KnowledgeStore,
    options: ExtractionOptions
): number {
    let count = 0;
    const maxItems = options.maxItemsPerCategory ?? 500;

    // Flatten the hierarchy tree
    const flattened = flattenHierarchy(project.hierarchy);

    // Also create a project overview item
    if (project.hierarchy.length > 0) {
        count += extractProjectOverview(project, store, options);
    }

    for (const node of flattened) {
        // Check extraction limit
        if (count >= maxItems) {
            break;
        }

        // Check include/exclude patterns
        if (!shouldIncludeFile(node.file, options)) {
            continue;
        }

        const fileBase = path.basename(node.file);

        // Create knowledge item
        store.addKnowledge({
            type: 'project_context',
            title: formatTitle(node),
            content: formatContent(node, fileBase),
            tags: buildTags(node, project.hierarchy),
            keywords: buildKeywords(node),
            scope: {
                global: false,
                projectIds: [options.projectId],
                modules: [node.moduleName]
            },
            source: {
                method: 'extracted',
                sessionId: options.sessionId,
                filePath: node.file,
                tool: 'indexer'
            },
            confidence: 1.0
        });

        count++;
    }

    return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Flatten hierarchy tree to list, with depth tracking
 */
interface FlatNode extends HierarchyNode {
    depth: number;
    parentModule?: string;
    parentInstance?: string;
}

function flattenHierarchy(roots: HierarchyNode[]): FlatNode[] {
    const result: FlatNode[] = [];

    function walk(
        node: HierarchyNode,
        depth: number,
        parentModule?: string,
        parentInstance?: string
    ): void {
        result.push({
            ...node,
            depth,
            parentModule,
            parentInstance
        });

        for (const child of node.children) {
            walk(child, depth + 1, node.moduleName, node.instanceName);
        }
    }

    for (const root of roots) {
        walk(root, 0);
    }

    return result;
}

/**
 * Extract a project overview knowledge item
 */
function extractProjectOverview(
    project: ResolvedProject,
    store: KnowledgeStore,
    options: ExtractionOptions
): number {
    const topModules = project.hierarchy.map(h => h.moduleName);
    const totalNodes = countNodes(project.hierarchy);
    const maxDepth = getMaxDepth(project.hierarchy);

    store.addKnowledge({
        type: 'project_context',
        title: 'Project Hierarchy Overview',
        content: formatOverviewContent(topModules, totalNodes, maxDepth),
        tags: ['hierarchy', 'overview', 'namespace:facts'],
        keywords: [...topModules.map(m => m.toLowerCase()), 'hierarchy', 'structure'],
        scope: {
            global: false,
            projectIds: [options.projectId]
        },
        source: {
            method: 'extracted',
            sessionId: options.sessionId,
            tool: 'indexer'
        },
        confidence: 1.0
    });

    return 1;
}

/**
 * Count total nodes in hierarchy
 */
function countNodes(roots: HierarchyNode[]): number {
    let count = 0;

    function walk(node: HierarchyNode): void {
        count++;
        for (const child of node.children) {
            walk(child);
        }
    }

    for (const root of roots) {
        walk(root);
    }

    return count;
}

/**
 * Get maximum depth of hierarchy
 */
function getMaxDepth(roots: HierarchyNode[]): number {
    let maxDepth = 0;

    function walk(node: HierarchyNode, depth: number): void {
        maxDepth = Math.max(maxDepth, depth);
        for (const child of node.children) {
            walk(child, depth + 1);
        }
    }

    for (const root of roots) {
        walk(root, 0);
    }

    return maxDepth;
}

/**
 * Format overview content
 */
function formatOverviewContent(
    topModules: string[],
    totalNodes: number,
    maxDepth: number
): string {
    const lines: string[] = [];

    lines.push(`Top-level modules: ${topModules.join(', ')}`);
    lines.push(`Total module instances: ${totalNodes}`);
    lines.push(`Maximum hierarchy depth: ${maxDepth} levels`);

    if (topModules.length === 1) {
        lines.push(`Single top design: ${topModules[0]}`);
    } else if (topModules.length > 1) {
        lines.push(`Multiple top designs (possibly separate testbenches or configurations)`);
    }

    return lines.join('\n');
}

/**
 * Format title for individual hierarchy node
 */
function formatTitle(node: FlatNode): string {
    if (node.depth === 0) {
        return `Top: ${node.moduleName}`;
    }
    return `Instance: ${node.instanceName} (${node.moduleName})`;
}

/**
 * Format content for individual node
 */
function formatContent(node: FlatNode, fileBase: string): string {
    const lines: string[] = [];

    if (node.depth === 0) {
        lines.push(`Top-level module ${node.moduleName}`);
        lines.push(`Defined in ${fileBase}:${node.line}`);
        if (node.children.length > 0) {
            lines.push(`Contains ${node.children.length} direct child instance(s)`);
        }
    } else {
        lines.push(`Instance ${node.instanceName} of module ${node.moduleName}`);
        lines.push(`Instantiated at ${fileBase}:${node.line}`);
        if (node.parentModule && node.parentInstance) {
            lines.push(`Parent: ${node.parentInstance} (${node.parentModule})`);
        }
        lines.push(`Depth: ${node.depth} level(s) from top`);
    }

    return lines.join('\n');
}

/**
 * Build tags for hierarchy node
 */
function buildTags(node: FlatNode, roots: HierarchyNode[]): string[] {
    const tags = [
        'hierarchy',
        'instance',
        'namespace:facts'
    ];

    if (node.depth === 0) {
        tags.push('top-level');
    }

    // Tag leaf nodes (no children)
    if (node.children.length === 0) {
        tags.push('leaf');
    }

    return tags;
}

/**
 * Build keywords for search
 */
function buildKeywords(node: FlatNode): string[] {
    const keywords: string[] = [];

    // Instance name
    keywords.push(node.instanceName.toLowerCase());

    // Module name
    keywords.push(node.moduleName.toLowerCase());

    // Split on underscores
    if (node.moduleName.includes('_')) {
        keywords.push(...node.moduleName.split('_').map(s => s.toLowerCase()));
    }
    if (node.instanceName.includes('_')) {
        keywords.push(...node.instanceName.split('_').map(s => s.toLowerCase()));
    }

    // Parent info
    if (node.parentModule) {
        keywords.push(node.parentModule.toLowerCase());
    }

    // Hierarchy keywords
    keywords.push('hierarchy', 'instance');
    if (node.depth === 0) {
        keywords.push('top');
    }

    return [...new Set(keywords)];
}

/**
 * Check if file should be included based on patterns
 */
function shouldIncludeFile(
    filePath: string,
    options: ExtractionOptions
): boolean {
    if (options.excludePatterns?.length) {
        for (const pattern of options.excludePatterns) {
            if (picomatch.isMatch(filePath, pattern)) {
                return false;
            }
        }
    }

    if (options.includePatterns?.length) {
        for (const pattern of options.includePatterns) {
            if (picomatch.isMatch(filePath, pattern)) {
                return true;
            }
        }
        return false;
    }

    return true;
}
