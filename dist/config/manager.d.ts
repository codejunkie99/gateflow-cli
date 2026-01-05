/**
 * Configuration Manager
 * Loads and manages .gaterc.json configuration files
 */
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
export declare class ConfigManager {
    private config;
    private configPath;
    /**
     * Load configuration from multiple locations
     */
    load(projectRoot?: string): Promise<GateFlowConfig>;
    /**
     * Save configuration to project root
     */
    save(config: GateFlowConfig, projectRoot?: string): Promise<void>;
    /**
     * Get configuration value with default
     */
    get<T = any>(key: string, defaultValue?: T): T;
    /**
     * Set configuration value
     */
    set(key: string, value: any): void;
    /**
     * Validate configuration
     */
    validate(): {
        valid: boolean;
        errors: string[];
    };
    /**
     * Get full configuration
     */
    getAll(): GateFlowConfig;
    /**
     * Merge two config objects (deep merge)
     */
    private mergeConfig;
}
export declare function getConfigManager(): ConfigManager;
