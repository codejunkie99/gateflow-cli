/**
 * Skill Loader
 *
 * Discovers and loads skill files from the filesystem.
 * Skills are stored as YAML or JSON files and can be searched via grep.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
    SkillDefinition,
    SkillFileRef,
    SkillConfig,
    SkillEvent
} from './types.js';
import { DEFAULT_SKILL_CONFIG } from './types.js';

// Simple YAML parser for skill files (subset of YAML)
// Supports: strings, arrays, multiline strings with |
function parseSimpleYaml(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = content.split('\n');
    let currentKey = '';
    let inMultiline = false;
    let multilineIndent = 0;
    let multilineValue = '';
    let inArray = false;
    let arrayValue: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (trimmed.startsWith('#') || trimmed === '') {
            if (inMultiline) {
                multilineValue += '\n';
            }
            continue;
        }

        // Check if we're continuing a multiline value
        if (inMultiline) {
            const lineIndent = line.search(/\S/);
            if (lineIndent > multilineIndent || trimmed === '') {
                multilineValue += (multilineValue ? '\n' : '') + trimmed;
                continue;
            } else {
                // End of multiline
                result[currentKey] = multilineValue.trim();
                inMultiline = false;
                multilineValue = '';
            }
        }

        // Check if we're continuing an array
        if (inArray) {
            if (trimmed.startsWith('- ')) {
                arrayValue.push(trimmed.slice(2).replace(/^["']|["']$/g, ''));
                continue;
            } else {
                // End of array
                result[currentKey] = arrayValue;
                inArray = false;
                arrayValue = [];
            }
        }

        // Parse key: value
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim();

            currentKey = key;

            if (value === '|') {
                // Start multiline
                inMultiline = true;
                multilineIndent = line.search(/\S/);
                multilineValue = '';
            } else if (value === '' || value === '[]') {
                // Could be start of array or empty value
                const nextLine = lines[i + 1]?.trim();
                if (nextLine?.startsWith('- ')) {
                    inArray = true;
                    arrayValue = [];
                } else {
                    result[key] = value === '[]' ? [] : '';
                }
            } else if (value.startsWith('[') && value.endsWith(']')) {
                // Inline array
                const items = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
                result[key] = items.filter(s => s !== '');
            } else {
                // Simple value
                result[key] = value.replace(/^["']|["']$/g, '');
            }
        } else if (trimmed.startsWith('- ') && inArray) {
            arrayValue.push(trimmed.slice(2).replace(/^["']|["']$/g, ''));
        }
    }

    // Finalize any pending multiline or array
    if (inMultiline) {
        result[currentKey] = multilineValue.trim();
    }
    if (inArray) {
        result[currentKey] = arrayValue;
    }

    return result;
}

// ============================================================================
// Skill Loader
// ============================================================================

export class SkillLoader {
    private config: SkillConfig;
    private projectRoot: string;
    private loadedSkills: Map<string, SkillFileRef> = new Map();
    private eventHandler?: (event: SkillEvent) => void;

    constructor(projectRoot: string, config?: Partial<SkillConfig>) {
        this.projectRoot = projectRoot;
        this.config = { ...DEFAULT_SKILL_CONFIG, ...config };
    }

    /**
     * Set event handler for skill events
     */
    onEvent(handler: (event: SkillEvent) => void): void {
        this.eventHandler = handler;
    }

    private emit(event: SkillEvent): void {
        this.eventHandler?.(event);
    }

    /**
     * Get the skills directory path
     */
    getSkillsDir(): string {
        return path.join(this.projectRoot, this.config.skillDirs[0]);
    }

    /**
     * Discover all skill files in configured directories
     */
    async discoverSkillFiles(): Promise<string[]> {
        const skillFiles: string[] = [];

        for (const skillDir of this.config.skillDirs) {
            const dirPath = path.join(this.projectRoot, skillDir);

            try {
                await fs.access(dirPath);
                const files = await this.walkDirectory(dirPath);

                for (const file of files) {
                    if (this.isSkillFile(file)) {
                        skillFiles.push(file);
                    }
                }
            } catch {
                // Directory doesn't exist, skip
            }
        }

        return skillFiles;
    }

    /**
     * Check if a file matches skill file patterns
     */
    private isSkillFile(filePath: string): boolean {
        const basename = path.basename(filePath);
        return (
            basename.endsWith('.skill.yaml') ||
            basename.endsWith('.skill.yml') ||
            basename.endsWith('.skill.json')
        );
    }

    /**
     * Recursively walk a directory
     */
    private async walkDirectory(dir: string): Promise<string[]> {
        const files: string[] = [];

        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    const subFiles = await this.walkDirectory(fullPath);
                    files.push(...subFiles);
                } else if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        } catch {
            // Permission denied or other error
        }

        return files;
    }

    /**
     * Load a skill from a file
     */
    async loadSkillFile(filePath: string): Promise<SkillFileRef | null> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const stats = await fs.stat(filePath);
            const format = filePath.endsWith('.json') ? 'json' : 'yaml';

            let skill: SkillDefinition;

            if (format === 'json') {
                skill = JSON.parse(content) as SkillDefinition;
            } else {
                skill = parseSimpleYaml(content) as unknown as SkillDefinition;
            }

            // Validate required fields
            if (!skill.name || !skill.description || !skill.triggers || !skill.instructions) {
                this.emit({
                    type: 'skill_error',
                    error: `Skill file missing required fields: ${filePath}`,
                    filePath
                });
                return null;
            }

            // Set defaults
            skill.enabled = skill.enabled ?? true;
            skill.priority = skill.priority ?? 0;
            skill.executables = skill.executables ?? [];
            skill.tags = skill.tags ?? [];

            const ref: SkillFileRef = {
                filePath,
                skill,
                baseDir: path.dirname(filePath),
                lastModified: stats.mtimeMs,
                format
            };

            this.loadedSkills.set(skill.name, ref);

            this.emit({
                type: 'skill_loaded',
                skill,
                filePath
            });

            return ref;
        } catch (error) {
            this.emit({
                type: 'skill_error',
                error: `Failed to load skill: ${error}`,
                filePath
            });
            return null;
        }
    }

    /**
     * Load all skills from configured directories
     */
    async loadAllSkills(): Promise<SkillFileRef[]> {
        const files = await this.discoverSkillFiles();
        const loaded: SkillFileRef[] = [];

        for (const file of files) {
            const ref = await this.loadSkillFile(file);
            if (ref) {
                loaded.push(ref);
            }
        }

        return loaded;
    }

    /**
     * Get a loaded skill by name
     */
    getSkill(name: string): SkillFileRef | undefined {
        return this.loadedSkills.get(name);
    }

    /**
     * Get all loaded skills
     */
    getAllSkills(): SkillFileRef[] {
        return Array.from(this.loadedSkills.values());
    }

    /**
     * Resolve an executable path relative to a skill file
     */
    resolveExecutablePath(skillRef: SkillFileRef, executablePath: string): string {
        const baseDir = path.resolve(skillRef.baseDir);
        const resolved = path.isAbsolute(executablePath)
            ? path.resolve(executablePath)
            : path.resolve(baseDir, executablePath);

        if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
            throw new Error(`Executable path escapes skill directory: "${executablePath}"`);
        }

        return resolved;
    }

    /**
     * Validate that a skill's executables exist
     */
    async validateExecutables(skillRef: SkillFileRef): Promise<{
        valid: boolean;
        missing: string[];
    }> {
        const missing: string[] = [];

        for (const exec of skillRef.skill.executables ?? []) {
            try {
                const fullPath = this.resolveExecutablePath(skillRef, exec);
                await fs.access(fullPath, fs.constants.X_OK);
            } catch {
                missing.push(exec);
            }
        }

        return {
            valid: missing.length === 0,
            missing
        };
    }

    /**
     * Ensure the skills directory exists
     */
    async ensureSkillsDir(): Promise<string> {
        const skillsDir = this.getSkillsDir();
        await fs.mkdir(skillsDir, { recursive: true });
        return skillsDir;
    }

    /**
     * Write an example skill file
     */
    async writeExampleSkill(): Promise<string> {
        const skillsDir = await this.ensureSkillsDir();
        const examplePath = path.join(skillsDir, 'example.skill.yaml');

        const exampleContent = `# Example Skill Definition
# Skills tell the agent how to perform domain-specific tasks

name: lint-fix
description: Fix Verilator lint errors systematically
version: "1.0.0"

triggers:
  - "fix lint"
  - "fix lint errors"
  - "verilator error"
  - "resolve warnings"

instructions: |
  When fixing lint errors:
  1. First run lint_file to get the current list of errors
  2. Process errors in dependency order (fix parent modules first)
  3. For each error:
     - Read the relevant code section
     - Understand the error message
     - Apply the minimal fix needed
  4. After fixing, re-run lint to verify the fix worked
  5. Continue until all errors are resolved

  Common fixes:
  - UNUSED: Remove or comment out unused signals
  - WIDTH: Fix bit width mismatches
  - UNDRIVEN: Connect undriven signals or add default values
  - MULTIDRIVEN: Ensure signals are driven from one source

examples:
  - "Fix the lint errors in counter.sv"
  - "There are width mismatch warnings, please resolve them"

tags:
  - verification
  - lint
  - verilator

priority: 10
enabled: true
`;

        await fs.writeFile(examplePath, exampleContent, 'utf-8');
        return examplePath;
    }

    /**
     * Reload a specific skill file
     */
    async reloadSkill(name: string): Promise<SkillFileRef | null> {
        const existing = this.loadedSkills.get(name);
        if (existing) {
            return this.loadSkillFile(existing.filePath);
        }
        return null;
    }

    /**
     * Reload all skills
     */
    async reloadAllSkills(): Promise<SkillFileRef[]> {
        this.loadedSkills.clear();
        return this.loadAllSkills();
    }

    /**
     * Get the count of loaded skills
     */
    get skillCount(): number {
        return this.loadedSkills.size;
    }
}

// ============================================================================
// Singleton
// ============================================================================

let loaderInstance: SkillLoader | null = null;

/**
 * Get the global SkillLoader instance
 */
export function getSkillLoader(projectRoot?: string, config?: Partial<SkillConfig>): SkillLoader {
    if (!loaderInstance && projectRoot) {
        loaderInstance = new SkillLoader(projectRoot, config);
    }
    if (!loaderInstance) {
        throw new Error('SkillLoader not initialized. Call with projectRoot first.');
    }
    return loaderInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSkillLoader(): void {
    loaderInstance = null;
}
