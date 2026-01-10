/**
 * Slang AST JSON Types
 *
 * TypeScript type definitions for slang's `--ast-json` output.
 * Based on slang v9.1 (https://github.com/MikePopoloski/slang)
 *
 * These types represent the compiled/elaborated AST that slang produces,
 * which includes fully resolved symbols, evaluated parameters, and
 * expanded macros.
 *
 * @module slang/slang-types
 */

// ============================================================================
// Core AST Types
// ============================================================================

/**
 * Root of slang's AST JSON output.
 */
export interface SlangCompilation {
  /** Top-level design elements */
  design?: SlangDesignRoot;

  /** Compilation diagnostics (errors, warnings) */
  diagnostics?: SlangDiagnostic[];

  /** Metadata about the compilation */
  meta?: {
    slangVersion?: string;
    compilationTime?: number;
  };
}

/**
 * Design root containing all top-level symbols.
 */
export interface SlangDesignRoot {
  kind: 'Root';
  name: '$root';
  members: SlangSymbol[];
}

/**
 * Base interface for all slang symbols.
 */
export interface SlangSymbolBase {
  /** Symbol kind (Module, Package, Class, etc.) */
  kind: string;

  /** Symbol name */
  name: string;

  /** Source location (with --ast-json-source-info) */
  location?: SlangLocation;

  /** Child members */
  members?: SlangSymbol[];
}

/**
 * Source location information.
 */
export interface SlangLocation {
  /** Source file path */
  file: string;

  /** Line number (1-indexed) */
  line: number;

  /** Column number (1-indexed) */
  column: number;

  /** End line (if available) */
  endLine?: number;

  /** End column (if available) */
  endColumn?: number;
}

// ============================================================================
// Symbol Types
// ============================================================================

/**
 * Discriminated union of all slang symbol types.
 */
export type SlangSymbol =
  | SlangModuleSymbol
  | SlangPackageSymbol
  | SlangInterfaceSymbol
  | SlangClassSymbol
  | SlangProgramSymbol
  | SlangInstanceSymbol
  | SlangPortSymbol
  | SlangParameterSymbol
  | SlangVariableSymbol
  | SlangNetSymbol
  | SlangFunctionSymbol
  | SlangTaskSymbol
  | SlangTypeAliasSymbol
  | SlangEnumSymbol
  | SlangStructSymbol
  | SlangGenericSymbol;

/**
 * Module definition (unelaborated template).
 */
export interface SlangModuleSymbol extends SlangSymbolBase {
  kind: 'Definition';
  definitionKind: 'Module';
  ports?: SlangPortSymbol[];
  parameters?: SlangParameterSymbol[];
}

/**
 * Package symbol.
 */
export interface SlangPackageSymbol extends SlangSymbolBase {
  kind: 'Package';
}

/**
 * Interface symbol.
 */
export interface SlangInterfaceSymbol extends SlangSymbolBase {
  kind: 'Definition';
  definitionKind: 'Interface';
  ports?: SlangPortSymbol[];
  parameters?: SlangParameterSymbol[];
}

/**
 * Class symbol.
 */
export interface SlangClassSymbol extends SlangSymbolBase {
  kind: 'ClassType';
  baseClass?: string;
  isVirtual?: boolean;
  isAbstract?: boolean;
}

/**
 * Program symbol.
 */
export interface SlangProgramSymbol extends SlangSymbolBase {
  kind: 'Definition';
  definitionKind: 'Program';
}

/**
 * Elaborated module/interface instance.
 * This is the key type - it contains resolved, evaluated information.
 */
export interface SlangInstanceSymbol extends SlangSymbolBase {
  kind: 'Instance';

  /** Name of the definition being instantiated */
  definitionName: string;

  /** Hierarchical path to this instance */
  hierarchicalPath?: string;

  /** Evaluated parameter values */
  parameters?: SlangParameterValue[];

  /** Port connections */
  connections?: SlangConnection[];

  /** Instance body with resolved members */
  body?: {
    members: SlangSymbol[];
  };
}

/**
 * Port symbol.
 */
export interface SlangPortSymbol extends SlangSymbolBase {
  kind: 'Port';

  /** Port direction */
  direction: 'In' | 'Out' | 'InOut' | 'Ref';

  /** Port data type (evaluated) */
  type: string;

  /** Resolved type details (with --ast-json-detailed-types) */
  typeInfo?: SlangTypeInfo;
}

/**
 * Parameter symbol.
 */
export interface SlangParameterSymbol extends SlangSymbolBase {
  kind: 'Parameter' | 'TypeParameter';

  /** Parameter data type */
  type: string;

  /** Default value expression */
  defaultValue?: string;

  /** Is this a localparam? */
  isLocal?: boolean;
}

/**
 * Evaluated parameter value (in an instance).
 */
export interface SlangParameterValue {
  /** Parameter name */
  name: string;

  /** Evaluated value as string */
  value: string;

  /** Original expression (before evaluation) */
  originalExpr?: string;
}

/**
 * Variable symbol (reg, logic, etc.).
 */
export interface SlangVariableSymbol extends SlangSymbolBase {
  kind: 'Variable';

  /** Variable data type (evaluated) */
  type: string;

  /** Resolved type info */
  typeInfo?: SlangTypeInfo;

  /** Initial value (if any) */
  initializer?: string;
}

/**
 * Net symbol (wire).
 */
export interface SlangNetSymbol extends SlangSymbolBase {
  kind: 'Net';

  /** Net type (wire, tri, etc.) */
  netType: string;

  /** Data type */
  type: string;
}

/**
 * Function symbol.
 */
export interface SlangFunctionSymbol extends SlangSymbolBase {
  kind: 'Subroutine';
  subroutineKind: 'Function';

  /** Return type */
  returnType: string;

  /** Arguments */
  arguments?: SlangArgumentSymbol[];
}

/**
 * Task symbol.
 */
export interface SlangTaskSymbol extends SlangSymbolBase {
  kind: 'Subroutine';
  subroutineKind: 'Task';

  /** Arguments */
  arguments?: SlangArgumentSymbol[];
}

/**
 * Function/task argument.
 */
export interface SlangArgumentSymbol extends SlangSymbolBase {
  kind: 'Argument';
  direction: 'In' | 'Out' | 'InOut' | 'Ref';
  type: string;
}

/**
 * Type alias (typedef).
 */
export interface SlangTypeAliasSymbol extends SlangSymbolBase {
  kind: 'TypeAlias';

  /** The underlying type */
  target: string;
}

/**
 * Enum type.
 */
export interface SlangEnumSymbol extends SlangSymbolBase {
  kind: 'EnumType';

  /** Base type */
  baseType?: string;

  /** Enum values */
  values?: SlangEnumValue[];
}

/**
 * Enum value.
 */
export interface SlangEnumValue {
  name: string;
  value: string;
}

/**
 * Struct type.
 */
export interface SlangStructSymbol extends SlangSymbolBase {
  kind: 'StructType' | 'UnionType';
  isPacked?: boolean;
  fields?: SlangFieldSymbol[];
}

/**
 * Struct/union field.
 */
export interface SlangFieldSymbol extends SlangSymbolBase {
  kind: 'Field';
  type: string;
}

/**
 * Generic symbol for types we haven't specifically modeled.
 */
export interface SlangGenericSymbol extends SlangSymbolBase {
  kind: string;
  [key: string]: unknown;
}

// ============================================================================
// Connection Types
// ============================================================================

/**
 * Port connection in an instance.
 */
export interface SlangConnection {
  /** Port name on the instantiated module */
  port: string;

  /** Connected expression/signal */
  expr: string;

  /** Location of the connection */
  location?: SlangLocation;

  /** Resolved signal info (if applicable) */
  resolvedTo?: {
    name: string;
    file: string;
    line: number;
  };
}

// ============================================================================
// Type Information
// ============================================================================

/**
 * Detailed type information (with --ast-json-detailed-types).
 */
export interface SlangTypeInfo {
  /** Type category */
  category: 'integral' | 'real' | 'struct' | 'enum' | 'class' | 'array' | 'string' | 'void' | 'other';

  /** Bit width (for integral types) */
  bitWidth?: number;

  /** Whether signed */
  isSigned?: boolean;

  /** Array dimensions */
  dimensions?: SlangArrayDimension[];

  /** Element type (for arrays) */
  elementType?: SlangTypeInfo;

  /** Struct fields (for struct types) */
  fields?: SlangFieldInfo[];

  /** Referenced type name */
  typeName?: string;
}

/**
 * Array dimension.
 */
export interface SlangArrayDimension {
  kind: 'fixed' | 'dynamic' | 'associative' | 'queue';
  size?: number;
  left?: number;
  right?: number;
}

/**
 * Field info for struct types.
 */
export interface SlangFieldInfo {
  name: string;
  type: SlangTypeInfo;
  offset?: number;
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Compilation diagnostic (error, warning, note).
 */
export interface SlangDiagnostic {
  /** Severity level */
  severity: 'error' | 'warning' | 'note';

  /** Diagnostic message */
  message: string;

  /** Source location */
  location?: SlangLocation;

  /** Diagnostic code (e.g., "undeclared-identifier") */
  code?: string;

  /** Related notes */
  notes?: SlangDiagnostic[];
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from running slang.
 */
export interface SlangParseResult {
  /** Whether parsing succeeded */
  success: boolean;

  /** Parsed compilation (if successful) */
  compilation?: SlangCompilation;

  /** Diagnostics (errors, warnings) */
  diagnostics: SlangDiagnostic[];

  /** Raw JSON output (for debugging) */
  rawJson?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a symbol is a module definition.
 */
export function isModuleDefinition(symbol: SlangSymbol): symbol is SlangModuleSymbol {
  return symbol.kind === 'Definition' && (symbol as SlangModuleSymbol).definitionKind === 'Module';
}

/**
 * Check if a symbol is an interface definition.
 */
export function isInterfaceDefinition(symbol: SlangSymbol): symbol is SlangInterfaceSymbol {
  return symbol.kind === 'Definition' && (symbol as SlangInterfaceSymbol).definitionKind === 'Interface';
}

/**
 * Check if a symbol is an instance.
 */
export function isInstance(symbol: SlangSymbol): symbol is SlangInstanceSymbol {
  return symbol.kind === 'Instance';
}

/**
 * Check if a symbol is a package.
 */
export function isPackage(symbol: SlangSymbol): symbol is SlangPackageSymbol {
  return symbol.kind === 'Package';
}

/**
 * Check if a symbol is a class.
 */
export function isClass(symbol: SlangSymbol): symbol is SlangClassSymbol {
  return symbol.kind === 'ClassType';
}

/**
 * Check if a symbol is a function.
 */
export function isFunction(symbol: SlangSymbol): symbol is SlangFunctionSymbol {
  return symbol.kind === 'Subroutine' && (symbol as SlangFunctionSymbol).subroutineKind === 'Function';
}

/**
 * Check if a symbol is a task.
 */
export function isTask(symbol: SlangSymbol): symbol is SlangTaskSymbol {
  return symbol.kind === 'Subroutine' && (symbol as SlangTaskSymbol).subroutineKind === 'Task';
}

/**
 * Check if a symbol is a port.
 */
export function isPort(symbol: SlangSymbol): symbol is SlangPortSymbol {
  return symbol.kind === 'Port';
}

/**
 * Check if a symbol is a parameter.
 */
export function isParameter(symbol: SlangSymbol): symbol is SlangParameterSymbol {
  return symbol.kind === 'Parameter' || symbol.kind === 'TypeParameter';
}

/**
 * Check if a symbol is a variable.
 */
export function isVariable(symbol: SlangSymbol): symbol is SlangVariableSymbol {
  return symbol.kind === 'Variable';
}

/**
 * Check if a symbol is a net.
 */
export function isNet(symbol: SlangSymbol): symbol is SlangNetSymbol {
  return symbol.kind === 'Net';
}

/**
 * Check if a symbol is a type alias.
 */
export function isTypeAlias(symbol: SlangSymbol): symbol is SlangTypeAliasSymbol {
  return symbol.kind === 'TypeAlias';
}

/**
 * Check if a symbol is an enum.
 */
export function isEnum(symbol: SlangSymbol): symbol is SlangEnumSymbol {
  return symbol.kind === 'EnumType';
}

/**
 * Check if a symbol is a struct or union.
 */
export function isStructOrUnion(symbol: SlangSymbol): symbol is SlangStructSymbol {
  return symbol.kind === 'StructType' || symbol.kind === 'UnionType';
}
