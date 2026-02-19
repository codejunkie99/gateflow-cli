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
  visitDpiFunctionDeclaration,
  visitTypedefDeclaration,
  processEnumTypedef,
  processStructTypedef,
  processUnionTypedef,
  visitNetDeclaration,
  visitDataDeclaration,
  visitVariableDeclaration,
  visitRegDeclaration,
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
  visitConstraintDeclaration,
} from './mappers/declaration/index.js';

// Instance mapper
import {
  visitModuleInstantiation,
  visitBindDirective,
  registerInterface,
  registerChecker,
} from './mappers/instance-mapper.js';

// Reference mapper
import {
  visitPackageImport,
  visitMacroCall,
  visitAssertStatement,
  visitAssumeStatement,
  visitCoverStatement,
  visitQualifiedId,
} from './mappers/reference-mapper.js';

// Directive mapper
import {
  visitPreprocessorInclude,
  visitPreprocessorDefine,
  visitPreprocessorIfdef,
  visitPreprocessorElsif,
  visitPreprocessorElse,
  visitPreprocessorEndif,
  visitPreprocessorUndef,
  visitTimescale,
  visitDefaultNettype,
  visitPragma,
  visitDpiImport,
  visitDpiExport,
} from './mappers/directive-mapper.js';

// Re-export types for external use
export type { CSTMapperResult } from './mappers/types.js';

/**
 * Maps Verible CST to our indexer types.
 */
class CSTMapper {
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
    const treeWasNull = !result.tree;
    if (result.tree) {
      this.visitNode(result.tree, context);
    }

    return {
      declarations: context.declarations,
      references: context.references,
      instances: context.instances,
      directives: context.directives,
      errors: context.errors,
      treeWasNull,
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
        // Register interface for kind discrimination
        registerInterface(this.getNodeName(node) || '');
        visitInterfaceDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.CLASS_DECLARATION:
        visitClassDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.PROGRAM_DECLARATION:
        visitProgramDeclaration(node, context, visitChildren);
        break;
      case NODE_TAGS.CHECKER_DECLARATION:
      case 'kCheckerDeclaration':
        // Register checker for kind discrimination
        registerChecker(this.getNodeName(node) || '');
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

      // Types - typedef with enum/struct/union detection
      case NODE_TAGS.TYPEDEF_DECLARATION:
      case 'kTypeDeclaration':
        // Check for enum, struct, or union within typedef
        if (!processEnumTypedef(node, context) &&
            !processStructTypedef(node, context) &&
            !processUnionTypedef(node, context)) {
          // Fall back to regular typedef
          visitTypedefDeclaration(node, context);
        }
        break;

      // Net/Signal declarations
      case NODE_TAGS.NET_DECLARATION:
      case 'kNetDeclaration':
        visitNetDeclaration(node, context);
        break;
      case NODE_TAGS.DATA_DECLARATION:
      case 'kDataDeclaration':
        visitDataDeclaration(node, context);
        break;
      case NODE_TAGS.VARIABLE_DECLARATION:
      case 'kVariableDeclaration':
        visitVariableDeclaration(node, context);
        break;
      case NODE_TAGS.REG_DECLARATION:
      case 'kRegDeclaration':
        visitRegDeclaration(node, context);
        break;

      // Parameters
      case NODE_TAGS.PARAMETER_DECLARATION:
      case 'kParamDeclaration':
      case 'kParameterDeclaration':
        // Debug log
        if (process.env.DEBUG_PARAMS === 'true') {
          console.log(`[CST] Found parameter node: ${node.tag}, context scope: ${context.scope.join('.')}`);
        }
        visitParameterDeclaration(node, context, 'parameter');
        break;
      case NODE_TAGS.LOCALPARAM_DECLARATION:
      case 'kLocalparamDeclaration':
      case 'kLocalParamDeclaration':
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

      // Macro calls
      case NODE_TAGS.MACRO_CALL:
      case 'kMacroCall':
        visitMacroCall(node, context);
        break;

      // Assertions (as references)
      case NODE_TAGS.ASSERT_STATEMENT:
      case 'kAssertStatement':
      case 'kAssertPropertyStatement':
      case 'kAssertionStatement':
      case 'kConcurrentAssertionStatement':
        visitAssertStatement(node, context);
        this.visitChildren(node, context);
        break;
      case NODE_TAGS.ASSUME_STATEMENT:
      case 'kAssumeStatement':
      case 'kAssumePropertyStatement':
        visitAssumeStatement(node, context);
        this.visitChildren(node, context);
        break;
      case NODE_TAGS.COVER_STATEMENT:
      case 'kCoverStatement':
      case 'kCoverPropertyStatement':
      case 'kCoverSequenceStatement':
        visitCoverStatement(node, context);
        this.visitChildren(node, context);
        break;

      // Qualified identifiers (scoped references)
      case NODE_TAGS.QUALIFIED_ID:
      case 'kQualifiedId':
        visitQualifiedId(node, context);
        break;

      // Assertion declarations
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

      // Constraints
      case NODE_TAGS.CONSTRAINT_DECLARATION:
      case 'kConstraintDeclaration':
        visitConstraintDeclaration(node, context);
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
      case 'kPreprocessorInclude':
        visitPreprocessorInclude(node, context);
        break;
      case NODE_TAGS.PREPROCESS_DEFINE:
      case 'kPreprocessorDefine':
        visitPreprocessorDefine(node, context);
        break;
      case NODE_TAGS.PREPROCESS_IFDEF:
      case NODE_TAGS.PREPROCESS_IFNDEF:
      case 'kPreprocessorIfdef':
      case 'kPreprocessorIfndef':
        visitPreprocessorIfdef(node, context);
        this.visitChildren(node, context);
        break;
      case 'kPreprocessorElsif':
        visitPreprocessorElsif(node, context);
        this.visitChildren(node, context);
        break;
      case 'kPreprocessorElse':
        visitPreprocessorElse(node, context);
        this.visitChildren(node, context);
        break;
      case 'kPreprocessorEndif':
        visitPreprocessorEndif(node, context);
        break;
      case 'kPreprocessorUndef':
        visitPreprocessorUndef(node, context);
        break;
      case 'kPreprocessorTimescale':
        visitTimescale(node, context);
        break;
      case 'kPreprocessorDefaultNettype':
        visitDefaultNettype(node, context);
        break;
      case 'kPreprocessorPragma':
        visitPragma(node, context);
        break;

      // DPI declarations
      case 'kDpiImportItem':
      case 'kDPIImportItem':
      case 'kDPIImport':
      case 'kDpiImport':
        visitDpiImport(node, context);
        visitDpiFunctionDeclaration(node, context);
        break;
      case 'kDpiExportItem':
      case 'kDPIExportItem':
      case 'kDPIExport':
      case 'kDpiExport':
        visitDpiExport(node, context);
        break;

      // Default: recurse into children
      default:
        // Log unhandled tags for debugging (only when debugging enabled)
        if (process.env.DEBUG_CST_MAPPER === 'true') {
          console.log(`[CST] Unhandled tag: ${node.tag}`);
        }
        this.visitChildren(node, context);
    }
  }

  /**
   * Get the name of a node (for registration purposes).
   */
  private getNodeName(node: VeribleNode): string | undefined {
    for (const child of node.children) {
      if (isNode(child)) {
        if (child.tag === NODE_TAGS.UNQUALIFIED_ID || child.tag === 'kUnqualifiedId') {
          for (const grandChild of child.children) {
            if (!isNode(grandChild) && grandChild && 'text' in grandChild) {
              return grandChild.text;
            }
          }
        }
      }
    }
    return undefined;
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
