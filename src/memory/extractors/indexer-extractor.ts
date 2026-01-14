/**
 * Main orchestrator for extracting knowledge from indexer output
 * @module memory/extractors/indexer-extractor
 */

import type { ResolvedProject } from '../../indexer/types/index.js';
import type { KnowledgeStore } from '../KnowledgeStore.js';
import type { ExtractedCount, ExtractionOptions, ExtractionResult } from './types.js';
import { extractModuleInfo } from './module-extractor.js';
import { extractDependencies } from './dependency-extractor.js';
import { extractHierarchy } from './hierarchy-extractor.js';

/**
 * Extract all knowledge from a resolved project
 *
 * This is the main entry point for indexer→memory integration.
 * Call this after SVIndexer.indexProject() or SVIndexer.indexFiles()
 * completes successfully.
 *
 * @param project - Resolved project from indexer
 * @param store - KnowledgeStore instance to add items to
 * @param options - Extraction configuration
 * @returns Result with counts and success status
 *
 * @example
 * ```typescript
 * const project = await indexer.indexProject(filelistPath);
 * const result = await extractFromIndex(project, knowledgeStore, {
 *     projectId: store.getProjectId(),
 *     sessionId: crypto.randomUUID()
 * });
 * console.log(`Extracted ${result.counts.modules} modules`);
 * ```
 */
export async function extractFromIndex(
    project: ResolvedProject,
    store: KnowledgeStore,
    options: ExtractionOptions
): Promise<ExtractionResult> {
    const startTime = Date.now();

    const counts: ExtractedCount = {
        modules: 0,
        interfaces: 0,
        packages: 0,
        dependencies: 0,
        hierarchy: 0
    };

    try {
        // Validate options
        validateOptions(options);

        // Extract module information (modules, interfaces, packages)
        if (options.extractModules !== false) {
            const moduleCount = extractModuleInfo(project, store, options);

            // Count by kind for detailed stats
            let moduleKindCount = 0;
            let interfaceKindCount = 0;
            let packageKindCount = 0;

            for (const decl of project.declarations) {
                if (decl.kind === 'module') moduleKindCount++;
                else if (decl.kind === 'interface') interfaceKindCount++;
                else if (decl.kind === 'package') packageKindCount++;
            }

            // Clamp to actual extracted (in case of maxItemsPerCategory)
            const totalDesignUnits = moduleKindCount + interfaceKindCount + packageKindCount;
            if (totalDesignUnits > 0 && moduleCount < totalDesignUnits) {
                // Proportionally distribute counts, ensuring they sum to moduleCount
                const ratio = moduleCount / totalDesignUnits;
                counts.modules = Math.round(moduleKindCount * ratio);
                counts.interfaces = Math.round(interfaceKindCount * ratio);
                // Assign remainder to packages to ensure exact sum
                counts.packages = moduleCount - counts.modules - counts.interfaces;
                // Clamp to non-negative in edge cases
                if (counts.packages < 0) {
                    counts.packages = 0;
                    counts.interfaces = moduleCount - counts.modules;
                    if (counts.interfaces < 0) {
                        counts.interfaces = 0;
                        counts.modules = moduleCount;
                    }
                }
            } else {
                counts.modules = moduleKindCount;
                counts.interfaces = interfaceKindCount;
                counts.packages = packageKindCount;
            }
        }

        // Extract file dependencies
        if (options.extractDependencies !== false) {
            counts.dependencies = extractDependencies(project, store, options);
        }

        // Extract hierarchy
        if (options.extractHierarchy !== false) {
            counts.hierarchy = extractHierarchy(project, store, options);
        }

        return {
            success: true,
            counts,
            durationMs: Date.now() - startTime
        };

    } catch (error) {
        return {
            success: false,
            counts,
            error: error instanceof Error ? error.message : 'Unknown error',
            durationMs: Date.now() - startTime
        };
    }
}

/**
 * Extract only module information (lighter weight)
 */
export async function extractModulesOnly(
    project: ResolvedProject,
    store: KnowledgeStore,
    options: ExtractionOptions
): Promise<ExtractionResult> {
    return extractFromIndex(project, store, {
        ...options,
        extractModules: true,
        extractDependencies: false,
        extractHierarchy: false
    });
}

/**
 * Validate extraction options
 */
function validateOptions(options: ExtractionOptions): void {
    if (!options.projectId) {
        throw new Error('ExtractionOptions.projectId is required');
    }
    if (!options.sessionId) {
        throw new Error('ExtractionOptions.sessionId is required');
    }

    // Validate projectId format (12-char hex)
    if (!/^[a-f0-9]{12}$/i.test(options.projectId)) {
        throw new Error(
            `Invalid projectId format: ${options.projectId}. ` +
            `Expected 12-character hex string.`
        );
    }

    // Validate sessionId format (UUID)
    if (!/^[a-f0-9-]{36}$/i.test(options.sessionId)) {
        throw new Error(
            `Invalid sessionId format: ${options.sessionId}. ` +
            `Expected UUID format.`
        );
    }
}

/**
 * Create default extraction options with required fields
 */
export function createExtractionOptions(
    projectId: string,
    overrides?: Partial<Omit<ExtractionOptions, 'projectId' | 'sessionId'>>
): ExtractionOptions {
    return {
        projectId,
        sessionId: crypto.randomUUID(),
        extractModules: true,
        extractDependencies: true,
        extractHierarchy: true,
        minConfidence: 0.9,
        maxItemsPerCategory: 500,
        ...overrides
    };
}

/**
 * Get extraction summary as human-readable string
 */
export function formatExtractionSummary(result: ExtractionResult): string {
    if (!result.success) {
        return `Extraction failed: ${result.error}`;
    }

    const { counts, durationMs } = result;
    const total =
        counts.modules +
        counts.interfaces +
        counts.packages +
        counts.dependencies +
        counts.hierarchy;

    const parts: string[] = [];

    if (counts.modules > 0) parts.push(`${counts.modules} modules`);
    if (counts.interfaces > 0) parts.push(`${counts.interfaces} interfaces`);
    if (counts.packages > 0) parts.push(`${counts.packages} packages`);
    if (counts.dependencies > 0) parts.push(`${counts.dependencies} dependencies`);
    if (counts.hierarchy > 0) parts.push(`${counts.hierarchy} hierarchy nodes`);

    return `Extracted ${total} items (${parts.join(', ')}) in ${durationMs}ms`;
}

// Re-export types for convenience
export type { ExtractedCount, ExtractionOptions, ExtractionResult } from './types.js';
