/**
 * Configuration Manager
 * Loads and manages .gaterc.json configuration files
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GateFlowConfig {
    LLM?: {
        defaultModel?: string;
        maxTokens?: number;
        temperature?: number;
    };
    Tool?: {
        verilatorPath?: string;
        useWsl?: boolean;
        wslDistro?: string;
    };
    Project?: {
        defaultIncludePaths?: string[];
        excludePatterns?: string[];
    };
    UX?: {
        colors?: boolean;
        compactMode?: boolean;
        maxHistory?: number;
        showThinking?: boolean;
    };
}

const DEFAULT_CONFIG: GateFlowConfig = {
    LLM: {
        defaultModel: 'claude-sonnet-4-20250514',
        maxTokens: 8192,
        temperature: 0.7
    },
    Tool: {
        useWsl: false
    },
    Project: {
        defaultIncludePaths: [],
        excludePatterns: ['node_modules/**', 'dist/**', 'obj_dir/**', '.git/**']
    },
    UX: {
        colors: true,
        compactMode: false,
        maxHistory: 1000,
        showThinking: true
    }
};

export class ConfigManager {
    private config: GateFlowConfig = DEFAULT_CONFIG;
    private configPath: string | null = null;

    /**
     * Load configuration from multiple locations
     */
    async load(projectRoot: string = process.cwd()): Promise<GateFlowConfig> {
        const configPaths = [
            path.join(projectRoot, '.gaterc.json'),
            path.join(process.env.HOME || process.env.USERPROFILE || '', '.gateflow', 'config.json'),
            path.join(__dirname, '../../.gaterc.json') // Global fallback
        ];

        for (const configPath of configPaths) {
            try {
                const content = await fs.readFile(configPath, 'utf-8');
                const loaded = JSON.parse(content);
                this.config = this.mergeConfig(DEFAULT_CONFIG, loaded);
                this.configPath = configPath;
                return this.config;
            } catch (error) {
                // File doesn't exist or invalid JSON - continue to next location
                continue;
            }
        }

        // No config found, use defaults
        return this.config;
    }

    /**
     * Save configuration to project root
     */
    async save(config: GateFlowConfig, projectRoot: string = process.cwd()): Promise<void> {
        const configPath = path.join(projectRoot, '.gaterc.json');
        const content = JSON.stringify(config, null, 2);
        await fs.writeFile(configPath, content, 'utf-8');
        this.config = config;
        this.configPath = configPath;
    }

    /**
     * Get configuration value with default
     */
    get<T = any>(key: string, defaultValue?: T): T {
        const keys = key.split('.');
        let value: any = this.config;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue as T;
            }
        }

        return (value !== undefined ? value : defaultValue) as T;
    }

    /**
     * Set configuration value
     */
    set(key: string, value: any): void {
        const keys = key.split('.');
        let target: any = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!target[k] || typeof target[k] !== 'object') {
                target[k] = {};
            }
            target = target[k];
        }

        target[keys[keys.length - 1]] = value;
    }

    /**
     * Validate configuration
     */
    validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (this.config.LLM) {
            if (this.config.LLM.maxTokens && (this.config.LLM.maxTokens < 1 || this.config.LLM.maxTokens > 100000)) {
                errors.push('LLM.maxTokens must be between 1 and 100000');
            }
            if (this.config.LLM.temperature && (this.config.LLM.temperature < 0 || this.config.LLM.temperature > 2)) {
                errors.push('LLM.temperature must be between 0 and 2');
            }
        }

        if (this.config.UX) {
            if (this.config.UX.maxHistory && this.config.UX.maxHistory < 0) {
                errors.push('UX.maxHistory must be non-negative');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get full configuration
     */
    getAll(): GateFlowConfig {
        return { ...this.config };
    }

    /**
     * Merge two config objects (deep merge)
     */
    private mergeConfig(defaults: GateFlowConfig, overrides: Partial<GateFlowConfig>): GateFlowConfig {
        const merged: GateFlowConfig = { ...defaults };
        const overrideKeys = Object.keys(overrides) as (keyof GateFlowConfig)[];

        for (const key of overrideKeys) {
            const overrideValue = overrides[key];
            const defaultValue = defaults[key];
            
            if (overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)) {
                // Recursive merge for nested objects
                const nestedDefault = (defaultValue as Partial<GateFlowConfig>) || {};
                const nestedOverride = overrideValue as Partial<GateFlowConfig>;
                (merged[key] as any) = this.mergeConfig(
                    nestedDefault as GateFlowConfig,
                    nestedOverride
                );
            } else if (overrideValue !== undefined) {
                // Direct assignment for primitives
                (merged[key] as any) = overrideValue;
            }
        }

        return merged;
    }
}

/**
 * Global config manager instance
 */
let globalConfigManager: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
    if (!globalConfigManager) {
        globalConfigManager = new ConfigManager();
    }
    return globalConfigManager;
}

