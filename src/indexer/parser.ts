/**
 * SystemVerilog Parser
 * Regex-based parsing for module/package/interface extraction
 * 80% solution - handles common patterns without full parsing
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

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
    instantiates: string[];  // Modules instantiated by this module
}

export interface PackageInfo {
    name: string;
    file: string;
    line: number;
    exports: string[];  // Exported items
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
    imports: string[];       // Package imports
    includes: string[];      // Include file references
    instantiations: string[]; // All module instantiations
}

// ============================================================================
// Regex Patterns
// ============================================================================

const PATTERNS = {
    // Module definition: module name [#(params)] (ports);
    module: /^\s*module\s+(\w+)\s*(?:#\s*\([^)]*\))?\s*(?:\([^)]*\))?\s*;/gm,
    
    // Module with ports on multiple lines
    moduleMultiline: /^\s*module\s+(\w+)/gm,
    
    // Package definition
    package: /^\s*package\s+(\w+)\s*;/gm,
    
    // Interface definition
    interface: /^\s*interface\s+(\w+)/gm,
    
    // Program block (testbench)
    program: /^\s*program\s+(\w+)/gm,
    
    // Import statements: import pkg::*; or import pkg::item;
    import: /\bimport\s+(\w+)::/g,
    
    // Include directives: `include "file.svh"
    include: /`include\s+"([^"]+)"/g,
    
    // Module instantiation: module_name [#(params)] instance_name (ports);
    // This is tricky - we look for: identifier [#(...)] identifier (
    instantiation: /^\s*(\w+)\s+(?:#\s*\([^)]*\)\s*)?(\w+)\s*\(/gm,
    
    // Port declarations
    inputPort: /\binput\s+(?:logic|wire|reg)?\s*(?:\[([^\]]+)\])?\s*(\w+)/g,
    outputPort: /\boutput\s+(?:logic|wire|reg)?\s*(?:\[([^\]]+)\])?\s*(\w+)/g,
    inoutPort: /\binout\s+(?:logic|wire|reg)?\s*(?:\[([^\]]+)\])?\s*(\w+)/g,
    
    // Parameter declarations
    parameter: /\bparameter\s+(?:(\w+)\s+)?(\w+)\s*=\s*([^,;]+)/g,
    
    // Modport in interface
    modport: /\bmodport\s+(\w+)\s*\(/g,
    
    // Endmodule/endpackage/endinterface for scope tracking
    endmodule: /\bendmodule\b/g,
    endpackage: /\bendpackage\b/g,
    endinterface: /\bendinterface\b/g,
};

// Keywords that look like instantiations but aren't
const RESERVED_WORDS = new Set([
    'module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'logic',
    'always', 'always_ff', 'always_comb', 'always_latch', 'initial', 'final',
    'assign', 'if', 'else', 'case', 'casex', 'casez', 'for', 'while', 'do',
    'begin', 'end', 'fork', 'join', 'function', 'endfunction', 'task', 'endtask',
    'generate', 'endgenerate', 'genvar', 'parameter', 'localparam', 'defparam',
    'integer', 'real', 'time', 'realtime', 'event', 'supply0', 'supply1',
    'tri', 'triand', 'trior', 'tri0', 'tri1', 'wand', 'wor',
    'and', 'nand', 'or', 'nor', 'xor', 'xnor', 'not', 'buf',
    'package', 'endpackage', 'interface', 'endinterface', 'class', 'endclass',
    'program', 'endprogram', 'import', 'export', 'typedef', 'enum', 'struct',
    'union', 'virtual', 'static', 'automatic', 'const', 'signed', 'unsigned',
    'assert', 'assume', 'cover', 'property', 'sequence', 'clocking',
]);

// ============================================================================
// Parser Class
// ============================================================================

export class SVParser {
    /**
     * Parse a single file
     */
    async parseFile(filePath: string): Promise<FileParseResult> {
        const absolutePath = path.resolve(filePath);
        const content = await fs.readFile(absolutePath, 'utf-8');
        
        return this.parseContent(content, absolutePath);
    }

    /**
     * Parse content string
     */
    parseContent(content: string, filePath: string): FileParseResult {
        // Remove comments to avoid false matches
        const cleanContent = this.removeComments(content);
        
        const result: FileParseResult = {
            file: filePath,
            modules: [],
            packages: [],
            interfaces: [],
            imports: [],
            includes: [],
            instantiations: []
        };

        // Parse modules
        result.modules = this.parseModules(cleanContent, content, filePath);

        // Parse packages
        result.packages = this.parsePackages(cleanContent, content, filePath);

        // Parse interfaces
        result.interfaces = this.parseInterfaces(cleanContent, content, filePath);

        // Parse imports
        result.imports = this.parseImports(cleanContent);

        // Parse includes
        result.includes = this.parseIncludes(cleanContent);

        // Parse instantiations
        result.instantiations = this.parseInstantiations(cleanContent, result.modules.map(m => m.name));

        return result;
    }

    /**
     * Remove comments from content
     */
    private removeComments(content: string): string {
        // Remove single-line comments
        let result = content.replace(/\/\/.*$/gm, '');
        
        // Remove multi-line comments
        result = result.replace(/\/\*[\s\S]*?\*\//g, '');
        
        return result;
    }

    /**
     * Parse module definitions
     */
    private parseModules(
        cleanContent: string,
        originalContent: string,
        filePath: string
    ): ModuleInfo[] {
        const modules: ModuleInfo[] = [];
        
        // Reset regex
        PATTERNS.moduleMultiline.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.moduleMultiline.exec(cleanContent)) !== null) {
            const name = match[1];
            const line = this.getLineNumber(originalContent, match.index);
            
            // Find the module body (until endmodule)
            const moduleStart = match.index;
            const endMatch = cleanContent.slice(moduleStart).search(/\bendmodule\b/);
            const moduleBody = endMatch > 0 
                ? cleanContent.slice(moduleStart, moduleStart + endMatch)
                : cleanContent.slice(moduleStart);
            
            // Parse ports
            const ports = this.parsePorts(moduleBody);
            
            // Parse parameters
            const parameters = this.parseParameters(moduleBody);
            
            // Parse instantiations within this module
            const instantiates = this.parseInstantiations(moduleBody, [name]);
            
            modules.push({
                name,
                file: filePath,
                line,
                ports,
                parameters,
                instantiates
            });
        }

        return modules;
    }

    /**
     * Parse package definitions
     */
    private parsePackages(
        cleanContent: string,
        originalContent: string,
        filePath: string
    ): PackageInfo[] {
        const packages: PackageInfo[] = [];
        
        PATTERNS.package.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.package.exec(cleanContent)) !== null) {
            const name = match[1];
            const line = this.getLineNumber(originalContent, match.index);
            
            packages.push({
                name,
                file: filePath,
                line,
                exports: [] // Could parse exports if needed
            });
        }

        return packages;
    }

    /**
     * Parse interface definitions
     */
    private parseInterfaces(
        cleanContent: string,
        originalContent: string,
        filePath: string
    ): InterfaceInfo[] {
        const interfaces: InterfaceInfo[] = [];
        
        PATTERNS.interface.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.interface.exec(cleanContent)) !== null) {
            const name = match[1];
            const line = this.getLineNumber(originalContent, match.index);
            
            // Find modports
            const interfaceStart = match.index;
            const endMatch = cleanContent.slice(interfaceStart).search(/\bendinterface\b/);
            const interfaceBody = endMatch > 0
                ? cleanContent.slice(interfaceStart, interfaceStart + endMatch)
                : cleanContent.slice(interfaceStart);
            
            const modports = this.parseModports(interfaceBody);
            
            interfaces.push({
                name,
                file: filePath,
                line,
                modports
            });
        }

        return interfaces;
    }

    /**
     * Parse import statements
     */
    private parseImports(content: string): string[] {
        const imports: string[] = [];
        const seen = new Set<string>();
        
        PATTERNS.import.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.import.exec(content)) !== null) {
            const pkg = match[1];
            if (!seen.has(pkg)) {
                imports.push(pkg);
                seen.add(pkg);
            }
        }

        return imports;
    }

    /**
     * Parse include directives
     */
    private parseIncludes(content: string): string[] {
        const includes: string[] = [];
        
        PATTERNS.include.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.include.exec(content)) !== null) {
            includes.push(match[1]);
        }

        return includes;
    }

    /**
     * Parse module instantiations
     */
    private parseInstantiations(content: string, excludeModules: string[]): string[] {
        const instantiations: string[] = [];
        const seen = new Set<string>();
        const exclude = new Set([...RESERVED_WORDS, ...excludeModules]);
        
        PATTERNS.instantiation.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.instantiation.exec(content)) !== null) {
            const moduleName = match[1];
            
            // Skip reserved words and the module being defined
            if (exclude.has(moduleName)) continue;
            
            // Skip if it looks like a declaration (common patterns)
            if (moduleName.match(/^(logic|wire|reg|bit|byte|shortint|int|longint|integer)$/)) {
                continue;
            }
            
            if (!seen.has(moduleName)) {
                instantiations.push(moduleName);
                seen.add(moduleName);
            }
        }

        return instantiations;
    }

    /**
     * Parse port declarations
     */
    private parsePorts(moduleBody: string): PortInfo[] {
        const ports: PortInfo[] = [];
        
        // Input ports
        PATTERNS.inputPort.lastIndex = 0;
        let match;
        while ((match = PATTERNS.inputPort.exec(moduleBody)) !== null) {
            ports.push({
                name: match[2],
                direction: 'input',
                type: 'logic',
                width: match[1] || undefined,
                line: 0 // Would need original content for accurate line
            });
        }
        
        // Output ports
        PATTERNS.outputPort.lastIndex = 0;
        while ((match = PATTERNS.outputPort.exec(moduleBody)) !== null) {
            ports.push({
                name: match[2],
                direction: 'output',
                type: 'logic',
                width: match[1] || undefined,
                line: 0
            });
        }
        
        // Inout ports
        PATTERNS.inoutPort.lastIndex = 0;
        while ((match = PATTERNS.inoutPort.exec(moduleBody)) !== null) {
            ports.push({
                name: match[2],
                direction: 'inout',
                type: 'logic',
                width: match[1] || undefined,
                line: 0
            });
        }

        return ports;
    }

    /**
     * Parse parameter declarations
     */
    private parseParameters(moduleBody: string): ParameterInfo[] {
        const parameters: ParameterInfo[] = [];
        
        PATTERNS.parameter.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.parameter.exec(moduleBody)) !== null) {
            parameters.push({
                name: match[2],
                type: match[1] || undefined,
                defaultValue: match[3]?.trim(),
                line: 0
            });
        }

        return parameters;
    }

    /**
     * Parse modport declarations in interface
     */
    private parseModports(interfaceBody: string): string[] {
        const modports: string[] = [];
        
        PATTERNS.modport.lastIndex = 0;
        
        let match;
        while ((match = PATTERNS.modport.exec(interfaceBody)) !== null) {
            modports.push(match[1]);
        }

        return modports;
    }

    /**
     * Get line number from character index
     * Note: When called with originalContent but index from cleanContent,
     * we search for the match in original content to get accurate line numbers
     */
    private getLineNumber(content: string, index: number): number {
        // Clamp index to valid range to prevent inaccurate results
        const safeIndex = Math.min(index, content.length);
        return content.slice(0, safeIndex).split('\n').length;
    }

    /**
     * Find accurate line number for a name in original content
     */
    private findLineForName(originalContent: string, name: string, searchStart: number = 0): number {
        const searchContent = originalContent.slice(searchStart);
        const match = searchContent.match(new RegExp(`\\b${name}\\b`));
        if (match && match.index !== undefined) {
            return this.getLineNumber(originalContent, searchStart + match.index);
        }
        return 1; // Default to line 1 if not found
    }
}

// ============================================================================
// Export singleton
// ============================================================================

export const svParser = new SVParser();

