/**
 * Filelist Parser Module
 *
 * Parses .f (filelist) files used in SystemVerilog projects.
 *
 * Filelists define:
 * - Files to compile (in order)
 * - Include paths (+incdir+path)
 * - Defines (+define+NAME=VALUE)
 * - Nested filelists (-f file.f)
 *
 * @example Filelist syntax:
 * ```
 * # This is a comment
 * // This is also a comment
 *
 * +incdir+./include
 * +incdir+../common/include
 *
 * +define+DEBUG
 * +define+WIDTH=32
 *
 * ./rtl/pkg/types_pkg.sv
 * ./rtl/pkg/utils_pkg.sv
 * ./rtl/modules/counter.sv
 * ./rtl/top.sv
 *
 * -f ./other_files.f
 * ```
 *
 * @module recipe/filelist-parser
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * A parsed filelist (recipe) for compiling SystemVerilog.
 */
export interface Recipe {
  /**
   * Unique ID for this recipe (hash of content).
   */
  id: string;

  /**
   * Path to the source .f file.
   */
  sourceFile: string;

  /**
   * Include paths in order of priority.
   * These are used to resolve `include directives.
   */
  includePaths: string[];

  /**
   * Defines (macro definitions).
   * Maps macro name to value (empty string if no value).
   */
  defines: Record<string, string>;

  /**
   * Files to compile in order.
   * These are absolute paths.
   */
  files: string[];

  /**
   * Nested filelists that were included.
   * These are absolute paths.
   */
  nestedFilelists: string[];
}

/**
 * Options for parsing a filelist.
 */
export interface ParseFilelistOptions {
  /**
   * Whether to recursively parse nested filelists.
   * Default: true
   */
  recursive?: boolean;

  /**
   * Base path for resolving relative paths.
   * Default: directory containing the filelist
   */
  basePath?: string;

  /**
   * Additional include paths to add.
   */
  extraIncludePaths?: string[];

  /**
   * Additional defines to add.
   */
  extraDefines?: Record<string, string>;

  /**
   * Set of already-visited filelist paths (used internally for cycle detection).
   * @internal
   */
  _visitedFilelists?: Set<string>;
}

// ============================================================================
// Parser Class
// ============================================================================

/**
 * Parses .f filelist files.
 *
 * @example
 * ```typescript
 * const parser = new FilelistParser();
 *
 * // Parse a filelist
 * const recipe = await parser.parse('/path/to/project.f');
 *
 * console.log(`Include paths: ${recipe.includePaths.join(', ')}`);
 * console.log(`Files to compile: ${recipe.files.length}`);
 *
 * // Use with FileUnderstander
 * for (const file of recipe.files) {
 *   const result = await understander.understand(file);
 *   // ...
 * }
 * ```
 */
export class FilelistParser {
  /**
   * Parse a filelist file.
   *
   * @param filelistPath - Path to the .f file
   * @param options - Parse options
   * @returns Parsed recipe
   */
  async parse(
    filelistPath: string,
    options: ParseFilelistOptions = {}
  ): Promise<Recipe> {
    const absolutePath = path.resolve(filelistPath);

    // Initialize or reuse visited set for cycle detection
    const visited = options._visitedFilelists || new Set<string>();

    // Check for circular reference
    if (visited.has(absolutePath)) {
      // Return empty recipe to break the cycle
      return {
        id: 'cycle-' + absolutePath.slice(-16),
        sourceFile: absolutePath,
        includePaths: [],
        defines: {},
        files: [],
        nestedFilelists: [],
      };
    }

    // Mark as visited before parsing
    visited.add(absolutePath);

    const content = await fs.readFile(absolutePath, 'utf-8');
    const basePath = options.basePath || path.dirname(absolutePath);

    // Pass the visited set to nested parses
    return this.parseContent(content, basePath, absolutePath, {
      ...options,
      _visitedFilelists: visited,
    });
  }

  /**
   * Parse filelist content directly.
   *
   * @param content - Filelist content as string
   * @param basePath - Base path for resolving relative paths
   * @param sourceFile - Source file path (for ID generation)
   * @param options - Parse options
   * @returns Parsed recipe
   */
  async parseContent(
    content: string,
    basePath: string,
    sourceFile: string,
    options: ParseFilelistOptions = {}
  ): Promise<Recipe> {
    const recipe: Recipe = {
      id: '',
      sourceFile,
      includePaths: options.extraIncludePaths ? [...options.extraIncludePaths] : [],
      defines: options.extraDefines ? { ...options.extraDefines } : {},
      files: [],
      nestedFilelists: [],
    };

    // Generate ID from content
    recipe.id = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

    const lines = content.split(/\r?\n/);
    const fileSet = new Set<string>();

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const rawLine = lines[lineNum];
      // Trim + strip inline comments (common in .f files)
      // Examples:
      //   ./rtl/top.sv // comment
      //   +incdir+./inc # comment
      let line = rawLine.trim();
      line = line.replace(/\s+(?:\/\/|#).*/, '').trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#') || line.startsWith('//')) {
        continue;
      }

      // Parse the line
      await this.parseLine(line, basePath, recipe, options, fileSet);
    }

    return recipe;
  }

  /**
   * Parse a single line from the filelist.
   */
  private async parseLine(
    line: string,
    basePath: string,
    recipe: Recipe,
    options: ParseFilelistOptions,
    fileSet: Set<string>
  ): Promise<void> {
    const addFile = (filePath: string): void => {
      if (fileSet.has(filePath)) return;
      fileSet.add(filePath);
      recipe.files.push(filePath);
    };

    // +incdir+path - Include directory
    const incdirMatch = line.match(/^\+incdir\+(.+)$/);
    if (incdirMatch) {
      // Some tools support: +incdir+dir1+dir2+dir3
      const raw = incdirMatch[1].trim();
      const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);

      for (const part of parts) {
        const incPath = this.resolvePath(part, basePath);
        if (!recipe.includePaths.includes(incPath)) {
          recipe.includePaths.push(incPath);
        }
      }
      return;
    }

    // +define+NAME or +define+NAME=VALUE
    const defineMatch = line.match(/^\+define\+(\w+)(?:=(.*))?$/);
    if (defineMatch) {
      recipe.defines[defineMatch[1]] = defineMatch[2] || '';
      return;
    }

    // -f file or -F file - Nested filelist
    const nestedMatch = line.match(/^-[fF]\s+(.+)$/);
    if (nestedMatch) {
      const nestedPath = this.resolvePath(nestedMatch[1].trim(), basePath);
      if (!recipe.nestedFilelists.includes(nestedPath)) {
        recipe.nestedFilelists.push(nestedPath);
      }

      // Recursively parse nested filelist
      if (options.recursive !== false) {
        try {
          const nestedRecipe = await this.parse(nestedPath, {
            ...options,
            basePath: path.dirname(nestedPath),
          });

          // Merge nested recipe into this one
          this.mergeRecipe(recipe, nestedRecipe, fileSet);
        } catch (error) {
          // Log warning but continue
          console.warn(
            `Warning: Failed to parse nested filelist ${nestedPath}: ${error}`
          );
        }
      }
      return;
    }

    // -y directory - Library directory (add to include paths)
    const libdirMatch = line.match(/^-y\s+(.+)$/);
    if (libdirMatch) {
      const libPath = this.resolvePath(libdirMatch[1].trim(), basePath);
      if (!recipe.includePaths.includes(libPath)) {
        recipe.includePaths.push(libPath);
      }
      return;
    }

    // -v file - Library file (add to files)
    const libfileMatch = line.match(/^-v\s+(.+)$/);
    if (libfileMatch) {
      const filePath = this.resolvePath(libfileMatch[1].trim(), basePath);
      addFile(filePath);
      return;
    }

    // Skip other flags we don't handle
    if (line.startsWith('+') || line.startsWith('-')) {
      // Unknown flag - skip it
      return;
    }

    // Assume anything else is a file path
    if (this.looksLikeSvFile(line)) {
      const filePath = this.resolvePath(line, basePath);
      addFile(filePath);
    }
  }

  /**
   * Resolve a path relative to base path.
   */
  private resolvePath(inputPath: string, basePath: string): string {
    // Strip surrounding quotes (handles +incdir+"/path/to/dir" syntax)
    const unquotedPath = inputPath.replace(/^["']|["']$/g, '');

    // Handle environment variables
    const expandedPath = this.expandEnvVars(unquotedPath);

    // Resolve relative to base path
    if (path.isAbsolute(expandedPath)) {
      return path.normalize(expandedPath);
    }

    return path.resolve(basePath, expandedPath);
  }

  /**
   * Expand environment variables in a path.
   */
  private expandEnvVars(inputPath: string): string {
    let out = inputPath;

    // Windows: %VAR%
    out = out.replace(/%(\w+)%/g, (match, varName) => {
      return process.env[varName] || match;
    });

    // Makefile/tooling: $(VAR)
    out = out.replace(/\$\((\w+)\)/g, (match, varName) => {
      return process.env[varName] || match;
    });

    // Unix: $VAR and ${VAR}
    out = out.replace(/\$\{?(\w+)\}?/g, (match, varName) => {
      return process.env[varName] || match;
    });

    return out;
  }

  /**
   * Check if a string looks like a SystemVerilog file.
   */
  private looksLikeSvFile(str: string): boolean {
    // Check for common SV extensions
    const ext = path.extname(str).toLowerCase();
    return ['.sv', '.svh', '.v', '.vh', '.svi'].includes(ext);
  }

  /**
   * Merge a nested recipe into the parent.
   */
  private mergeRecipe(parent: Recipe, child: Recipe, fileSet: Set<string>): void {
    // Add include paths (avoid duplicates)
    for (const incPath of child.includePaths) {
      if (!parent.includePaths.includes(incPath)) {
        parent.includePaths.push(incPath);
      }
    }

    // Add defines (child overrides parent)
    Object.assign(parent.defines, child.defines);

    // Add nested filelists (avoid duplicates) - include transitive children too
    for (const nested of child.nestedFilelists) {
      if (!parent.nestedFilelists.includes(nested)) {
        parent.nestedFilelists.push(nested);
      }
    }

    // Add files (in order, avoid duplicates)
    for (const file of child.files) {
      if (fileSet.has(file)) continue;
      fileSet.add(file);
      parent.files.push(file);
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new filelist parser.
 *
 * @returns New FilelistParser instance
 */
export function createFilelistParser(): FilelistParser {
  return new FilelistParser();
}

/**
 * Parse a filelist file.
 *
 * Convenience function that creates a parser and parses the file.
 *
 * @param filelistPath - Path to the .f file
 * @param options - Parse options
 * @returns Parsed recipe
 */
export async function parseFilelist(
  filelistPath: string,
  options: ParseFilelistOptions = {}
): Promise<Recipe> {
  const parser = new FilelistParser();
  return parser.parse(filelistPath, options);
}

// ============================================================================
// Recipe Utilities
// ============================================================================

/**
 * Get the compile order for files in a recipe.
 *
 * Files are returned in the order they appear in the filelist,
 * which is typically the correct compile order.
 *
 * @param recipe - Parsed recipe
 * @returns Array of file paths in compile order
 */
export function getCompileOrder(recipe: Recipe): string[] {
  return [...recipe.files];
}

/**
 * Find a file in the include paths.
 *
 * @param recipe - Parsed recipe
 * @param filename - File to find (can be relative)
 * @returns Absolute path to file, or null if not found
 */
export async function resolveInclude(
  recipe: Recipe,
  filename: string
): Promise<string | null> {
  // Try each include path in order
  for (const incPath of recipe.includePaths) {
    const candidate = path.join(incPath, filename);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // File doesn't exist in this path, try next
    }
  }

  return null;
}

/**
 * Check if a macro is defined in the recipe.
 *
 * @param recipe - Parsed recipe
 * @param macroName - Macro name to check
 * @returns True if macro is defined
 */
export function hasMacro(recipe: Recipe, macroName: string): boolean {
  return macroName in recipe.defines;
}

/**
 * Get the value of a macro.
 *
 * @param recipe - Parsed recipe
 * @param macroName - Macro name
 * @returns Macro value, or undefined if not defined
 */
export function getMacroValue(
  recipe: Recipe,
  macroName: string
): string | undefined {
  return recipe.defines[macroName];
}
