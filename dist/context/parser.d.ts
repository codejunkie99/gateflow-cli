/**
 * SystemVerilog Parser
 * Regex-based parsing for module/package/interface extraction
 * 80% solution - handles common patterns without full parsing
 */
export interface PortInfo {
    name: string;
    direction: 'input' | 'output' | 'inout';
    type: string;
    width?: string;
    line: number;
}
export interface ParameterInfo {
    name: string;
    type?: string;
    defaultValue?: string;
    line: number;
}
export interface ModuleInfo {
    name: string;
    file: string;
    line: number;
    ports: PortInfo[];
    parameters: ParameterInfo[];
    instantiates: string[];
}
export interface PackageInfo {
    name: string;
    file: string;
    line: number;
    exports: string[];
}
export interface InterfaceInfo {
    name: string;
    file: string;
    line: number;
    modports: string[];
}
export interface FileParseResult {
    file: string;
    modules: ModuleInfo[];
    packages: PackageInfo[];
    interfaces: InterfaceInfo[];
    imports: string[];
    includes: string[];
    instantiations: string[];
}
export declare class SVParser {
    /**
     * Parse a single file
     */
    parseFile(filePath: string): Promise<FileParseResult>;
    /**
     * Parse content string
     */
    parseContent(content: string, filePath: string): FileParseResult;
    /**
     * Remove comments from content
     */
    private removeComments;
    /**
     * Parse module definitions
     */
    private parseModules;
    /**
     * Parse package definitions
     */
    private parsePackages;
    /**
     * Parse interface definitions
     */
    private parseInterfaces;
    /**
     * Parse import statements
     */
    private parseImports;
    /**
     * Parse include directives
     */
    private parseIncludes;
    /**
     * Parse module instantiations
     */
    private parseInstantiations;
    /**
     * Parse port declarations
     */
    private parsePorts;
    /**
     * Parse parameter declarations
     */
    private parseParameters;
    /**
     * Parse modport declarations in interface
     */
    private parseModports;
    /**
     * Get line number from character index
     */
    private getLineNumber;
}
export declare const svParser: SVParser;
