/**
 * Verible CST Mapper
 *
 * Maps Verible's Concrete Syntax Tree (CST) to our indexer types.
 * This is the bridge between Verible's parse output and our type system.
 *
 * @module verible/cst-mapper
 */

import type {
  VeribleNode,
  VeribleToken,
  VeribleParseResult,
} from './types.js';
import { isNode, isToken, NODE_TAGS, TOKEN_TAGS } from './types.js';
import type {
  Declaration,
  DeclarationKind,
  DeclarationData,
  ModuleData,
  PackageData,
  InterfaceData,
  ClassData,
  FunctionData,
  TaskData,
  PortData,
  ParamInfo,
  ArgInfo,
} from '../types/declaration.js';
import type { Reference, ReferenceKind } from '../types/reference.js';
import type { Instance, InstanceKind, PortConnection } from '../types/instance.js';
import type { Directive, DirectiveKind } from '../types/directive.js';
import type { Location, Guard, ParseError } from '../types/location.js';
import { declarationId, locationId } from '../ids/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from mapping a Verible CST.
 */
export interface CSTMapperResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  directives: Directive[];
  errors: ParseError[];
}

/**
 * Context passed during tree traversal.
 */
interface MapperContext {
  /** Source file path */
  filePath: string;

  /** Source file content (for extracting text) */
  content: string;

  /** Line offsets for position calculation */
  lineOffsets: number[];

  /** Current scope chain */
  scope: string[];

  /** Current parent declaration ID */
  parentId?: string;

  /** Current guard condition */
  guard?: Guard;

  /** Accumulated declarations */
  declarations: Declaration[];

  /** Accumulated references */
  references: Reference[];

  /** Accumulated instances */
  instances: Instance[];

  /** Accumulated directives */
  directives: Directive[];

  /** Accumulated errors */
  errors: ParseError[];
}

// ============================================================================
// Main Mapper Class
// ============================================================================

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
    const context: MapperContext = {
      filePath: result.file,
      content,
      lineOffsets,
      scope: [],
      declarations: [],
      references: [],
      instances: [],
      directives: [],
      errors: [],
    };

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

  // ---------------------------------------------------------------------------
  // Tree Traversal
  // ---------------------------------------------------------------------------

  /**
   * Visit a CST node and dispatch to appropriate handler.
   */
  private visitNode(node: VeribleNode, context: MapperContext): void {
    // Handle node based on tag
    switch (node.tag) {
      // Design units
      case NODE_TAGS.MODULE_DECLARATION:
        this.visitModuleDeclaration(node, context);
        break;
      case NODE_TAGS.PACKAGE_DECLARATION:
        this.visitPackageDeclaration(node, context);
        break;
      case NODE_TAGS.INTERFACE_DECLARATION:
        this.visitInterfaceDeclaration(node, context);
        break;
      case NODE_TAGS.CLASS_DECLARATION:
        this.visitClassDeclaration(node, context);
        break;
      case NODE_TAGS.PROGRAM_DECLARATION:
        this.visitProgramDeclaration(node, context);
        break;
      case NODE_TAGS.CHECKER_DECLARATION:
        this.visitCheckerDeclaration(node, context);
        break;
      case NODE_TAGS.CONFIG_DECLARATION:
        this.visitConfigDeclaration(node, context);
        break;

      // Functions/Tasks
      case NODE_TAGS.FUNCTION_DECLARATION:
        this.visitFunctionDeclaration(node, context);
        break;
      case NODE_TAGS.TASK_DECLARATION:
        this.visitTaskDeclaration(node, context);
        break;

      // Types
      case NODE_TAGS.TYPEDEF_DECLARATION:
        this.visitTypedefDeclaration(node, context);
        break;

      // Parameters
      case NODE_TAGS.PARAMETER_DECLARATION:
        this.visitParameterDeclaration(node, context, 'parameter');
        break;
      case NODE_TAGS.LOCALPARAM_DECLARATION:
        this.visitParameterDeclaration(node, context, 'localparam');
        break;

      // Ports
      case NODE_TAGS.PORT_DECLARATION:
        this.visitPortDeclaration(node, context);
        break;

      // Instantiation
      case NODE_TAGS.MODULE_INSTANTIATION:
        this.visitModuleInstantiation(node, context);
        break;

      // Imports
      case NODE_TAGS.PACKAGE_IMPORT_DECLARATION:
        this.visitPackageImport(node, context);
        break;

      // Assertions
      case NODE_TAGS.SEQUENCE_DECLARATION:
        this.visitSequenceDeclaration(node, context);
        break;
      case NODE_TAGS.PROPERTY_DECLARATION:
        this.visitPropertyDeclaration(node, context);
        break;

      // Coverage
      case NODE_TAGS.COVERGROUP_DECLARATION:
        this.visitCovergroupDeclaration(node, context);
        break;

      // Interface
      case NODE_TAGS.MODPORT_DECLARATION:
        this.visitModportDeclaration(node, context);
        break;
      case NODE_TAGS.CLOCKING_DECLARATION:
        this.visitClockingDeclaration(node, context);
        break;

      // Procedural
      case NODE_TAGS.ALWAYS_STATEMENT:
        this.visitAlwaysStatement(node, context);
        break;
      case NODE_TAGS.INITIAL_STATEMENT:
        this.visitInitialStatement(node, context);
        break;
      case NODE_TAGS.GENERATE_BLOCK:
        this.visitGenerateBlock(node, context);
        break;

      // Bind
      case NODE_TAGS.BIND_DIRECTIVE:
        this.visitBindDirective(node, context);
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

  // ---------------------------------------------------------------------------
  // Design Unit Handlers
  // ---------------------------------------------------------------------------

  private visitModuleDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'module', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    // Extract parameters from module header
    const params = this.extractParameters(node);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'module',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'module',
        params,
      } as ModuleData,
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  private visitPackageDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'package', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'package',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'package' } as PackageData,
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  private visitInterfaceDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'interface', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const params = this.extractParameters(node);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'interface',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'interface',
        params,
        modports: [],
      } as InterfaceData,
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  private visitClassDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'class', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    // Check for extends clause
    const extendsClause = this.findChildByTag(node, NODE_TAGS.EXTENDS_CLAUSE);
    const extendsClass = extendsClause ? this.findIdentifier(extendsClause) : undefined;

    // If extends, add reference
    if (extendsClass) {
      const extendsLoc = this.getNodeLocation(extendsClause!, context);
      context.references.push({
        id: locationId(context.filePath, extendsLoc.line, extendsLoc.col),
        kind: 'extends',
        targetName: extendsClass,
        location: extendsLoc,
        scope: [...context.scope],
        guard: context.guard,
      });
    }

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'class',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'class',
        extendsClass,
        isVirtual: this.hasKeyword(node, 'virtual'),
        isAbstract: this.hasKeyword(node, 'pure'),
      } as ClassData,
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  private visitProgramDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'program', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'program',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'program' },
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  private visitCheckerDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'checker', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'checker',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'checker', ports: [] },
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  private visitConfigDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'config', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'config',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'config', cellUseStatements: [] },
    };

    context.declarations.push(declaration);
  }

  // ---------------------------------------------------------------------------
  // Function/Task Handlers
  // ---------------------------------------------------------------------------

  private visitFunctionDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'function', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const returnType = this.extractReturnType(node);
    const args = this.extractFunctionArgs(node);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'function',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'function',
        returnType,
        args,
        isAutomatic: this.hasKeyword(node, 'automatic'),
        isStatic: this.hasKeyword(node, 'static'),
      } as FunctionData,
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  private visitTaskDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'task', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const args = this.extractFunctionArgs(node);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'task',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'task',
        args,
        isAutomatic: this.hasKeyword(node, 'automatic'),
        isStatic: this.hasKeyword(node, 'static'),
      } as TaskData,
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, name],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  // ---------------------------------------------------------------------------
  // Type Handlers
  // ---------------------------------------------------------------------------

  private visitTypedefDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'typedef', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const baseType = this.extractBaseType(node);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'typedef',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'typedef',
        underlyingType: baseType,
      },
    };

    context.declarations.push(declaration);
  }

  // ---------------------------------------------------------------------------
  // Parameter/Port Handlers
  // ---------------------------------------------------------------------------

  private visitParameterDeclaration(
    node: VeribleNode,
    context: MapperContext,
    kind: 'parameter' | 'localparam'
  ): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, kind, name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const paramType = this.extractDataType(node);
    const defaultValue = this.extractDefaultValue(node);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind,
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: kind === 'parameter'
        ? { kind: 'parameter', paramType, defaultValue }
        : { kind: 'localparam', paramType, value: defaultValue || '' },
    };

    context.declarations.push(declaration);
  }

  private visitPortDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'port', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const direction = this.extractPortDirection(node);
    const portType = this.extractDataType(node);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'port',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: {
        kind: 'port',
        direction,
        portType,
      } as PortData,
    };

    context.declarations.push(declaration);
  }

  // ---------------------------------------------------------------------------
  // Instantiation Handler
  // ---------------------------------------------------------------------------

  private visitModuleInstantiation(node: VeribleNode, context: MapperContext): void {
    // Get the module type being instantiated
    const typeNode = this.findChildByTag(node, NODE_TAGS.INSTANTIATION_TYPE);
    const targetName = typeNode ? this.findIdentifier(typeNode) : this.findFirstIdentifier(node);
    if (!targetName) return;

    // Find all instance names
    const instanceNames = this.findInstanceNames(node);

    for (const instanceName of instanceNames) {
      const location = this.getNodeLocation(node, context);
      const id = locationId(context.filePath, location.line, location.col);

      // Extract port connections
      const connections = this.extractPortConnections(node, context);

      // Extract parameter overrides
      const paramOverrides = this.extractParameterOverrides(node);

      const instance: Instance = {
        id,
        instanceKind: 'module',
        instanceName,
        targetName,
        location,
        parentScope: [...context.scope],
        connections,
        paramOverrides,
        guard: context.guard,
      };

      context.instances.push(instance);

      // Add reference to the target module
      context.references.push({
        id: locationId(context.filePath, location.line, location.col + 1),
        kind: 'type_usage',
        targetName,
        location,
        scope: [...context.scope],
        guard: context.guard,
      });
    }
  }

  private visitBindDirective(node: VeribleNode, context: MapperContext): void {
    // Bind has format: bind <target> <module> <instance>
    const identifiers = this.findAllIdentifiers(node);
    if (identifiers.length < 3) return;

    const bindTarget = identifiers[0];
    const targetName = identifiers[1];
    const instanceName = identifiers[2];

    const location = this.getNodeLocation(node, context);
    const id = locationId(context.filePath, location.line, location.col);

    const instance: Instance = {
      id,
      instanceKind: 'bind',
      instanceName,
      targetName,
      bindTarget,
      location,
      parentScope: [...context.scope],
      guard: context.guard,
    };

    context.instances.push(instance);
  }

  // ---------------------------------------------------------------------------
  // Import Handler
  // ---------------------------------------------------------------------------

  private visitPackageImport(node: VeribleNode, context: MapperContext): void {
    // Find package::member pattern
    const identifiers = this.findAllIdentifiers(node);
    if (identifiers.length === 0) return;

    const packageName = identifiers[0];
    const memberName = identifiers.length > 1 ? identifiers[1] : '*';

    const location = this.getNodeLocation(node, context);
    const id = locationId(context.filePath, location.line, location.col);

    context.references.push({
      id,
      kind: 'import',
      targetName: packageName,
      location,
      scope: [...context.scope],
      guard: context.guard,
      data: {
        kind: 'import',
        memberName,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Assertion/Coverage Handlers
  // ---------------------------------------------------------------------------

  private visitSequenceDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'sequence', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'sequence',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'sequence' },
    };

    context.declarations.push(declaration);
  }

  private visitPropertyDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'property', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'property',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'property' },
    };

    context.declarations.push(declaration);
  }

  private visitCovergroupDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'covergroup', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'covergroup',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'covergroup' },
    };

    context.declarations.push(declaration);
  }

  // ---------------------------------------------------------------------------
  // Interface Construct Handlers
  // ---------------------------------------------------------------------------

  private visitModportDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'modport', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'modport',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'modport', ports: [] },
    };

    context.declarations.push(declaration);
  }

  private visitClockingDeclaration(node: VeribleNode, context: MapperContext): void {
    const name = this.findIdentifier(node);
    if (!name) return;

    const location = this.getNodeLocation(node, context);
    const id = declarationId(context.filePath, 'clocking', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'clocking',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'clocking', clockEvent: '', signals: [] },
    };

    context.declarations.push(declaration);
  }

  // ---------------------------------------------------------------------------
  // Procedural Block Handlers
  // ---------------------------------------------------------------------------

  private visitAlwaysStatement(node: VeribleNode, context: MapperContext): void {
    const location = this.getNodeLocation(node, context);
    const name = `always_${location.line}`;
    const id = declarationId(context.filePath, 'always_block', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    // Determine always type
    let blockType: 'always' | 'always_comb' | 'always_ff' | 'always_latch' = 'always';
    const firstToken = this.findFirstToken(node);
    if (firstToken) {
      if (firstToken.text === 'always_comb') blockType = 'always_comb';
      else if (firstToken.text === 'always_ff') blockType = 'always_ff';
      else if (firstToken.text === 'always_latch') blockType = 'always_latch';
    }

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'always_block',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'always_block', blockType },
    };

    context.declarations.push(declaration);
    this.visitChildren(node, context);
  }

  private visitInitialStatement(node: VeribleNode, context: MapperContext): void {
    const location = this.getNodeLocation(node, context);
    const name = `initial_${location.line}`;
    const id = declarationId(context.filePath, 'initial_block', name, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'initial_block',
      name,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'initial_block' },
    };

    context.declarations.push(declaration);
    this.visitChildren(node, context);
  }

  private visitGenerateBlock(node: VeribleNode, context: MapperContext): void {
    const location = this.getNodeLocation(node, context);
    const label = this.findLabel(node) || `generate_${location.line}`;
    const id = declarationId(context.filePath, 'generate_block', label, context.scope);
    const locId = locationId(context.filePath, location.line, location.col);

    const declaration: Declaration = {
      id,
      locationId: locId,
      kind: 'generate_block',
      name: label,
      location,
      scope: [...context.scope],
      parentId: context.parentId,
      guard: context.guard,
      data: { kind: 'generate_block', generateType: 'for', label },
    };

    context.declarations.push(declaration);

    // Visit children with updated scope
    const childContext: MapperContext = {
      ...context,
      scope: [...context.scope, label],
      parentId: id,
    };
    this.visitChildren(node, childContext);
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Find the first identifier in a node.
   */
  private findIdentifier(node: VeribleNode): string | undefined {
    for (const child of node.children) {
      if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
        return child.text;
      }
      if (isNode(child)) {
        if (child.tag === NODE_TAGS.UNQUALIFIED_ID || child.tag === 'kUnqualifiedId') {
          const id = this.findIdentifier(child);
          if (id) return id;
        }
        // Check first few children of header nodes
        if (child.tag.includes('Header')) {
          const id = this.findIdentifier(child);
          if (id) return id;
        }
      }
    }
    return undefined;
  }

  /**
   * Find the first identifier anywhere in the tree.
   */
  private findFirstIdentifier(node: VeribleNode): string | undefined {
    for (const child of node.children) {
      if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
        return child.text;
      }
      if (isNode(child)) {
        const id = this.findFirstIdentifier(child);
        if (id) return id;
      }
    }
    return undefined;
  }

  /**
   * Find all identifiers in a node.
   */
  private findAllIdentifiers(node: VeribleNode): string[] {
    const ids: string[] = [];
    for (const child of node.children) {
      if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
        ids.push(child.text);
      }
      if (isNode(child)) {
        ids.push(...this.findAllIdentifiers(child));
      }
    }
    return ids;
  }

  /**
   * Find a child node by tag.
   */
  private findChildByTag(node: VeribleNode, tag: string): VeribleNode | undefined {
    for (const child of node.children) {
      if (isNode(child) && child.tag === tag) {
        return child;
      }
    }
    return undefined;
  }

  /**
   * Find the first token in a node.
   */
  private findFirstToken(node: VeribleNode): VeribleToken | undefined {
    for (const child of node.children) {
      if (isToken(child)) {
        return child;
      }
      if (isNode(child)) {
        const token = this.findFirstToken(child);
        if (token) return token;
      }
    }
    return undefined;
  }

  /**
   * Check if a node contains a specific keyword.
   */
  private hasKeyword(node: VeribleNode, keyword: string): boolean {
    for (const child of node.children) {
      if (isToken(child) && child.text === keyword) {
        return true;
      }
      if (isNode(child) && this.hasKeyword(child, keyword)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find a label (for generate blocks).
   */
  private findLabel(node: VeribleNode): string | undefined {
    // Labels are typically identifier followed by colon
    for (let i = 0; i < node.children.length - 1; i++) {
      const child = node.children[i];
      const next = node.children[i + 1];
      if (isToken(child) && child.tag === TOKEN_TAGS.SYMBOL_IDENTIFIER) {
        if (isToken(next) && next.text === ':') {
          return child.text;
        }
      }
    }
    return undefined;
  }

  /**
   * Get the location of a node.
   */
  private getNodeLocation(node: VeribleNode, context: MapperContext): Location {
    const firstToken = this.findFirstToken(node);
    if (firstToken) {
      const { line, col } = this.offsetToLineCol(firstToken.start, context.lineOffsets);
      return { file: context.filePath, line, col };
    }
    return { file: context.filePath, line: 1, col: 1 };
  }

  /**
   * Convert byte offset to line/column.
   */
  private offsetToLineCol(offset: number, lineOffsets: number[]): { line: number; col: number } {
    // Binary search for line
    let low = 0;
    let high = lineOffsets.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineOffsets[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    const line = low + 1; // 1-based
    const col = offset - lineOffsets[low] + 1; // 1-based
    return { line, col };
  }

  /**
   * Extract parameters from a module/interface header.
   */
  private extractParameters(node: VeribleNode): ParamInfo[] {
    const params: ParamInfo[] = [];
    const paramList = this.findChildByTag(node, NODE_TAGS.PARAMETER_PORT_LIST);
    if (!paramList) return params;

    // Find all parameter declarations in the list
    for (const child of paramList.children) {
      if (isNode(child) && (child.tag === NODE_TAGS.PARAMETER_DECLARATION || child.tag === 'kParamDeclaration')) {
        const name = this.findIdentifier(child);
        if (name) {
          params.push({
            name,
            type: this.extractDataType(child),
            default: this.extractDefaultValue(child),
          });
        }
      }
    }

    return params;
  }

  /**
   * Extract function/task arguments.
   */
  private extractFunctionArgs(node: VeribleNode): ArgInfo[] {
    const args: ArgInfo[] = [];
    // Look for port declarations within function/task
    for (const child of node.children) {
      if (isNode(child) && child.tag === NODE_TAGS.PORT_DECLARATION_LIST) {
        for (const portChild of child.children) {
          if (isNode(portChild) && portChild.tag === NODE_TAGS.PORT_DECLARATION) {
            const name = this.findIdentifier(portChild);
            if (name) {
              args.push({
                name,
                direction: this.extractPortDirection(portChild),
                type: this.extractDataType(portChild),
              });
            }
          }
        }
      }
    }
    return args;
  }

  /**
   * Extract port direction.
   */
  private extractPortDirection(node: VeribleNode): 'input' | 'output' | 'inout' | 'ref' {
    for (const child of node.children) {
      if (isToken(child)) {
        if (child.text === 'input') return 'input';
        if (child.text === 'output') return 'output';
        if (child.text === 'inout') return 'inout';
        if (child.text === 'ref') return 'ref';
      }
    }
    return 'input'; // Default
  }

  /**
   * Extract data type from a declaration.
   */
  private extractDataType(node: VeribleNode): string {
    const typeNode = this.findChildByTag(node, NODE_TAGS.DATA_TYPE);
    if (typeNode) {
      return this.nodeToText(typeNode);
    }
    return 'logic'; // Default
  }

  /**
   * Extract base type for typedef.
   */
  private extractBaseType(node: VeribleNode): string {
    const typeNode = this.findChildByTag(node, NODE_TAGS.DATA_TYPE);
    if (typeNode) {
      return this.nodeToText(typeNode);
    }
    return '';
  }

  /**
   * Extract return type from function.
   */
  private extractReturnType(node: VeribleNode): string {
    const header = this.findChildByTag(node, NODE_TAGS.FUNCTION_HEADER);
    if (header) {
      const typeNode = this.findChildByTag(header, NODE_TAGS.DATA_TYPE);
      if (typeNode) {
        return this.nodeToText(typeNode);
      }
    }
    return 'void';
  }

  /**
   * Extract default value from parameter.
   */
  private extractDefaultValue(node: VeribleNode): string | undefined {
    // Look for = followed by expression
    let foundEquals = false;
    for (const child of node.children) {
      if (isToken(child) && child.text === '=') {
        foundEquals = true;
        continue;
      }
      if (foundEquals && isNode(child)) {
        return this.nodeToText(child);
      }
      if (foundEquals && isToken(child) && child.tag !== TOKEN_TAGS.SEMICOLON) {
        return child.text;
      }
    }
    return undefined;
  }

  /**
   * Find instance names in module instantiation.
   */
  private findInstanceNames(node: VeribleNode): string[] {
    const names: string[] = [];
    const instanceNode = this.findChildByTag(node, NODE_TAGS.INSTANCE_NAME);
    if (instanceNode) {
      const name = this.findIdentifier(instanceNode);
      if (name) names.push(name);
    } else {
      // Look for identifiers that are not the module type
      const allIds = this.findAllIdentifiers(node);
      if (allIds.length > 1) {
        names.push(allIds[1]); // Second identifier is typically the instance name
      }
    }
    return names;
  }

  /**
   * Extract port connections from instantiation.
   */
  private extractPortConnections(node: VeribleNode, context: MapperContext): PortConnection[] {
    const connections: PortConnection[] = [];

    // Find named connections (.port(signal))
    for (const child of node.children) {
      if (isNode(child) && child.tag === NODE_TAGS.NAMED_PORT_CONNECTION) {
        const ids = this.findAllIdentifiers(child);
        if (ids.length >= 1) {
          const location = this.getNodeLocation(child, context);
          connections.push({
            portName: ids[0],
            signalName: ids.length > 1 ? ids[1] : ids[0],
            location,
          });
        }
      }
    }

    return connections;
  }

  /**
   * Extract parameter overrides from instantiation.
   */
  private extractParameterOverrides(node: VeribleNode): Record<string, string> {
    const overrides: Record<string, string> = {};
    const paramNode = this.findChildByTag(node, NODE_TAGS.PARAMETER_VALUE_ASSIGNMENT);
    if (paramNode) {
      // Extract named parameter assignments
      for (const child of paramNode.children) {
        if (isNode(child)) {
          const ids = this.findAllIdentifiers(child);
          if (ids.length >= 2) {
            overrides[ids[0]] = ids[1];
          }
        }
      }
    }
    return overrides;
  }

  /**
   * Convert a node to its text representation.
   */
  private nodeToText(node: VeribleNode): string {
    const parts: string[] = [];
    for (const child of node.children) {
      if (isToken(child)) {
        parts.push(child.text);
      } else if (isNode(child)) {
        parts.push(this.nodeToText(child));
      }
    }
    return parts.join(' ').trim();
  }
}

// ============================================================================
// Export
// ============================================================================

/**
 * Create a new CST mapper instance.
 */
export function createCSTMapper(): CSTMapper {
  return new CSTMapper();
}
