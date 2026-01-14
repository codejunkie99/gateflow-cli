/**
 * KnowledgeStore Index & Metadata Utilities
 * @module knowledge-store/store-utils
 *
 * Low-level utilities for managing knowledge index structure:
 *
 * - `arraysEqual()` - Compare string arrays for content equality
 * - `computeFingerprint()` - Generate deduplication key from item properties
 * - `createDefaultIndex()` - Initialize empty index structure
 * - `migrateIndex()` - Upgrade old index formats, add missing fingerprints
 * - `updateStats()` - Recompute statistics from items array
 *
 * ## Fingerprinting
 * Fingerprints are SHA-256 hashes (truncated to 16 chars) of:
 * - Knowledge type
 * - Normalized title (lowercase, single spaces, alphanumeric only)
 * - Sorted scope components
 *
 * This allows detecting duplicate knowledge even when IDs differ.
 */

import * as crypto from 'crypto';
import type {
    KnowledgeIndex,
    KnowledgeScope,
    KnowledgeType
} from '../knowledge-types.js';

/**
 * Compare two string arrays for content equality (order-independent).
 */
export function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sorted1 = [...a].sort();
    const sorted2 = [...b].sort();
    return sorted1.every((v, i) => v === sorted2[i]);
}

/**
 * Compute a unique fingerprint for deduplication.
 * Items with the same fingerprint are considered duplicates.
 *
 * @param type - Knowledge type (e.g., 'lint_fix', 'code_pattern')
 * @param title - Item title (will be normalized)
 * @param scope - Scope constraints
 * @returns 16-character hex fingerprint
 */
export function computeFingerprint(type: KnowledgeType, title: string, scope: KnowledgeScope): string {
    const normalizedTitle = title.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim();
    const scopeParts: string[] = [];
    if (scope.global) scopeParts.push('global');
    if (scope.modules?.length) scopeParts.push(`m:${[...scope.modules].sort().join(',')}`);
    if (scope.filePatterns?.length) scopeParts.push(`f:${[...scope.filePatterns].sort().join(',')}`);

    return crypto
        .createHash('sha256')
        .update(`${type}|${normalizedTitle}|${scopeParts.join('|')}`)
        .digest('hex')
        .slice(0, 16);
}

/**
 * Create an empty knowledge index for a new project.
 */
export function createDefaultIndex(projectId: string): KnowledgeIndex {
    return {
        version: 1,
        projectId,
        items: [],
        stats: { totalItems: 0, byType: {} as Record<KnowledgeType, number>, lastUpdated: Date.now() }
    };
}

/**
 * Migrate an existing index to the current format.
 * - Merges with default structure (adds missing fields)
 * - Computes fingerprints for items that lack them
 */
export function migrateIndex(index: KnowledgeIndex, projectId: string): KnowledgeIndex {
    const migrated = { ...createDefaultIndex(projectId), ...index };
    for (const item of migrated.items) {
        if (!item.fingerprint) {
            item.fingerprint = computeFingerprint(item.type, item.title, item.scope);
        }
    }
    return migrated;
}

/**
 * Recompute index statistics from the items array.
 * Called before save to ensure stats are accurate.
 */
export function updateStats(index: KnowledgeIndex): void {
    const byType: Record<string, number> = {};
    for (const item of index.items) {
        byType[item.type] = (byType[item.type] || 0) + 1;
    }
    index.stats = {
        totalItems: index.items.length,
        byType: byType as Record<KnowledgeType, number>,
        lastUpdated: Date.now()
    };
}
