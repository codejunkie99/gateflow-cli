/**
 * Main orchestrator for extracting knowledge from indexer output
 * @module memory/extractors/indexer-extractor
 *
 * NOTE: Structural extraction (modules, dependencies, hierarchy) has been removed.
 * The KnowledgeStore now focuses on learned patterns only (code_pattern, lint_fix, etc.).
 * This file is kept for API compatibility but performs minimal work.
 */

import * as crypto from "crypto";
import type { ResolvedProject } from "../../indexer/types/index.js";
import type { KnowledgeStore } from "../ParentKnowledgeStore.js";
import type {
  ExtractedCount,
  ExtractionOptions,
  ExtractionResult,
} from "./types.js";

/**
 * Extract knowledge from a resolved project
 *
 * NOTE: Structural extraction has been removed. This function now returns
 * empty counts for backwards compatibility. The KnowledgeStore focuses
 * on learned patterns (code_pattern, lint_fix, style_preference, etc.)
 * rather than structural information from the indexer.
 *
 * @param project - Resolved project from indexer (unused)
 * @param store - KnowledgeStore instance (unused)
 * @param options - Extraction configuration
 * @returns Result with empty counts and success status
 */
export async function extractFromIndex(
  _project: ResolvedProject,
  _store: KnowledgeStore,
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  const startTime = Date.now();

  const counts: ExtractedCount = {};

  try {
    // Validate options for API compatibility
    validateOptions(options);

    // Structural extraction has been removed.
    // Return success with empty counts.

    return {
      success: true,
      counts,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      counts,
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Extract only module information (lighter weight)
 *
 * @deprecated Structural extraction has been removed. This function
 * now just calls extractFromIndex for backwards compatibility.
 */
async function extractModulesOnly(
  project: ResolvedProject,
  store: KnowledgeStore,
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  return extractFromIndex(project, store, options);
}

/**
 * Validate extraction options
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateOptions(options: ExtractionOptions): void {
  if (!options.projectId) {
    throw new Error("ExtractionOptions.projectId is required");
  }
  if (!options.sessionId) {
    throw new Error("ExtractionOptions.sessionId is required");
  }

  // Validate projectId format (12-char hex)
  if (!/^[a-f0-9]{12}$/i.test(options.projectId)) {
    throw new Error(
      `Invalid projectId format: ${options.projectId}. ` +
        `Expected 12-character hex string.`,
    );
  }

  // Validate sessionId format (UUID)
  if (!UUID_REGEX.test(options.sessionId)) {
    throw new Error(
      `Invalid sessionId format: ${options.sessionId}. ` +
        `Expected UUID format.`,
    );
  }
}

/**
 * Create default extraction options with required fields
 */
export function createExtractionOptions(
  projectId: string,
  overrides?: Partial<Omit<ExtractionOptions, "projectId" | "sessionId">>,
): ExtractionOptions {
  return {
    projectId,
    sessionId: crypto.randomUUID(),
    extractModules: true,
    extractDependencies: true,
    extractHierarchy: true,
    minConfidence: 0.9,
    maxItemsPerCategory: 500,
    ...overrides,
  };
}

/**
 * Get extraction summary as human-readable string
 *
 * NOTE: Since structural extraction has been removed, this now returns
 * a simple success message with no counts.
 */
export function formatExtractionSummary(result: ExtractionResult): string {
  if (!result.success) {
    return `Extraction failed: ${result.error}`;
  }

  return `Extraction completed in ${result.durationMs}ms (structural extraction disabled)`;
}

// Re-export types for convenience
;
