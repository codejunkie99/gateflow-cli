/**
 * Skill Registry
 *
 * Runtime management of skills:
 * - Matching queries to skills
 * - Executing skill scripts
 * - Grep-based skill discovery
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type {
    SkillDefinition,
    SkillFileRef,
    SkillMatch,
    SkillExecutionContext,
    SkillExecutionResult,
    SkillEvent,
    SkillConfig
} from './types.js';
import { DEFAULT_SKILL_CONFIG } from './types.js';
import { SkillLoader, getSkillLoader } from './SkillLoader.js';

// ============================================================================
// Skill Registry
// ============================================================================

export class SkillRegistry {
    private loader: SkillLoader;
    private config: SkillConfig;
    private eventHandler?: (event: SkillEvent) => void;

    constructor(loader: SkillLoader, config?: Partial<SkillConfig>) {
        this.loader = loader;
        this.config = { ...DEFAULT_SKILL_CONFIG, ...config };
    }

    /**
     * Set event handler for skill events
     */
    onEvent(handler: (event: SkillEvent) => void): void {
        this.eventHandler = handler;
        this.loader.onEvent(handler);
    }

    private emit(event: SkillEvent): void {
        this.eventHandler?.(event);
    }

    /**
     * Initialize the registry (load all skills)
     */
    async initialize(): Promise<void> {
        await this.loader.loadAllSkills();
    }

    /**
     * Match a query to relevant skills
     */
    matchSkills(query: string, maxResults: number = 5): SkillMatch[] {
        const queryLower = query.toLowerCase();
        const matches: SkillMatch[] = [];

        for (const ref of this.loader.getAllSkills()) {
            if (!ref.skill.enabled) continue;

            let relevance = 0;
            let matchedTrigger: string | undefined;

            // Check triggers
            for (const trigger of ref.skill.triggers) {
                const triggerLower = trigger.toLowerCase();

                if (queryLower.includes(triggerLower)) {
                    // Query contains the trigger
                    const triggerRelevance = triggerLower.length / queryLower.length;
                    if (triggerRelevance > relevance) {
                        relevance = Math.min(0.9, triggerRelevance + 0.3);
                        matchedTrigger = trigger;
                    }
                } else if (triggerLower.includes(queryLower)) {
                    // Trigger contains the query (partial match)
                    const partial = queryLower.length / triggerLower.length * 0.5;
                    if (partial > relevance) {
                        relevance = partial;
                        matchedTrigger = trigger;
                    }
                }
            }

            // Check name and description for keyword matches
            const nameLower = ref.skill.name.toLowerCase();
            const descLower = ref.skill.description.toLowerCase();

            const words = queryLower.split(/\s+/);
            for (const word of words) {
                if (word.length < 3) continue;

                if (nameLower.includes(word)) {
                    relevance = Math.max(relevance, 0.6);
                }
                if (descLower.includes(word)) {
                    relevance = Math.max(relevance, 0.4);
                }
            }

            // Check tags
            for (const tag of ref.skill.tags ?? []) {
                if (queryLower.includes(tag.toLowerCase())) {
                    relevance = Math.max(relevance, 0.5);
                }
            }

            // Apply priority boost
            if (relevance > 0 && ref.skill.priority) {
                relevance = Math.min(1, relevance + ref.skill.priority * 0.01);
            }

            if (relevance > 0.1) {
                matches.push({
                    skill: ref.skill,
                    filePath: ref.filePath,
                    relevance,
                    matchedTrigger
                });

                this.emit({
                    type: 'skill_matched',
                    skill: ref.skill,
                    query,
                    relevance
                });
            }
        }

        // Sort by relevance descending
        matches.sort((a, b) => b.relevance - a.relevance);

        return matches.slice(0, maxResults);
    }

    /**
     * Get skill by name
     */
    getSkill(name: string): SkillDefinition | undefined {
        return this.loader.getSkill(name)?.skill;
    }

    /**
     * Get skill file reference by name
     */
    getSkillRef(name: string): SkillFileRef | undefined {
        return this.loader.getSkill(name);
    }

    /**
     * Get all skill names
     */
    getSkillNames(): string[] {
        return this.loader.getAllSkills().map(ref => ref.skill.name);
    }

    /**
     * Get skills directory path (for grep access)
     */
    getSkillsDir(): string {
        return this.loader.getSkillsDir();
    }

    /**
     * Format skill for agent output
     */
    formatSkillForAgent(skill: SkillDefinition): string {
        let result = `## Skill: ${skill.name}\n\n`;
        result += `**Description:** ${skill.description}\n\n`;

        if (skill.version) {
            result += `**Version:** ${skill.version}\n`;
        }

        result += `**Triggers:** ${skill.triggers.join(', ')}\n\n`;
        result += `**Instructions:**\n${skill.instructions}\n`;

        if (skill.examples && skill.examples.length > 0) {
            result += `\n**Examples:**\n`;
            for (const example of skill.examples) {
                result += `- "${example}"\n`;
            }
        }

        if (skill.executables && skill.executables.length > 0) {
            result += `\n**Bundled Scripts:** ${skill.executables.join(', ')}\n`;
        }

        if (skill.tags && skill.tags.length > 0) {
            result += `\n**Tags:** ${skill.tags.join(', ')}\n`;
        }

        return result;
    }

    /**
     * Execute a skill's bundled script
     */
    async executeScript(
        skillName: string,
        scriptPath: string,
        context: SkillExecutionContext
    ): Promise<SkillExecutionResult> {
        const ref = this.loader.getSkill(skillName);
        if (!ref) {
            return {
                success: false,
                exitCode: 1,
                stdout: '',
                stderr: `Skill not found: ${skillName}`,
                duration: 0
            };
        }

        // Resolve script path
        let fullScriptPath: string;
        try {
            fullScriptPath = this.loader.resolveExecutablePath(ref, scriptPath);
        } catch (error) {
            return {
                success: false,
                exitCode: 1,
                stdout: '',
                stderr: error instanceof Error ? error.message : 'Invalid script path',
                duration: 0
            };
        }

        // Check script exists
        try {
            await fs.access(fullScriptPath, fs.constants.X_OK);
        } catch {
            return {
                success: false,
                exitCode: 1,
                stdout: '',
                stderr: `Script not found or not executable: ${scriptPath}`,
                duration: 0
            };
        }

        this.emit({
            type: 'skill_script_start',
            skill: skillName,
            script: scriptPath
        });

        const startTime = Date.now();

        return new Promise((resolve) => {
            const timeout = context.timeout ?? this.config.defaultScriptTimeout;
            let cwd: string;
            try {
                const resolvedRoot = path.resolve(context.projectRoot);
                const resolvedCwd = path.resolve(context.cwd ?? context.projectRoot);
                if (resolvedCwd !== resolvedRoot && !resolvedCwd.startsWith(resolvedRoot + path.sep)) {
                    throw new Error(`Working directory escapes project root: "${context.cwd}"`);
                }
                cwd = resolvedCwd;
            } catch (error) {
                resolve({
                    success: false,
                    exitCode: 1,
                    stdout: '',
                    stderr: error instanceof Error ? error.message : 'Invalid working directory',
                    duration: Date.now() - startTime
                });
                return;
            }

            // Prepare environment
            const env = {
                ...process.env,
                GATEFLOW_SESSION_ID: context.sessionId,
                GATEFLOW_PROJECT_ROOT: context.projectRoot,
                GATEFLOW_QUERY: context.query,
                ...context.env
            };

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const proc = spawn(fullScriptPath, [], {
                cwd,
                env,
                shell: false
            });

            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
            }, timeout);

            proc.stdout?.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                // Truncate if too large
                if (stdout.length > this.config.maxScriptOutput) {
                    stdout = stdout.slice(0, this.config.maxScriptOutput) + '\n... (truncated)';
                }
            });

            proc.stderr?.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                if (stderr.length > this.config.maxScriptOutput) {
                    stderr = stderr.slice(0, this.config.maxScriptOutput) + '\n... (truncated)';
                }
            });

            proc.on('close', (code) => {
                clearTimeout(timer);
                const duration = Date.now() - startTime;

                if (timedOut) {
                    stderr += `\nScript timed out after ${timeout}ms`;
                }

                const result: SkillExecutionResult = {
                    success: code === 0 && !timedOut,
                    exitCode: code ?? 1,
                    stdout,
                    stderr,
                    duration
                };

                this.emit({
                    type: 'skill_script_end',
                    skill: skillName,
                    script: scriptPath,
                    success: result.success,
                    duration
                });

                resolve(result);
            });

            proc.on('error', (error) => {
                clearTimeout(timer);
                const duration = Date.now() - startTime;

                const result: SkillExecutionResult = {
                    success: false,
                    exitCode: 1,
                    stdout,
                    stderr: stderr + `\nExecution error: ${error.message}`,
                    duration
                };

                this.emit({
                    type: 'skill_script_end',
                    skill: skillName,
                    script: scriptPath,
                    success: false,
                    duration
                });

                resolve(result);
            });
        });
    }

    /**
     * List available scripts for a skill
     */
    listScripts(skillName: string): string[] {
        const ref = this.loader.getSkill(skillName);
        if (!ref) return [];
        return ref.skill.executables ?? [];
    }

    /**
     * Get minimal skill list (names only) for system prompt
     */
    getMinimalSkillList(): string {
        const skills = this.loader.getAllSkills()
            .filter(ref => ref.skill.enabled)
            .map(ref => ref.skill.name);

        if (skills.length === 0) {
            return 'No skills loaded.';
        }

        return `Available skills: ${skills.join(', ')}\n\nUse search_skills or grep .gateflow/skills/ to find relevant skills.`;
    }

    /**
     * Reload all skills
     */
    async reload(): Promise<void> {
        await this.loader.reloadAllSkills();
    }

    /**
     * Get skill count
     */
    get skillCount(): number {
        return this.loader.skillCount;
    }
}

// ============================================================================
// Singleton
// ============================================================================

let registryInstance: SkillRegistry | null = null;

/**
 * Get the global SkillRegistry instance
 */
function getSkillRegistry(projectRoot?: string, config?: Partial<SkillConfig>): SkillRegistry {
    if (!registryInstance && projectRoot) {
        const loader = getSkillLoader(projectRoot, config);
        registryInstance = new SkillRegistry(loader, config);
    }
    if (!registryInstance) {
        throw new Error('SkillRegistry not initialized. Call with projectRoot first.');
    }
    return registryInstance;
}

/**
 * Reset the singleton (for testing)
 */
function resetSkillRegistry(): void {
    registryInstance = null;
}
