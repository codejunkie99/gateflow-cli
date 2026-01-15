/**
 * KnowledgeStore Extraction
 * @module knowledge-store/extraction
 *
 * Functions to build knowledge items from various sources:
 *
 * ## Sources
 * - **Lint sessions**: Extract recurring error patterns and fixes
 * - **Code generation**: Learn from generated FSMs, testbenches, modules
 * - **User corrections**: Capture style preferences from manual edits
 *
 * ## Architecture
 * Each extraction function receives an ExtractionDependencies object that
 * provides access to the store without creating circular dependencies:
 *
 * ```
 * KnowledgeStore.extractFromLintSession()
 *       │
 *       ├── deps = { projectId, addKnowledge, scheduleSave }
 *       │
 *       └── extractFromLintSession(deps, sessionId, errors, fixes)
 *             └── analysis-utils.ts (pattern detection)
 * ```
 *
 * ## Confidence Levels
 * - 0.5-0.9: Lint patterns (based on occurrence frequency)
 * - 0.7: Generated code patterns
 * - 0.75: Lint fix pairs
 * - 0.95: User corrections (explicit preference)
 */

import type { KnowledgeItem, KnowledgeType } from '../knowledge-types.js';
import {
    analyzeDiff,
    analyzeGeneratedCode,
    detectCorrectionType,
    extractKeywordsFromError,
    inferFilePatterns,
    normalizeErrorMessage,
    toGlobPattern
} from './analysis-utils.js';

/**
 * Partial KnowledgeItem for addKnowledge() input.
 * Excludes fields that are auto-generated (id, fingerprint, timestamps).
 */
export type KnowledgeAddInput = Omit<
    KnowledgeItem,
    'id' | 'fingerprint' | 'created' | 'updated' | 'useCount' | 'lastAccessed'
>;

/**
 * Dependencies injected into extraction functions.
 * Avoids circular imports between extraction.ts and KnowledgeStore.
 */
export interface ExtractionDependencies {
    /** Project identifier for scoping */
    projectId: string;
    /** Optional context ID for scoping */
    defineContextId?: string;
    /** Optional compile order ID for MFCU tools */
    compileOrderId?: string;
    /** Bound method to add knowledge items */
    addKnowledge: (item: KnowledgeAddInput) => KnowledgeItem;
    /** Trigger debounced save */
    scheduleSave: () => void;
}

/**
 * Extract knowledge from a lint session.
 *
 * 1. Groups errors by normalized message pattern
 * 2. Creates lint_fix items for patterns appearing 2+ times
 * 3. Learns from fix pairs (before/after code)
 *
 * @param deps - Injected store dependencies
 * @param sessionId - Unique session identifier for provenance
 * @param errors - Lint errors with optional suggested fixes
 * @param fixes - Applied fix pairs (original → fixed code)
 * @returns Array of created knowledge items
 */
export function extractFromLintSession(
    deps: ExtractionDependencies,
    sessionId: string,
    errors: Array<{ file: string; message: string; fix?: string }>,
    fixes: Array<{ file: string; original: string; fixed: string }>
): KnowledgeItem[] {
    const extracted: KnowledgeItem[] = [];

    // Group errors by message pattern (ignore file-specific details)
    const errorPatterns = new Map<string, { count: number; files: Set<string>; fix?: string }>();

    for (const error of errors) {
        // Normalize message: remove line numbers, file paths, and identifiers
        const normalized = normalizeErrorMessage(error.message);
        const existing = errorPatterns.get(normalized);

        if (existing) {
            existing.count++;
            existing.files.add(error.file);
            if (error.fix && !existing.fix) {
                existing.fix = error.fix;
            }
        } else {
            errorPatterns.set(normalized, {
                count: 1,
                files: new Set([error.file]),
                fix: error.fix
            });
        }
    }

    // Extract patterns that appear multiple times
    for (const [pattern, data] of errorPatterns) {
        if (data.count < 2) continue;

        // Calculate confidence based on frequency
        const confidence = Math.min(0.5 + (data.count * 0.1), 0.9);

        const item = deps.addKnowledge({
            type: 'lint_fix',
            title: `Lint pattern: ${pattern.slice(0, 50)}`,
            content: data.fix
                ? `Error: ${pattern}\n\nSuggested fix: ${data.fix}`
                : `Common error: ${pattern}\n\nOccurrences: ${data.count}`,
            tags: ['lint', 'error-pattern'],
            keywords: extractKeywordsFromError(pattern),
            scope: {
                global: false,
                projectIds: [deps.projectId],
                filePatterns: inferFilePatterns(data.files),
                defineContextId: deps.defineContextId,
                compileOrderId: deps.compileOrderId
            },
            source: {
                method: 'extracted',
                sessionId,
                tool: 'lint'
            },
            confidence
        });

        extracted.push(item);
    }

    // Learn from fix pairs
    for (const fix of fixes) {
        const diffPattern = analyzeDiff(fix.original, fix.fixed);
        if (!diffPattern) continue;

        const item = deps.addKnowledge({
            type: 'lint_fix',
            title: `Fix pattern: ${diffPattern.description}`,
            content: `Before:\n\`\`\`\n${fix.original.slice(0, 200)}\n\`\`\`\n\nAfter:\n\`\`\`\n${fix.fixed.slice(0, 200)}\n\`\`\``,
            tags: ['lint', 'fix', ...diffPattern.tags],
            keywords: diffPattern.keywords,
            scope: {
                global: false,
                projectIds: [deps.projectId],
                defineContextId: deps.defineContextId,
                compileOrderId: deps.compileOrderId
            },
            source: {
                method: 'extracted',
                sessionId,
                filePath: fix.file,
                tool: 'lint'
            },
            confidence: 0.75
        });

        extracted.push(item);
    }

    // Note: scheduleSave() is already called by addKnowledge() via markDirty(),
    // so no need to call it again here

    return extracted;
}

/**
 * Extract knowledge from generated code.
 *
 * Analyzes the generated code to detect patterns worth remembering:
 * - FSM state structures
 * - Testbench patterns (VCD, UVM)
 * - Module characteristics (sequential/combinational)
 *
 * @param deps - Injected store dependencies
 * @param sessionId - Session for provenance tracking
 * @param code - The generated code
 * @param metadata - Code type and optional module/description
 * @returns Created item or null if nothing interesting detected
 */
export function extractFromCodeGen(
    deps: ExtractionDependencies,
    sessionId: string,
    code: string,
    metadata: {
        moduleName?: string;
        type: 'testbench' | 'module' | 'function' | 'fsm' | 'package';
        description?: string;
    }
): KnowledgeItem | null {
    // Detect pattern type based on content
    const patternInfo = analyzeGeneratedCode(code, metadata.type);
    if (!patternInfo) return null;

    const item = deps.addKnowledge({
        type: 'code_pattern',
        title: `${metadata.type} pattern: ${patternInfo.name}`,
        content: patternInfo.summary + (metadata.description ? `\n\n${metadata.description}` : ''),
        tags: ['generated', metadata.type, ...patternInfo.tags],
        keywords: patternInfo.keywords,
        scope: {
            global: false,
            projectIds: [deps.projectId],
            modules: metadata.moduleName ? [metadata.moduleName] : undefined,
            defineContextId: deps.defineContextId,
            compileOrderId: deps.compileOrderId
        },
        source: {
            method: 'extracted',
            sessionId,
            tool: 'codegen'
        },
        confidence: 0.7
    });

    // Note: scheduleSave() is already called by addKnowledge() via markDirty()
    return item;
}

/**
 * Learn from a user correction (manual edit).
 *
 * When a user manually corrects generated or suggested code, this captures
 * their preference with high confidence (0.95). These corrections inform
 * future suggestions to match user style.
 *
 * @param deps - Injected store dependencies
 * @param original - Code before user correction
 * @param corrected - Code after user correction
 * @param metadata - Optional type override and scope hints
 * @returns Created knowledge item
 */
export function learnFromCorrection(
    deps: ExtractionDependencies,
    original: string,
    corrected: string,
    metadata: {
        type?: KnowledgeType;
        tags?: string[];
        filePath?: string;
        moduleName?: string;
    }
): KnowledgeItem {
    // Analyze the correction to determine type
    const correctionType = metadata.type ?? detectCorrectionType(original, corrected);
    const diffAnalysis = analyzeDiff(original, corrected);

    const item = deps.addKnowledge({
        type: correctionType,
        title: `User preference: ${diffAnalysis?.description ?? 'style correction'}`,
        content: `Before:\n\`\`\`\n${original.slice(0, 300)}\n\`\`\`\n\nAfter:\n\`\`\`\n${corrected.slice(0, 300)}\n\`\`\``,
        tags: ['user-correction', ...(metadata.tags ?? []), ...(diffAnalysis?.tags ?? [])],
        keywords: diffAnalysis?.keywords ?? [],
        scope: {
            global: false,
            projectIds: [deps.projectId],
            modules: metadata.moduleName ? [metadata.moduleName] : undefined,
            filePatterns: metadata.filePath ? [toGlobPattern(metadata.filePath)] : undefined,
            defineContextId: deps.defineContextId,
            compileOrderId: deps.compileOrderId
        },
        source: {
            method: 'user_provided',
            filePath: metadata.filePath
        },
        confidence: 0.95 // High confidence for user corrections
    });

    // Note: scheduleSave() is already called by addKnowledge() via markDirty()
    return item;
}

