/**
 * Knowledge Base Types
 * Type definitions for persistent agent memory (Phase 3)
 */

// ============================================================================
// Pattern Types
// ============================================================================

/**
 * Categories of learned patterns
 */
export type PatternType =
    | 'coding_style'      // "Use always_ff with non-blocking"
    | 'naming_convention' // "Signals use snake_case, modules use PascalCase"
    | 'architecture'      // "Separate FSM state/output logic"
    | 'testing'           // "Always include reset test"
    | 'workflow';         // "Lint before sim"

/**
 * How a preference/pattern was discovered
 */
export type PreferenceSource = 'explicit' | 'inferred';

/**
 * Evidence supporting a learned pattern
 */
export interface PatternEvidence {
    sessionId: string;
    timestamp: number;
    context: string;           // What triggered this observation
    source: PreferenceSource;
    toolCall?: string;         // Tool that provided evidence
}

/**
 * A learned pattern from user interactions
 */
export interface LearnedPattern {
    id: string;
    type: PatternType;
    pattern: string;           // Human-readable description
    evidence: PatternEvidence[];
    confidence: number;        // 0.0-1.0, based on evidence count + recency
    firstSeen: number;         // Timestamp
    lastSeen: number;          // Timestamp
    occurrences: number;       // How many times observed
    negativeEvidence: number;  // Times pattern was violated (reduces confidence)
}

// ============================================================================
// User Preference Types
// ============================================================================

/**
 * A user preference (explicit or inferred)
 */
export interface UserPreference {
    key: string;               // e.g., "coding.reset_style", "workflow.auto_lint"
    value: unknown;
    source: PreferenceSource;
    confidence: number;
    evidence: string[];        // Concrete examples from conversations
    lastUpdated: number;
}

// ============================================================================
// Module Knowledge Types
// ============================================================================

/**
 * Port information for a module
 */
export interface ModulePort {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width?: string;
}

/**
 * Parameter information for a module
 */
export interface ModuleParameter {
    name: string;
    default?: string;
}

/**
 * Type classification for modules
 */
export type ModuleType = 'top' | 'sub' | 'tb' | 'package' | 'interface' | 'unknown';

/**
 * Knowledge about a specific module
 */
export interface ModuleKnowledge {
    name: string;
    purpose?: string;          // LLM-generated summary
    type: ModuleType;
    ports?: ModulePort[];
    parameters?: ModuleParameter[];
    dependencies: string[];     // Other modules it instantiates
    dependents: string[];       // Modules that instantiate this
    usagePatterns: string[];    // "Commonly used with clk_gen"
    commonIssues: string[];     // "Width mismatch on data port"
    lastAnalyzed: number;
    analysisHash: string;       // Hash of file content when analyzed
    filePath: string;
}

// ============================================================================
// Fix Pattern Types
// ============================================================================

/**
 * Category of error that was fixed
 */
export type ErrorCategory = 'lint' | 'sim' | 'compile' | 'runtime';

/**
 * Example of a fix (before/after code)
 */
export interface FixExample {
    before: string;
    after: string;
    file?: string;
}

/**
 * A recorded fix pattern (error -> fix mapping)
 */
export interface FixPattern {
    id: string;
    errorSignature: string;    // Normalized pattern to match error
    errorCategory: ErrorCategory;
    fixDescription: string;
    fixExample?: FixExample;
    successCount: number;      // Times this fix worked
    failureCount: number;      // Times it didn't
    lastUsed: number;
    confidence: number;        // successCount / (successCount + failureCount)
}

// ============================================================================
// Project Knowledge Types
// ============================================================================

/**
 * Project architecture insights
 */
export interface ArchitectureInsights {
    topModules: string[];           // Identified top-levels
    commonPatterns: string[];       // "Uses AXI4-Lite", "Synchronous reset"
    namingConventions: string[];    // "Signals: snake_case", "Modules: CamelCase"
}

/**
 * Statistics about knowledge usage
 */
export interface KnowledgeStats {
    totalSessions: number;
    totalToolCalls: number;
    totalFixes: number;
    lastUpdated: number;
}

/**
 * Complete project knowledge structure (stored in {projectId}-knowledge.json)
 */
export interface ProjectKnowledge {
    version: number;
    projectId: string;

    // Learned patterns
    patterns: LearnedPattern[];

    // User preferences (serialized from Map)
    preferences: Record<string, UserPreference>;

    // Module knowledge graph (serialized from Map)
    modules: Record<string, ModuleKnowledge>;

    // Fix patterns (error -> fix mapping)
    fixPatterns: FixPattern[];

    // Project-level insights
    architecture: ArchitectureInsights;

    // Statistics
    stats: KnowledgeStats;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Context for querying relevant knowledge
 */
export interface QueryContext {
    currentFile?: string;
    currentModule?: string;
    recentErrors?: string[];
    userQuery?: string;
    recentToolCalls?: string[];  // Last N tool names
}

/**
 * Result of querying relevant knowledge
 */
export interface RelevantKnowledge {
    patterns: LearnedPattern[];        // Applicable patterns
    preferences: UserPreference[];     // Relevant preferences
    moduleKnowledge?: ModuleKnowledge; // Current module context
    relevantFixes?: FixPattern[];      // Matching error patterns
    relatedModules?: ModuleKnowledge[]; // Dependencies/dependents
    tokenEstimate: number;             // Estimated tokens for this knowledge
}

// ============================================================================
// Pattern Extraction Types
// ============================================================================

/**
 * Record of a tool call during a session
 */
export interface ToolCallRecord {
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
    success: boolean;
    timestamp: number;
    duration?: number;
}

/**
 * A detected correction from user
 */
export interface Correction {
    timestamp: number;
    type: 'explicit' | 'implicit';
    original: string;          // What assistant produced
    corrected: string;         // What user changed it to
    file?: string;
    reason?: string;           // If user explained
}

/**
 * A detected tool usage pattern (repeated sequence)
 */
export interface ToolUsagePattern {
    id: string;
    sequence: string[];        // e.g., ['read_file', 'lint_file', 'edit_lines']
    frequency: number;
    contexts: string[];        // When this sequence is used
    avgDuration?: number;
    successRate: number;
}

/**
 * Type of explicit statement detected
 */
export type StatementType = 'preference' | 'style' | 'workflow' | 'constraint';

/**
 * An explicit statement extracted from user message
 */
export interface ExplicitStatement {
    type: StatementType;
    statement: string;         // The raw statement
    key: string;               // Extracted key (e.g., "reset_style")
    value: unknown;            // Extracted value
    confidence: number;
    message: string;           // Original message for context
}

/**
 * Result of pattern extraction from a session
 */
export interface ExtractionResult {
    patterns: Array<{
        type: PatternType;
        pattern: string;
        evidence: Omit<PatternEvidence, 'timestamp'>;
        confidence: number;
    }>;
    preferences: Array<{
        key: string;
        value: unknown;
        source: PreferenceSource;
        evidence: string;
        confidence: number;
    }>;
    toolPatterns: ToolUsagePattern[];
    fixPatterns: Array<{
        errorSignature: string;
        errorCategory: ErrorCategory;
        fixDescription: string;
        example?: FixExample;
    }>;
    moduleInsights: Array<{
        moduleName: string;
        insight: string;
        type: 'issue' | 'usage' | 'dependency';
    }>;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for KnowledgeBase
 */
export interface KnowledgeBaseConfig {
    /** Confidence decay rate per day (default: 0.05 = 5%) */
    decayRate: number;
    /** Minimum days before decay starts (default: 7) */
    minDecayAgeDays: number;
    /** Minimum confidence to keep pattern (default: 0.1) */
    pruneThreshold: number;
    /** Maximum patterns to store (default: 100) */
    maxPatterns: number;
    /** Maximum fix patterns to store (default: 50) */
    maxFixPatterns: number;
    /** Auto-save interval in ms (0 to disable) */
    autoSaveInterval: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_KNOWLEDGE_CONFIG: KnowledgeBaseConfig = {
    decayRate: 0.05,
    minDecayAgeDays: 7,
    pruneThreshold: 0.1,
    maxPatterns: 100,
    maxFixPatterns: 50,
    autoSaveInterval: 60000, // 1 minute
};
