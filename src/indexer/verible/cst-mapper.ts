/**
 * Verible CST Mapper
 *
 * Maps Verible's Concrete Syntax Tree (CST) to our indexer types.
 * This is the main orchestrator that dispatches to specialized sub-mappers.
 *
 * @module verible/cst-mapper
 */

import type { VeribleNode, VeribleParseResult } from './types.js';
import { isNode, NODE_TAGS } from './types.js';

// Types
import {
  type CSTMapperResult,
  type MapperContext,
  createMapperContext,
} from './mappers/types.js';

// Declaration mappers
import {
  visitModuleDeclaration,
  visitPackageDeclaration,
  visitInterfaceDeclaration,
  visitClassDeclaration,
  visitProgramDeclaration,
  visitCheckerDeclaration,
  visitConfigDeclaration,
  visitFunctionDeclaration,
  visitTaskDeclaration,
  visitTypedefDeclaration,
  visitParameterDeclaration,
  visitPortDeclaration,
  visitAlwaysStatement,
  visitInitialStatement,
  visitGenerateBlock,
  visitModportDeclaration,
  visitClockingDeclaration,
  visitSequenceDeclaration,
  visitPropertyDeclaration,
  visitCovergroupDeclaration,
} from './mappers/declaration/index.js';

// Instance mapper
import {
  visitModuleInstantiation,
  visitBindDirective,
} from './mappers/instance-mapper.js';

// Reference mapper
import { visitPackageImport } from './mappers/reference-mapper.js';

// Directive mapper
import {
  visitPreprocessorInclude,
  visitPreprocessorDefine,
  visitPreprocessorIfdef,
} from './mappers/directive-mapper.js';

// Re-export types for external use
export type { CSTMapperResult } from './mappers/types.js';

/**
 * Maps Verible CST to our indexer types.
 */
export class CSTMapper {
  /**
   * Map a Verible parse result to our types.
   *
   * @param result - Verible parse result
   * @param content - Source file content
   * @param lineOffsets - Line offset array for position calculation
   * @returns Mapped result
   */
  map(
    result: VeribleParseResult,
    content: string,
    lineOffsets: number[]
  ): CSTMapperResult {
    const context = createMapperContext(result.file, content, lineOffsets);

    // Map Verible errors to our error type
    for (const error of result.errors) {
      context.errors.push({
        message: error.message,
        location: {
          file: result.file,
          line: error.line,
          col: error.column,
        },
        severity: error.severity === 'error' ? 'error' : 'warning',
      });
    }

    // Traverse the CST
    if (result.tree) {
      this.visitNode(result.tree, context);
    }

    return {
      declarations: context.declarations,
      references: context.references,
      instances: context.instances,
      directives: context.directives,
      errors: context.errors,
    };
  }

  /**
   * Visit a CST node and dispatch to appropriate handler.
   */
  private visitNode(node: VeribleNode, context: MapperContext): void {
    // Bind visitChildren for passing to handlers that need recursion
    const visitChildren = (n: VeribleNode, ctx: MapperContext) => this.visitChildren(n, ctx);

    // Handle node based on tag
    switch (node.tag) {
      // Design units
      case NODE_TAGS.MODULE_DECLARATION:
        visitModuleDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.PACKAGE_DECLARATION:
        visitPackageDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.INTERFACE_DECLARATION:
        visitInterfaceDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.CLASS_DECLARATION:
        visitClassDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.PROGRAM_DECLARATION:
        visitProgramDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.CHECKER_DECLARATION:
        visitCheckerDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.CONFIG_DECLARATION:
        visitConfigDeclaration(node, context);
        break;

      // Functions/Tasks
      case NODE_TAGS.FUNCTION_DECLARATION:
        visitFunctionDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.TASK_DECLARATION:
        visitTaskDeclaration(node, context, visitChildren);
        break;

      // Types
      case NODE_TAGS.TYPEDEF_DECLARATION:
        visitTypedefDeclaration(node, context);
        break;

      // Parameters
      case NODE_TAGS.PARAMETER_DECLARATION:
        visitParameterDeclaration(node, context, 'parameter');
        break;
      case NODE_TAGS.LOCALPARAM_DECLARATION:
        visitParameterDeclaration(node, context, 'localparam');
        break;

      // Ports
      case NODE_TAGS.PORT_DECLARATION:
        visitPortDeclaration(node, context);
        break;

      // Instantiation
      case NODE_TAGS.MODULE_INSTANTIATION:
        visitModuleInstantiation(node, context);
        break;

      // Imports
      case NODE_TAGS.PACKAGE_IMPORT_DECLARATION:
        visitPackageImport(node, context);
        break;

      // Assertions
      case NODE_TAGS.SEQUENCE_DECLARATION:
        visitSequenceDeclaration(node, context);
        break;
      case NODE_TAGS.PROPERTY_DECLARATION:
        visitPropertyDeclaration(node, context);
        break;

      // Coverage
      case NODE_TAGS.COVERGROUP_DECLARATION:
        visitCovergroupDeclaration(node, context);
        break;

      // Interface
      case NODE_TAGS.MODPORT_DECLARATION:
        visitModportDeclaration(node, context);
        break;
      case NODE_TAGS.CLOCKING_DECLARATION:
        visitClockingDeclaration(node, context);
        break;

      // Procedural
      case NODE_TAGS.ALWAYS_STATEMENT:
        visitAlwaysStatement(node, context, visitChildren);
        break;
      case NODE_TAGS.INITIAL_STATEMENT:
        visitInitialStatement(node, context, visitChildren);
        break;
      case NODE_TAGS.GENERATE_BLOCK:
        visitGenerateBlock(node, context, visitChildren);
        break;

      // Bind
      case NODE_TAGS.BIND_DIRECTIVE:
        visitBindDirective(node, context);
        break;

      // Preprocessor directives
      case NODE_TAGS.PREPROCESS_INCLUDE:
        visitPreprocessorInclude(node, context);
        break;
      case NODE_TAGS.PREPROCESS_DEFINE:
        visitPreprocessorDefine(node, context);
        break;
      case NODE_TAGS.PREPROCESS_IFDEF:
      case NODE_TAGS.PREPROCESS_IFNDEF:
        visitPreprocessorIfdef(node, context);
        break;

      // Default: recurse into children
      default:
        this.visitChildren(node, context);
    }
  }

  /**
   * Visit all children of a node.
   */
  private visitChildren(node: VeribleNode, context: MapperContext): void {
    for (const child of node.children) {
      if (isNode(child)) {
        this.visitNode(child, context);
      }
    }
  }
}

/**
 * Create a new CST mapper instance.
 */
export function createCSTMapper(): CSTMapper {
  return new CSTMapper();
}
