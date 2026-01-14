/**
 * Extract file dependency relationships from indexer output
 * @module memory/extractors/dependency-extractor
 */

import type { ResolvedProject, FileDependency } from '../../indexer/types/index.js';
import type { KnowledgeStore } from '../KnowledgeStore.js';
import type { ExtractionOptions } from './types.js';
import * as path from 'path';
import picomatch from 'picomatch';

/**
 * Extract dependency knowledge items from file dependencies
 *
 * @param project - Resolved project from indexer
 * @param store - KnowledgeStore instance to add items to
 * @param options - Extraction configuration
 * @returns Number of items extracted
 */
export function extractDependencies(
    project: ResolvedProject,
    store: KnowledgeStore,
    options: ExtractionOptions
): number {
    let count = 0;
    const maxItems = options.maxItemsPerCategory ?? 500;

    // Group dependencies by reason for better organization
    const byReason = groupByReason(project.dependencies);

    for (const [reason, deps] of byReason) {
        for (const dep of deps) {
            // Check extraction limit
            if (count >= maxItems) {
                break;
            }

            // Check include/exclude patterns
            if (!shouldIncludeFiles(dep.fromFile, dep.toFile, options)) {
                continue;
            }

            const fromBase = path.basename(dep.fromFile);
            const toBase = path.basename(dep.toFile);

            // Create knowledge item
            store.addKnowledge({
                type: 'dependency',
                title: formatTitle(dep),
                content: formatContent(dep, fromBase, toBase),
                tags: buildTags(dep),
                keywords: buildKeywords(dep, fromBase, toBase),
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

            count++;
        }

        // Check limit after each reason group
        if (count >= maxItems) break;
    }

    return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Group dependencies by reason for organized extraction
 */
function groupByReason(
    deps: FileDependency[]
): Map<string, FileDependency[]> {
    const grouped = new Map<string, FileDependency[]>();

    for (const dep of deps) {
        const existing = grouped.get(dep.reason) ?? [];
        existing.push(dep);
        grouped.set(dep.reason, existing);
    }

    return grouped;
}

/**
 * Format title based on dependency reason
 */
function formatTitle(dep: FileDependency): string {
    switch (dep.reason) {
        case 'instantiates':
            return `Instantiates: ${dep.entityName}`;
        case 'imports':
            return `Imports: ${dep.entityName}`;
        case 'includes':
            return `Includes: ${path.basename(dep.toFile)}`;
        case 'extends':
            return `Extends: ${dep.entityName}`;
        case 'uses_macro':
            return `Uses macro: ${dep.entityName}`;
        default:
            return `Depends on: ${dep.entityName}`;
    }
}

/**
 * Format detailed content description
 */
function formatContent(
    dep: FileDependency,
    fromBase: string,
    toBase: string
): string {
    const lines: string[] = [];

    // Main relationship description
    switch (dep.reason) {
        case 'instantiates':
            lines.push(`${fromBase} instantiates module ${dep.entityName} from ${toBase}`);
            break;
        case 'imports':
            lines.push(`${fromBase} imports package ${dep.entityName} from ${toBase}`);
            break;
        case 'includes':
            lines.push(`${fromBase} includes file ${toBase}`);
            break;
        case 'extends':
            lines.push(`${fromBase} extends class ${dep.entityName} from ${toBase}`);
            break;
        case 'uses_macro':
            lines.push(`${fromBase} uses macro ${dep.entityName} defined in ${toBase}`);
            break;
        default:
            lines.push(`${fromBase} depends on ${dep.entityName} from ${toBase}`);
    }

    // Add conditional compilation info if present
    const guardCondition = getGuardCondition(dep.guard);
    if (guardCondition) {
        lines.push(`Conditional: only when ${guardCondition} is defined`);
    }

    return lines.join('\n');
}

/**
 * Build tags for filtering
 */
function buildTags(dep: FileDependency): string[] {
    const tags = [
        'dependency',
        dep.reason,
        'namespace:facts'
    ];

    // Add structural context tags
    if (dep.reason === 'instantiates') {
        tags.push('hierarchy');
    }
    if (dep.reason === 'imports') {
        tags.push('package');
    }
    if (dep.guard) {
        tags.push('conditional');
    }

    return tags;
}

/**
 * Build keywords for search
 */
function buildKeywords(
    dep: FileDependency,
    fromBase: string,
    toBase: string
): string[] {
    const keywords: string[] = [];

    // Entity name (main search term)
    keywords.push(dep.entityName.toLowerCase());

    // Entity name split on underscores
    if (dep.entityName.includes('_')) {
        keywords.push(...dep.entityName.split('_').map(s => s.toLowerCase()));
    }

    // File names without extension
    keywords.push(fromBase.replace(/\.[^.]+$/, '').toLowerCase());
    keywords.push(toBase.replace(/\.[^.]+$/, '').toLowerCase());

    // Relationship type
    keywords.push(dep.reason);

    // Conditional guard keyword
    const guardCondition = getGuardCondition(dep.guard);
    if (guardCondition) {
        keywords.push(guardCondition.toLowerCase());
    }

    return [...new Set(keywords)];
}

/**
 * Check if both files should be included based on patterns
 */
function shouldIncludeFiles(
    fromFile: string,
    toFile: string,
    options: ExtractionOptions
): boolean {
    // Check exclude patterns
    if (options.excludePatterns?.length) {
        for (const pattern of options.excludePatterns) {
            if (picomatch.isMatch(fromFile, pattern) ||
                picomatch.isMatch(toFile, pattern)) {
                return false;
            }
        }
    }

    // Check include patterns (at least one file must match)
    if (options.includePatterns?.length) {
        let anyMatch = false;
        for (const pattern of options.includePatterns) {
            if (picomatch.isMatch(fromFile, pattern) ||
                picomatch.isMatch(toFile, pattern)) {
                anyMatch = true;
                break;
            }
        }
        return anyMatch;
    }

    return true;
}

/**
 * Safely extract guard condition from potentially malformed dependency data.
 */
function getGuardCondition(guard: FileDependency['guard']): string | null {
    if (!guard) return null;
    if (typeof guard === 'string') return guard;
    if (typeof guard === 'object' && typeof guard.condition === 'string') {
        return guard.condition;
    }
    return null;
}
