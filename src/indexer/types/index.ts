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
  

  // Individual declaration data types
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  // Helper types
  
  
  
  
  
  
} from './declaration.js';

// ============================================================================
// Reference Types
// ============================================================================

export type {
  Reference,
  
  
  
  
  
} from './reference.js';

// ============================================================================
// Instance Types
// ============================================================================

export type {
  Instance,
  
  
} from './instance.js';

// ============================================================================
// Directive Types
// ============================================================================

export type {
  Directive,
  
  

  // Individual directive data types
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
} from './directive.js';

// ============================================================================
// Result Types
// ============================================================================

export type {
  FileUnderstanderResult,
  
  ResolvedProject,
  HierarchyNode,
  FileDependency,
  SemanticIndex,
} from './result.js';
