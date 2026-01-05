/**
 * Configuration Manager
 * Loads and manages .gaterc.json configuration files
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = {
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
    config = DEFAULT_CONFIG;
    configPath = null;
    /**
     * Load configuration from multiple locations
     */
    async load(projectRoot = process.cwd()) {
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
            }
            catch (error) {
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
    async save(config, projectRoot = process.cwd()) {
        const configPath = path.join(projectRoot, '.gaterc.json');
        const content = JSON.stringify(config, null, 2);
        await fs.writeFile(configPath, content, 'utf-8');
        this.config = config;
        this.configPath = configPath;
    }
    /**
     * Get configuration value with default
     */
    get(key, defaultValue) {
        const keys = key.split('.');
        let value = this.config;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            }
            else {
                return defaultValue;
            }
        }
        return (value !== undefined ? value : defaultValue);
    }
    /**
     * Set configuration value
     */
    set(key, value) {
        const keys = key.split('.');
        let target = this.config;
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
    validate() {
        const errors = [];
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
    getAll() {
        return { ...this.config };
    }
    /**
     * Merge two config objects (deep merge)
     */
    mergeConfig(defaults, overrides) {
        const merged = { ...defaults };
        const overrideKeys = Object.keys(overrides);
        for (const key of overrideKeys) {
            const overrideValue = overrides[key];
            const defaultValue = defaults[key];
            if (overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)) {
                // Recursive merge for nested objects
                const nestedDefault = defaultValue || {};
                const nestedOverride = overrideValue;
                merged[key] = this.mergeConfig(nestedDefault, nestedOverride);
            }
            else if (overrideValue !== undefined) {
                // Direct assignment for primitives
                merged[key] = overrideValue;
            }
        }
        return merged;
    }
}
/**
 * Global config manager instance
 */
let globalConfigManager = null;
export function getConfigManager() {
    if (!globalConfigManager) {
        globalConfigManager = new ConfigManager();
    }
    return globalConfigManager;
}
