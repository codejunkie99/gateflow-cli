/**
 * Verible CST Types
 *
 * Type definitions for Verible's JSON CST (Concrete Syntax Tree) output.
 * These types represent the structure returned by `verible-verilog-syntax --export_json`.
 *
 * @module verible/types
 */

// ============================================================================
// Core CST Types
// ============================================================================

/**
 * A node in Verible's Concrete Syntax Tree.
 *
 * Nodes represent grammatical constructs (e.g., module declarations, port lists).
 * They contain a tag identifying the node type and an array of children.
 */
export interface VeribleNode {
  /** Node type tag (e.g., "kModuleDeclaration", "kPortDeclarationList") */
  tag: string;

  /** Child elements - can be nodes, tokens, or null */
  children: (VeribleNode | VeribleToken | null)[];
}

/**
 * A token (leaf) in Verible's Concrete Syntax Tree.
 *
 * Tokens represent actual source code elements (keywords, identifiers, operators).
 */
export interface VeribleToken {
  /** Token tag (e.g., "module", "SymbolIdentifier", ";") */
  tag: string;

  /** Token text from source */
  text: string;

  /** Starting byte offset in source file */
  start: number;

  /** Ending byte offset in source file (exclusive) */
  end: number;
}

/**
 * Type guard: Check if a CST element is a node.
 */
export function isNode(element: VeribleNode | VeribleToken | null): element is VeribleNode {
  return element !== null && 'children' in element;
}

/**
 * Type guard: Check if a CST element is a token.
 */
export function isToken(element: VeribleNode | VeribleToken | null): element is VeribleToken {
  return element !== null && 'text' in element;
}

// ============================================================================
// Parse Result Types
// ============================================================================

/**
 * Complete result from verible-verilog-syntax --export_json.
 */
export interface VeribleParseResult {
  /** The parsed file path */
  file: string;

  /** Root of the CST (null if parse failed completely) */
  tree: VeribleNode | null;

  /** Syntax errors encountered during parsing */
  errors: VeribleError[];

  /** Tokens (if requested with --printtokens) */
  tokens?: VeribleToken[];
}

/**
 * A syntax error from Verible.
 */
export interface VeribleError {
  /** Error message */
  message: string;

  /** Line number (1-based) */
  line: number;

  /** Column number (1-based) */
  column: number;

  /** Severity level */
  severity: 'error' | 'warning' | 'note';
}

// ============================================================================
// Lint Result Types
// ============================================================================

/**
 * Result from verible-verilog-lint.
 */
export interface VeribleLintResult {
  /** The linted file path */
  file: string;

  /** Lint violations found */
  violations: VeribleLintViolation[];
}

/**
 * A lint rule violation.
 */
export interface VeribleLintViolation {
  /** Rule name that was violated */
  rule: string;

  /** Violation message */
  message: string;

  /** Line number (1-based) */
  line: number;

  /** Column number (1-based) */
  column: number;

  /** Severity level */
  severity: 'error' | 'warning' | 'info';

  /** URL to rule documentation (if available) */
  url?: string;

  /** Suggested fix (if available) */
  fix?: string;
}

// ============================================================================
// Node Tag Constants
// ============================================================================

/**
 * Common node tags in Verible's CST.
 *
 * These are the most frequently used tags for SystemVerilog constructs.
 * Note: The CST structure may change between Verible versions.
 */
export const NODE_TAGS = {
  // Top-level
  DESCRIPTION_LIST: 'kDescriptionList',
  SOURCE_FILE: 'kSourceFile',

  // Design units
  MODULE_DECLARATION: 'kModuleDeclaration',
  MODULE_HEADER: 'kModuleHeader',
  MODULE_ITEM_LIST: 'kModuleItemList',
  PACKAGE_DECLARATION: 'kPackageDeclaration',
  INTERFACE_DECLARATION: 'kInterfaceDeclaration',
  CLASS_DECLARATION: 'kClassDeclaration',
  PROGRAM_DECLARATION: 'kProgramDeclaration',
  CHECKER_DECLARATION: 'kCheckerDeclaration',
  CONFIG_DECLARATION: 'kConfigDeclaration',

  // Ports
  PORT_DECLARATION_LIST: 'kPortDeclarationList',
  PORT_DECLARATION: 'kPortDeclaration',
  PORT_ITEM: 'kPortItem',
  PORT_REFERENCE: 'kPortReference',

  // Parameters
  PARAMETER_DECLARATION: 'kParameterDeclaration',
  LOCALPARAM_DECLARATION: 'kLocalparamDeclaration',
  PARAMETER_PORT_LIST: 'kParameterPortList',

  // Functions/Tasks
  FUNCTION_DECLARATION: 'kFunctionDeclaration',
  FUNCTION_HEADER: 'kFunctionHeader',
  TASK_DECLARATION: 'kTaskDeclaration',
  TASK_HEADER: 'kTaskHeader',

  // Types
  TYPEDEF_DECLARATION: 'kTypedefDeclaration',
  STRUCT_TYPE: 'kStructType',
  UNION_TYPE: 'kUnionType',
  ENUM_TYPE: 'kEnumType',
  ENUM_NAME: 'kEnumName',
  DATA_TYPE: 'kDataType',
  DATA_TYPE_PRIMITIVE: 'kDataTypePrimitive',

  // Signals/Variables
  NET_DECLARATION: 'kNetDeclaration',
  DATA_DECLARATION: 'kDataDeclaration',
  VARIABLE_DECLARATION: 'kVariableDeclaration',
  REG_DECLARATION: 'kRegDeclaration',

  // Instantiation
  MODULE_INSTANTIATION: 'kModuleInstantiation',
  GATE_INSTANTIATION: 'kGateInstantiation',
  INSTANTIATION_TYPE: 'kInstantiationType',
  INSTANCE_NAME: 'kInstanceName',
  NAMED_PORT_CONNECTION: 'kNamedPortConnection',
  POSITIONAL_PORT_CONNECTION: 'kPositionalPortConnection',
  PARAMETER_VALUE_ASSIGNMENT: 'kParameterValueAssignment',

  // Preprocessor
  PREPROCESS_INCLUDE: 'kPreprocessorInclude',
  PREPROCESS_DEFINE: 'kPreprocessorDefine',
  PREPROCESS_IFDEF: 'kPreprocessorIfdef',
  PREPROCESS_IFNDEF: 'kPreprocessorIfndef',
  MACRO_CALL: 'kMacroCall',

  // Interface
  MODPORT_DECLARATION: 'kModportDeclaration',
  MODPORT_ITEM: 'kModportItem',
  CLOCKING_DECLARATION: 'kClockingDeclaration',

  // Assertions
  SEQUENCE_DECLARATION: 'kSequenceDeclaration',
  PROPERTY_DECLARATION: 'kPropertyDeclaration',
  ASSERT_STATEMENT: 'kAssertStatement',
  ASSUME_STATEMENT: 'kAssumeStatement',
  COVER_STATEMENT: 'kCoverStatement',

  // Coverage
  COVERGROUP_DECLARATION: 'kCovergroupDeclaration',
  CONSTRAINT_DECLARATION: 'kConstraintDeclaration',

  // Procedural
  ALWAYS_STATEMENT: 'kAlwaysStatement',
  INITIAL_STATEMENT: 'kInitialStatement',
  FINAL_STATEMENT: 'kFinalStatement',
  GENERATE_REGION: 'kGenerateRegion',
  GENERATE_BLOCK: 'kGenerateBlock',

  // Expressions/Identifiers
  UNQUALIFIED_ID: 'kUnqualifiedId',
  QUALIFIED_ID: 'kQualifiedId',
  REFERENCE: 'kReference',
  EXPRESSION: 'kExpression',
  PAREN_GROUP: 'kParenGroup',
  BRACE_GROUP: 'kBraceGroup',
  BRACKET_GROUP: 'kBracketGroup',

  // Imports
  PACKAGE_IMPORT_ITEM: 'kPackageImportItem',
  PACKAGE_IMPORT_DECLARATION: 'kPackageImportDeclaration',

  // Class members
  CLASS_ITEM: 'kClassItem',
  CLASS_METHOD: 'kClassMethod',
  CLASS_PROPERTY: 'kClassProperty',
  CLASS_CONSTRUCTOR: 'kClassConstructor',
  EXTENDS_CLAUSE: 'kExtendsClause',
  IMPLEMENTS_CLAUSE: 'kImplementsClause',

  // Bind
  BIND_DIRECTIVE: 'kBindDirective',
} as const;

/**
 * Common token tags in Verible's CST.
 */
export const TOKEN_TAGS = {
  // Keywords
  MODULE: 'module',
  ENDMODULE: 'endmodule',
  PACKAGE: 'package',
  ENDPACKAGE: 'endpackage',
  INTERFACE: 'interface',
  ENDINTERFACE: 'endinterface',
  CLASS: 'class',
  ENDCLASS: 'endclass',
  FUNCTION: 'function',
  ENDFUNCTION: 'endfunction',
  TASK: 'task',
  ENDTASK: 'endtask',
  PROGRAM: 'program',
  ENDPROGRAM: 'endprogram',
  CHECKER: 'checker',
  ENDCHECKER: 'endchecker',
  CONFIG: 'config',
  ENDCONFIG: 'endconfig',

  // Port directions
  INPUT: 'input',
  OUTPUT: 'output',
  INOUT: 'inout',
  REF: 'ref',

  // Types
  TYPEDEF: 'typedef',
  STRUCT: 'struct',
  UNION: 'union',
  ENUM: 'enum',
  LOGIC: 'logic',
  REG: 'reg',
  WIRE: 'wire',
  INT: 'int',
  INTEGER: 'integer',
  REAL: 'real',
  BYTE: 'byte',
  SHORTINT: 'shortint',
  LONGINT: 'longint',

  // Parameters
  PARAMETER: 'parameter',
  LOCALPARAM: 'localparam',

  // Modifiers
  STATIC: 'static',
  AUTOMATIC: 'automatic',
  VIRTUAL: 'virtual',
  PURE: 'pure',
  EXTERN: 'extern',
  CONST: 'const',

  // Identifiers
  SYMBOL_IDENTIFIER: 'SymbolIdentifier',
  ESCAPED_IDENTIFIER: 'EscapedIdentifier',
  SYSTEM_TF_IDENTIFIER: 'SystemTFIdentifier',
  MACRO_IDENTIFIER: 'MacroIdentifier',

  // Operators and punctuation
  SEMICOLON: ';',
  COMMA: ',',
  DOT: '.',
  COLON: ':',
  DOUBLE_COLON: '::',
  HASH: '#',
  AT: '@',
  LPAREN: '(',
  RPAREN: ')',
  LBRACKET: '[',
  RBRACKET: ']',
  LBRACE: '{',
  RBRACE: '}',
  ASSIGN: '=',
  WILDCARD: '*',

  // Literals
  NUMBER: 'TK_DecNumber',
  BIN_NUMBER: 'TK_BinNumber',
  OCT_NUMBER: 'TK_OctNumber',
  HEX_NUMBER: 'TK_HexNumber',
  REAL_NUMBER: 'TK_RealNumber',
  STRING: 'TK_StringLiteral',

  // Preprocessor
  PP_DEFINE: '`define',
  PP_INCLUDE: '`include',
  PP_IFDEF: '`ifdef',
  PP_IFNDEF: '`ifndef',
  PP_ELSE: '`else',
  PP_ELSIF: '`elsif',
  PP_ENDIF: '`endif',
  PP_UNDEF: '`undef',
  PP_TIMESCALE: '`timescale',
} as const;
