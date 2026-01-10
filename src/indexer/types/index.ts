/**
 * Types Module - Central Export for All Type Definitions
 *
 * This module re-exports all type definitions used by the SV Indexer.
 * Import from here to get any type you need:
 *
 * ```typescript
 * import type {
 *   Location,
 *   Declaration,
 *   Reference,
 *   Instance,
 *   Directive,
 *   FileRecord,
 *   FileUnderstanderResult
 * } from './types/index.js';
 * ```
 *
 * @module types
 */

// ============================================================================
// Location Types
// ============================================================================

export type {
  // Core location types
  Location,
  Guard,
  ParseError,
  LineOffsets,
} from './location.js';

// ============================================================================
// File Types
// ============================================================================

export type {
  FileRecord,
  FileReadResult,
} from './file.js';

// ============================================================================
// Declaration Types
// ============================================================================

export type {
  // Main declaration type
  Declaration,
  DeclarationKind,
  DeclarationData,

  // Individual declaration data types
  ModuleData,
  PackageData,
  InterfaceData,
  ClassData,
  ProgramData,
  ConfigData,
  FunctionData,
  TaskData,
  TypedefData,
  StructData,
  UnionData,
  EnumData,
  EnumValueData,
  PortData,
  ParameterData,
  LocalparamData,
  SignalData,
  ModportData,
  SequenceData,
  PropertyData,
  CovergroupData,
  ConstraintData,
  ClockingData,
  CheckerData,
  GenerateBlockData,
  AlwaysBlockData,
  InitialBlockData,

  // Helper types
  ParamInfo,
  ArgInfo,
  FieldInfo,
  ModportPort,
  ClockingSignal,
  ConfigCellUse,
} from './declaration.js';

// ============================================================================
// Reference Types
// ============================================================================

export type {
  Reference,
  ReferenceKind,
  ReferenceData,
  ImportReferenceData,
  PortConnReferenceData,
  ExtendsReferenceData,
} from './reference.js';

// ============================================================================
// Instance Types
// ============================================================================

export type {
  Instance,
  InstanceKind,
  PortConnection,
} from './instance.js';

// ============================================================================
// Directive Types
// ============================================================================

export type {
  Directive,
  DirectiveKind,
  DirectiveData,

  // Individual directive data types
  DefineData,
  UndefData,
  IncludeData,
  IfdefData,
  IfndefData,
  ElsifData,
  ElseData,
  EndifData,
  TimescaleData,
  DefaultNettypeData,
  PragmaData,
  ResetallData,
  DpiImportData,
  DpiExportData,
  LineData,
} from './directive.js';

// ============================================================================
// Result Types
// ============================================================================

export type {
  FileUnderstanderResult,
  ParseStats,
  ResolvedProject,
  HierarchyNode,
  FileDependency,
  SemanticIndex,
} from './result.js';
