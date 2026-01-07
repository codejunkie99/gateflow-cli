/**
 * Skills Type Definitions
 *
 * Implements Cursor's "Agent Skills open standard" pattern:
 * - Skills are defined by files (YAML/JSON)
 * - Include name, description, instructions, triggers
 * - Can bundle executables/scripts
 * - Agent discovers skills via grep/search
 */

// ============================================================================
// Skill Definition
// ============================================================================

/**
 * A skill definition as stored in a .skill.yaml or .skill.json file
 */
export interface SkillDefinition {
    /** Unique identifier for the skill */
    name: string;

    /** Brief description shown in skill listings */
    description: string;

    /** Version string (semver recommended) */
    version?: string;

    /** Keywords/phrases that trigger this skill */
    triggers: string[];

    /** Detailed instructions for the agent when using this skill */
    instructions: string;

    /** Paths to bundled executables/scripts (relative to skill file) */
    executables?: string[];

    /** Required tools that must be available */
    requiredTools?: string[];

    /** Example prompts that would invoke this skill */
    examples?: string[];

    /** Priority when multiple skills match (higher = more priority) */
    priority?: number;

    /** Whether this skill is enabled */
    enabled?: boolean;

    /** Author information */
    author?: string;

    /** Tags for categorization */
    tags?: string[];
}

// ============================================================================
// Skill File Reference
// ============================================================================

/**
 * Reference to a loaded skill file
 */
export interface SkillFileRef {
    /** Absolute path to the skill file */
    filePath: string;

    /** The loaded skill definition */
    skill: SkillDefinition;

    /** Directory containing the skill file (for resolving executables) */
    baseDir: string;

    /** Last modified timestamp */
    lastModified: number;

    /** File format (yaml or json) */
    format: 'yaml' | 'json';
}

// ============================================================================
// Skill Match
// ============================================================================

/**
 * Result of matching a query against skills
 */
export interface SkillMatch {
    /** The matched skill */
    skill: SkillDefinition;

    /** File path where skill is defined */
    filePath: string;

    /** Relevance score (0-1) */
    relevance: number;

    /** Which trigger matched */
    matchedTrigger?: string;
}

// ============================================================================
// Skill Execution Context
// ============================================================================

/**
 * Context provided when executing a skill script
 */
export interface SkillExecutionContext {
    /** Current session ID */
    sessionId: string;

    /** Project root directory */
    projectRoot: string;

    /** User's original query */
    query: string;

    /** Environment variables to pass to script */
    env?: Record<string, string>;

    /** Working directory for script execution */
    cwd?: string;

    /** Timeout in milliseconds */
    timeout?: number;
}

/**
 * Result of executing a skill script
 */
export interface SkillExecutionResult {
    /** Whether execution succeeded */
    success: boolean;

    /** Exit code from script */
    exitCode: number;

    /** Standard output */
    stdout: string;

    /** Standard error */
    stderr: string;

    /** Execution duration in ms */
    duration: number;
}

// ============================================================================
// Skill Registry Config
// ============================================================================

/**
 * Configuration for the skill system
 */
export interface SkillConfig {
    /** Whether skills are enabled */
    enabled: boolean;

    /** Directories to search for skill files */
    skillDirs: string[];

    /** File patterns to match skill files */
    patterns: string[];

    /** Whether to watch for skill file changes */
    watchForChanges: boolean;

    /** Default timeout for script execution (ms) */
    defaultScriptTimeout: number;

    /** Maximum script output size (bytes) */
    maxScriptOutput: number;
}

/**
 * Default skill configuration
 */
export const DEFAULT_SKILL_CONFIG: SkillConfig = {
    enabled: true,
    skillDirs: [
        '.gateflow/skills',
        '.skills'
    ],
    patterns: [
        '**/*.skill.yaml',
        '**/*.skill.yml',
        '**/*.skill.json'
    ],
    watchForChanges: false,
    defaultScriptTimeout: 30000,  // 30 seconds
    maxScriptOutput: 1024 * 1024  // 1MB
};

// ============================================================================
// Skill Events
// ============================================================================

/**
 * Events emitted by the skill system
 */
export type SkillEvent =
    | { type: 'skill_loaded'; skill: SkillDefinition; filePath: string }
    | { type: 'skill_error'; error: string; filePath?: string }
    | { type: 'skill_matched'; skill: SkillDefinition; query: string; relevance: number }
    | { type: 'skill_script_start'; skill: string; script: string }
    | { type: 'skill_script_end'; skill: string; script: string; success: boolean; duration: number };
