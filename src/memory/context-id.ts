/**
 * Context ID helpers for KnowledgeStore scoping.
 */

import * as crypto from 'crypto';

export function computeDefineContextId(
    defines: Record<string, string> = {},
    includePaths: string[] = []
): string {
    const sortedDefines = Object.entries(defines).sort(([a], [b]) => a.localeCompare(b));
    const normalizedPaths = includePaths.map(p => p.replace(/\\/g, '/'));
    const canonical = JSON.stringify([sortedDefines, normalizedPaths]);
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function computeCompileOrderId(filesInOrder: string[] = []): string {
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    for (const f of filesInOrder) {
        const normalized = f.replace(/\\/g, '/');
        if (!seen.has(normalized)) {
            seen.add(normalized);
            deduplicated.push(normalized);
        }
    }
    const canonical = deduplicated.join('\n');
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

