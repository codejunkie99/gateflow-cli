# SV-Only Architecture Implementation Plan (Detailed)

## Executive Summary

Implement a comprehensive 4-layer SystemVerilog indexing architecture for GateFlow CLI that provides recipe-aware compilation, macro truth resolution, and intelligent code navigation. This plan covers all 6 phases with file-based truth cache persistence.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [SystemVerilog Semantics Deep Dive](#2-systemverilog-semantics-deep-dive)
3. [File Structure](#3-file-structure)
4. [Layer 0: File Registry](#4-layer-0-file-registry)
5. [Layer 1: Shallow Parse](#5-layer-1-shallow-parse)
6. [Layer 2: Relationship Graph](#6-layer-2-relationship-graph)
7. [Layer 3: Recipe Manager](#7-layer-3-recipe-manager)
8. [Layer 4: Truth Cache](#8-layer-4-truth-cache)
9. [Query Engine](#9-query-engine)
10. [Implementation Phases](#10-implementation-phases)
11. [Testing Strategy](#11-testing-strategy)
12. [Verification Checklist](#12-verification-checklist)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Query Engine                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Symbol Find │  │ Graph       │  │ Truth-Aware Queries     │  │
│  │             │  │ Expansion   │  │ (conditional labeling)  │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 4: Truth Cache                          │
│  ┌───────────────────┐  ┌─────────────────────────────────────┐ │
│  │ MacroBindingSnap  │  │ GuardTruthSpan (active/inactive)    │ │
│  │ (per CU+position) │  │ (per recipe+file+guard)             │ │
│  └───────────────────┘  └─────────────────────────────────────┘ │
│  Persisted to: .gateflow/truth-cache/{recipe_hash}.json         │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 3: Recipe Manager                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Filelist    │  │ Compilation │  │ Include Resolution      │  │
│  │ Parser      │  │ Plan        │  │ (per CU + search order) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  Recipes: sim.f, synth.f, lint.f → CompilationUnits              │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                Layer 2: Relationship Graph                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ file_symbol │  │instantiation│  │ import, include,        │  │
│  │ edges       │  │ edges       │  │ macro_def, macro_use    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  Graph queries: dependencies, dependents, related files          │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 1: Shallow Parse                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ SymbolFact  │  │ MacroDef    │  │ MacroGuard              │  │
│  │ InstanceFact│  │ MacroUse    │  │ (ifdef spans + nesting) │  │
│  │ ImportFact  │  │             │  │                         │  │
│  │ IncludeFact │  │             │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  MacroCatalog: global discovery (NOT truth)                      │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Layer 0: File Registry                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ FileRecord: id, path, contentHash, lastSeen, lineIndex      ││
│  │ LineIndex: byte offsets per line for fast slicing           ││
│  └─────────────────────────────────────────────────────────────┘│
│  Watches: chokidar for incremental updates                       │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Source Files                                │
│  *.sv, *.svh, *.v, *.vh + *.f filelists                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. SystemVerilog Semantics Deep Dive

### 2.1 Compilation Units and $unit Scope

**Key concept**: A compilation unit is a collection of source files compiled together as a group. Each compilation unit has its own `$unit` scope.

**From IEEE 1800-2017**:
- `$unit` scope is NOT global - it only exists for files compiled at the same time
- With single compilation unit: no difference between `$unit` and `$root`
- With multiple compilation units: `$unit` represents the top level of EACH unit

**Search/Resolution Order for Identifiers**:
1. Local declarations (IEEE 1364 rules)
2. Packages with wildcard imports in current scope
3. Compilation-unit scope (`$unit`)
4. Design hierarchy (IEEE 1364 search rules)

**Best Practice**: Use packages instead of `$unit` for sharing declarations (more portable).

**Our Implementation**: Default to single compilation unit per recipe (matches `-mfcu` mode in most tools). Support configurable per-file units for advanced cases.

### 2.2 Macro `define Semantics

**Basic syntax**:
```systemverilog
`define MACRO_NAME replacement_text
`define MACRO_WITH_ARGS(arg1, arg2) text using arg1 and arg2
`define MACRO_DEFAULTS(name="default", value=0) ...
```

**Multiline macros**: Use backslash `\` at end of line (NO trailing spaces!)
```systemverilog
`define LONG_MACRO(a, b) \
    line1; \
    line2; \
    line3
```

**Concatenation operator** (`` ` ` ``): Joins tokens without whitespace
```systemverilog
`define CONCAT(prefix, suffix) prefix``suffix
// `CONCAT(sig, _reg) → sig_reg
```

**String interpolation** (`` `" ``): Enable substitution inside strings
```systemverilog
`define SHOW(val) $display(`"Value is %0d`", val)
// Arguments substituted inside the string
```

**Expansion order**: Outer macros expand first, then inner macros.

**Scope**: Macros persist from `define until `undef or end of compilation unit.

### 2.3 Preprocessor Guards (`ifdef/`ifndef/`elsif/`else/`endif)

**Syntax**:
```systemverilog
`ifdef FEATURE_A
    // Code when FEATURE_A is defined
`elsif FEATURE_B
    // Code when FEATURE_A undefined but FEATURE_B defined
`else
    // Code when neither defined
`endif
```

**Nesting**: Guards can be arbitrarily nested. Our parser must track a stack.

**Truth determination**: Depends on:
1. Recipe defines (`+define+NAME`)
2. File-order defines (earlier files' `define` statements)
3. `undef` statements

### 2.4 Include Resolution

**Syntax**:
```systemverilog
`include "relative/path.svh"
`include "just_filename.svh"
```

**Search order** (typical):
1. Directory of the including file
2. Directories specified with `+incdir+` (in order)
3. Current working directory
4. System directories

**Our implementation**: Per-recipe, per-compilation-unit include resolution with:
- `searchOrder[]` - ordered list of directories checked
- `candidates[]` - all matching files found
- `chosen` - the resolved file (first match wins)
- `status` - resolved | ambiguous | not_found

---

## 3. File Structure

```
src/indexer/
├── index.ts                      # Backward-compat wrapper (MODIFY)
├── parser.ts                     # Extend with LineRange (MODIFY)
│
├── layer0/
│   ├── index.ts                  # Export all Layer 0
│   ├── types.ts                  # FileRecord, LineIndex, FileId
│   └── FileRegistry.ts           # File identity, hashing, line offsets
│
├── layer1/
│   ├── index.ts                  # Export all Layer 1
│   ├── types.ts                  # All fact types (Symbol, Instance, Import, etc.)
│   ├── schemas.ts                # Zod validation schemas
│   ├── ShallowParser.ts          # Extends SVParser for macro-aware parsing
│   ├── FactExtractor.ts          # Produces ShallowParseResult from parse
│   └── MacroCatalog.ts           # Global macro discovery index
│
├── layer2/
│   ├── index.ts                  # Export all Layer 2
│   ├── types.ts                  # GraphEdge, GraphNode types
│   ├── RelationshipGraph.ts      # Build and query the graph
│   └── GraphQueries.ts           # Traversal: BFS, DFS, cycle detection
│
├── layer3/
│   ├── index.ts                  # Export all Layer 3
│   ├── types.ts                  # Recipe, CompilationUnit, CompilationPlan
│   ├── schemas.ts                # Zod schemas for recipe types
│   ├── FilelistParser.ts         # Parse .f files (full syntax support)
│   ├── RecipeManager.ts          # Manage multiple recipes
│   ├── IncludeResolver.ts        # Per-CU include resolution
│   └── RecipeView.ts             # Active file set computation
│
├── layer4/
│   ├── index.ts                  # Export all Layer 4
│   ├── types.ts                  # TruthCache, MacroBindingSnapshot
│   ├── TruthCache.ts             # File-based persistent cache
│   ├── MacroEvaluator.ts         # Compute macro bindings per CU
│   └── GuardResolver.ts          # Determine guard truth spans
│
├── query/
│   ├── index.ts                  # Export query engine
│   ├── types.ts                  # QueryOptions, QueryResult
│   ├── QueryEngine.ts            # Unified query interface
│   └── GraphExpander.ts          # Related file discovery
│
├── persistence/
│   ├── index.ts
│   └── CacheManager.ts           # .gateflow/ directory management
│
└── SVIndex.ts                    # New unified index (composes all layers)
```

---

## 4. Layer 0: File Registry

### Purpose
Track all source files with identity, content hashing, and line-level byte indexing for fast range extraction.

### Types

```typescript
// src/indexer/layer0/types.ts

export interface FileId {
  /** Unique hash-based ID (SHA-256 of normalized path) */
  id: string;
  /** Absolute normalized path */
  path: string;
}

export interface LineIndex {
  /** Byte offset for start of each line (0-indexed array, 1-indexed lines) */
  lineOffsets: number[];
  /** Total byte count of file */
  totalBytes: number;
  /** Detected line ending style */
  lineEnding: 'lf' | 'crlf' | 'mixed';
  /** Number of lines */
  lineCount: number;
}

export interface FileRecord {
  fileId: FileId;
  /** SHA-256 of file content */
  contentHash: string;
  /** Unix timestamp when last seen by indexer */
  lastSeenTime: number;
  /** File mtime from filesystem */
  lastModifiedTime: number;
  /** Line byte offsets for fast slicing */
  lineIndex: LineIndex;
  /** Detected encoding */
  encoding: 'utf-8' | 'utf-16' | 'ascii' | 'unknown';
  /** File size in bytes */
  sizeBytes: number;
}

export interface FileRegistryStats {
  totalFiles: number;
  totalBytes: number;
  lastScanTime: number;
  svFiles: number;
  svhFiles: number;
  vFiles: number;
  fFiles: number;
}
```

### FileRegistry Class

```typescript
// src/indexer/layer0/FileRegistry.ts

export class FileRegistry {
  private files: Map<string, FileRecord> = new Map();
  private pathToId: Map<string, string> = new Map();

  /** Discover all SV files in directory */
  async scan(rootPath: string, options?: ScanOptions): Promise<FileRecord[]>;

  /** Get file record by path */
  getByPath(path: string): FileRecord | undefined;

  /** Get file record by ID */
  getById(id: string): FileRecord | undefined;

  /** Check if file changed (compare hash) */
  hasChanged(path: string): Promise<boolean>;

  /** Update single file record */
  async updateFile(path: string): Promise<FileRecord>;

  /** Remove file from registry */
  removeFile(path: string): void;

  /** Get text range from file using line index */
  getTextRange(fileId: string, startLine: number, endLine: number): Promise<string>;

  /** Build line index for content */
  private buildLineIndex(content: string): LineIndex;

  /** Compute content hash */
  private hashContent(content: Buffer): string;

  /** Export for persistence */
  export(): SerializedFileRegistry;

  /** Import from persistence */
  import(data: SerializedFileRegistry): void;
}
```

### Line Index Algorithm

```typescript
function buildLineIndex(content: string): LineIndex {
  const offsets: number[] = [0]; // Line 1 starts at byte 0
  let hasCR = false;
  let hasLF = false;

  const bytes = Buffer.from(content, 'utf-8');
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0A) { // LF
      hasLF = true;
      offsets.push(i + 1); // Next line starts after LF
    } else if (bytes[i] === 0x0D) { // CR
      hasCR = true;
      if (bytes[i + 1] === 0x0A) {
        i++; // Skip LF in CRLF
        offsets.push(i + 1);
      } else {
        offsets.push(i + 1); // Classic Mac line ending
      }
    }
  }

  return {
    lineOffsets: offsets,
    totalBytes: bytes.length,
    lineEnding: hasCR && hasLF ? 'crlf' : hasLF ? 'lf' : 'mixed',
    lineCount: offsets.length
  };
}
```

---

## 5. Layer 1: Shallow Parse

### Purpose
Extract all "facts" from each file without assuming any recipe context. Tolerant parsing that continues on errors.

### Fact Types

```typescript
// src/indexer/layer1/types.ts

/** Precise source location */
export interface LineRange {
  startLine: number;   // 1-indexed
  startCol: number;    // 0-indexed
  endLine: number;     // 1-indexed
  endCol: number;      // 0-indexed
}

/** Symbol kinds in SystemVerilog */
export type SymbolKind =
  | 'module' | 'interface' | 'package' | 'class'
  | 'program' | 'function' | 'task'
  | 'typedef' | 'enum' | 'struct' | 'union'
  | 'modport' | 'clocking';

/** Unique symbol identifier */
export interface SymbolId {
  fileId: string;
  name: string;
  kind: SymbolKind;
  /** For nested symbols (class method, interface modport) */
  parentId?: string;
  /** Qualified name for lookup (pkg::name, class::method) */
  qualifiedName: string;
}

/** Symbol definition fact */
export interface SymbolFact {
  id: SymbolId;
  name: string;
  kind: SymbolKind;
  range: LineRange;
  /** Container symbol for nested definitions */
  containerId?: string;
  /** Parameters for parameterized types */
  parameters?: ParameterFact[];
  /** Ports for modules/interfaces */
  ports?: PortFact[];
  /** Exports for packages */
  exports?: string[];
  /** Modports for interfaces */
  modports?: string[];
  /** Is this virtual (virtual class, pure virtual function)? */
  isVirtual?: boolean;
  /** Visibility for class members */
  visibility?: 'local' | 'protected' | 'public';
}

export interface ParameterFact {
  name: string;
  paramKind: 'parameter' | 'localparam' | 'type';
  type?: string;
  defaultValue?: string;
  range: LineRange;
}

export interface PortFact {
  name: string;
  direction: 'input' | 'output' | 'inout' | 'ref';
  type: string;
  width?: string;
  isInterface?: boolean;
  interfaceType?: string;
  modport?: string;
  range: LineRange;
}

/** Module/interface instantiation fact */
export interface InstanceFact {
  /** ID of the symbol containing this instantiation */
  parentSymbolId: string;
  /** Name of the instantiated module/interface (as written, unresolved) */
  childRefName: string;
  /** Instance name (e.g., u_child) */
  instanceName: string;
  range: LineRange;
  /** Raw parameter overrides text */
  paramOverridesRaw?: string;
  /** Raw port connections text */
  portConnectionsRaw?: string;
  /** Array bounds if array of instances [N:M] or [N] */
  arrayBounds?: string;
  /** Is this a generated instance (inside generate block)? */
  isGenerated?: boolean;
}

/** Import statement fact */
export interface ImportFact {
  /** Scope where import appears (null = file-level/$unit) */
  scopeSymbolId: string | null;
  /** Package being imported */
  importedPkgName: string;
  /** Specific member or '*' for wildcard */
  importedMemberName: string;
  range: LineRange;
  fileId: string;
}

/** Include directive fact */
export interface IncludeFact {
  id: string;
  /** File containing the include */
  includingFileId: string;
  /** Scope where include appears (null = file-level) */
  includingScopeSymbolId: string | null;
  /** Raw include argument as written (e.g., "defs.svh") */
  includeArgRaw: string;
  range: LineRange;
}

/** Macro definition/undef record */
export interface MacroDefRecord {
  id: string;
  macroName: string;
  op: 'define' | 'undef';
  /** Arguments for function-like macros */
  args?: MacroArg[];
  /** Raw replacement text (multiline preserved) */
  replacementTokensRaw?: string;
  /** Is this a multiline macro (uses backslash)? */
  isMultiline: boolean;
  range: LineRange;
  fileId: string;
}

export interface MacroArg {
  name: string;
  defaultValue?: string;
}

/** Preprocessor guard record */
export interface MacroGuardRecord {
  id: string;
  fileId: string;
  guardType: 'ifdef' | 'ifndef';
  macroName: string;
  /** Lines covered by the 'then' branch (after ifdef/ifndef, before elsif/else/endif) */
  thenSpan: LineRange;
  /** elsif branches (in order) */
  elsifSpans: Array<{ macroName: string; span: LineRange }>;
  /** else branch span (optional) */
  elseSpan?: LineRange;
  /** Line of closing endif */
  endifLine: number;
  /** Parent guard ID for nested guards */
  parentGuardId?: string;
  /** Nesting depth (0 = top-level) */
  nestingDepth: number;
}

/** Macro usage record (backtick reference) */
export interface MacroUseRecord {
  id: string;
  macroName: string;
  /** Scope where used (null = file-level) */
  scopeSymbolId: string | null;
  /** Arguments if function-like usage */
  argsRaw?: string;
  range: LineRange;
  fileId: string;
  /** Is this inside a guarded region? */
  withinGuardId?: string;
}

/** Generic name reference (unresolved) */
export interface NameRefFact {
  id: string;
  /** Text as written */
  refText: string;
  /** Hint about what this might be */
  kindHint: 'type' | 'module' | 'package' | 'member' | 'signal' | 'unknown';
  /** Context scope */
  scopeSymbolId: string | null;
  range: LineRange;
  fileId: string;
}

/** Search document for text search */
export interface SearchDoc {
  fileId: string;
  /** All identifier tokens for fuzzy search */
  identifierTokens: string[];
  /** Comment text for search */
  commentTokens: string[];
  /** String literals */
  stringLiterals: string[];
}

/** Parse error (tolerant parsing continues) */
export interface ParseError {
  message: string;
  range: LineRange;
  severity: 'error' | 'warning' | 'info';
  code?: string;
}

/** Complete shallow parse result for one file */
export interface ShallowParseResult {
  fileId: string;
  parseTimeMs: number;
  contentHash: string;
  symbols: SymbolFact[];
  instances: InstanceFact[];
  imports: ImportFact[];
  includes: IncludeFact[];
  macroDefs: MacroDefRecord[];
  macroGuards: MacroGuardRecord[];
  macroUses: MacroUseRecord[];
  nameRefs: NameRefFact[];
  searchDoc: SearchDoc;
  parseErrors: ParseError[];
}
```

### Macro Catalog

```typescript
// src/indexer/layer1/MacroCatalog.ts

export interface MacroCatalogEntry {
  macroName: string;
  /** All definition records across all files */
  defRecords: MacroDefRecord[];
  /** All guard records that test this macro */
  guardRecords: MacroGuardRecord[];
  /** All usage records */
  useRecords: MacroUseRecord[];
}

export class MacroCatalog {
  private entries: Map<string, MacroCatalogEntry> = new Map();
  private fileToMacros: Map<string, Set<string>> = new Map();
  private macroToDefiningFiles: Map<string, Set<string>> = new Map();

  /** Add parse result to catalog */
  addParseResult(result: ShallowParseResult): void;

  /** Remove file from catalog */
  removeFile(fileId: string): void;

  /** Get all info for a macro */
  getMacro(name: string): MacroCatalogEntry | undefined;

  /** Find macros by prefix (for autocomplete) */
  findByPrefix(prefix: string): string[];

  /** Get all macros defined in a file */
  getMacrosInFile(fileId: string): string[];

  /** Get all files that define a macro */
  getFilesDefiningMacro(name: string): string[];

  /** Get all files that use a macro */
  getFilesUsingMacro(name: string): string[];

  /** Check if macro is ever defined */
  isDefined(name: string): boolean;

  /** Export for persistence */
  export(): object;
}
```

### ShallowParser Implementation

The ShallowParser extends the existing SVParser with:

1. **LineRange tracking**: All matches include start/end line and column
2. **Macro directive patterns**: `define, `undef, `ifdef, `ifndef, `elsif, `else, `endif
3. **Guard span tracking**: Stack-based tracking of nested guards
4. **Macro use detection**: All backtick usages

```typescript
// Key regex patterns to add
const MACRO_PATTERNS = {
  // `define NAME or `define NAME(args) replacement
  define: /^[ \t]*`define\s+(\w+)(?:\(([^)]*)\))?\s*(.*?)(?:\\[ \t]*$)?/gm,

  // `undef NAME
  undef: /^[ \t]*`undef\s+(\w+)/gm,

  // `ifdef NAME or `ifndef NAME
  ifdef: /^[ \t]*`(ifdef|ifndef)\s+(\w+)/gm,

  // `elsif NAME
  elsif: /^[ \t]*`elsif\s+(\w+)/gm,

  // `else
  else: /^[ \t]*`else\b/gm,

  // `endif
  endif: /^[ \t]*`endif\b/gm,

  // `NAME or `NAME(args)
  macroUse: /`(\w+)(?:\(([^)]*)\))?/g,

  // Multiline continuation (backslash at end)
  continuation: /\\[ \t]*$/gm,
};
```

---

## 6. Layer 2: Relationship Graph

### Purpose
Build a queryable graph of relationships between files, symbols, and macros.

### Edge Types

```typescript
// src/indexer/layer2/types.ts

export type EdgeKind =
  | 'file_defines_symbol'    // File → Symbol
  | 'symbol_in_file'         // Symbol → File
  | 'instantiates'           // Symbol → Symbol (module instantiation)
  | 'imports_package'        // Scope → Package
  | 'imports_member'         // Scope → Package member
  | 'includes'               // File → File (via include)
  | 'defines_macro'          // File → Macro
  | 'uses_macro'             // Symbol/File → Macro
  | 'guarded_by'             // Code span → Macro guard
  | 'type_reference';        // Symbol → Type

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  sourceId: string;
  targetId: string;
  /** Additional edge metadata */
  metadata?: {
    instanceName?: string;      // For instantiation
    importMember?: string;      // For imports
    includeArg?: string;        // For includes
    guardType?: 'ifdef' | 'ifndef';
  };
  /** Source location */
  sourceRange?: LineRange;
  /** Is this edge resolved to a concrete target? */
  resolved: boolean;
  /** Unresolved target name (for unresolved edges) */
  unresolvedTarget?: string;
}

export interface GraphNode {
  id: string;
  kind: 'file' | 'symbol' | 'macro';
  name: string;
  fileId?: string;
  symbolKind?: SymbolKind;
}
```

### RelationshipGraph Class

```typescript
export class RelationshipGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private outgoing: Map<string, Set<string>> = new Map(); // nodeId → edgeIds
  private incoming: Map<string, Set<string>> = new Map(); // nodeId → edgeIds
  private edgesByKind: Map<EdgeKind, Set<string>> = new Map();

  /** Build graph from Layer 1 facts */
  buildFromFacts(
    files: FileRecord[],
    parseResults: Map<string, ShallowParseResult>,
    catalog: MacroCatalog
  ): void;

  /** Add a node */
  addNode(node: GraphNode): void;

  /** Add an edge */
  addEdge(edge: GraphEdge): void;

  /** Get all edges from a node */
  getOutgoingEdges(nodeId: string, kind?: EdgeKind): GraphEdge[];

  /** Get all edges to a node */
  getIncomingEdges(nodeId: string, kind?: EdgeKind): GraphEdge[];

  /** Find all nodes reachable from source (BFS) */
  getReachable(sourceId: string, edgeKinds?: EdgeKind[], maxDepth?: number): GraphNode[];

  /** Find all nodes that can reach target (reverse BFS) */
  getAncestors(targetId: string, edgeKinds?: EdgeKind[], maxDepth?: number): GraphNode[];

  /** Detect cycles in instantiation graph */
  findCycles(): string[][];

  /** Get dependency order (topological sort) */
  getCompilationOrder(rootIds: string[]): string[];

  /** Resolve an unresolved edge (match target by name) */
  resolveEdge(edgeId: string, targetId: string): void;

  /** Get related files for a query */
  getRelatedFiles(fileId: string, options?: RelatedOptions): RelatedFilesResult;
}
```

---

## 7. Layer 3: Recipe Manager

### Purpose
Parse filelists, build compilation plans, resolve includes per-recipe.

### Filelist Syntax (Full Support)

Based on research from Icarus Verilog, Verilator, and industry tools:

```
# Comments (line comment)
// Comments (C++ style)
/* Multi-line comments */

# Files (one per line)
path/to/file.sv
../relative/path.sv
/absolute/path.sv

# Include directories
+incdir+path/to/includes
+incdir+dir1+dir2+dir3     # Multiple in one line

# Defines
+define+NAME
+define+NAME=value
+define+A=1+B=2+C=3        # Multiple in one line

# Nested filelists
-f other.f                  # Paths relative to CWD
-F other.f                  # Paths relative to filelist location

# Library directories
-y lib_dir
+libdir+lib_dir

# Library file extensions
+libext+.v+.sv+.svh

# Library files
-v library.v

# Environment variables
$VAR
$(VAR)
${VAR}

# Language standard (Verilator)
+1800-2017ext+.sv
```

### Types

```typescript
// src/indexer/layer3/types.ts

/** Parsed directive from filelist */
export type FilelistDirective =
  | { type: 'file'; path: string; line: number }
  | { type: 'incdir'; paths: string[]; line: number }
  | { type: 'define'; name: string; value?: string; line: number }
  | { type: 'nested'; path: string; relative: 'cwd' | 'filelist'; line: number }
  | { type: 'libdir'; path: string; line: number }
  | { type: 'libext'; extensions: string[]; line: number }
  | { type: 'libfile'; path: string; line: number };

/** Compilation unit within a recipe */
export interface CompilationUnit {
  id: string;
  /** Recipe this unit belongs to */
  recipeId: string;
  /** Files in compilation order */
  orderedRootFiles: string[];
  /** Resolved file paths */
  resolvedFilePaths: string[];
  /** Unit kind for $unit scope handling */
  unitKind: 'single' | 'per-file' | 'library';
  /** Include directories (ordered) */
  incdirs: string[];
  /** Initial macro definitions */
  defines: Map<string, string>;
  /** Library directories */
  libdirs: string[];
  /** Library file extensions */
  libexts: string[];
}

/** Complete compilation plan from a recipe */
export interface CompilationPlan {
  recipeId: string;
  /** Source filelist path */
  sourceFile: string;
  /** Source filelist content hash */
  sourceHash: string;
  /** All compilation units */
  units: CompilationUnit[];
  /** All files in the plan (for quick lookup) */
  allFiles: Set<string>;
  /** Parse time */
  parseTimeMs: number;
  /** Last update timestamp */
  lastUpdated: number;
}

/** Include resolution result */
export interface IncludeResolution {
  /** Compilation unit context */
  compilationUnitId: string;
  /** Include fact ID */
  includeFactId: string;
  /** Include path as written */
  includePath: string;
  /** File containing the include */
  includingFileId: string;
  /** Line number of include */
  includeLine: number;
  /** Search order used */
  searchOrder: string[];
  /** All candidates found */
  candidates: string[];
  /** Chosen file (first match) */
  chosen?: string;
  /** Resolution status */
  status: 'resolved' | 'ambiguous' | 'not_found';
  /** Error message if failed */
  error?: string;
}

/** Recipe (named compilation configuration) */
export interface Recipe {
  id: string;
  name: string;
  sourceFile: string;
  plan: CompilationPlan;
  view: RecipeView;
  /** When was this recipe last loaded? */
  loadedAt: number;
}

/** View of project filtered by a recipe */
export interface RecipeView {
  recipeId: string;
  /** Set of active file IDs */
  activeFileIds: Set<string>;
  /** Map of include fact ID → resolution */
  includeResolutions: Map<string, IncludeResolution>;
  /** Map of symbol name → best candidates in this view */
  symbolIndex: Map<string, SymbolFact[]>;
  /** Map of module name → instantiating files in this view */
  instantiationIndex: Map<string, string[]>;
}
```

### FilelistParser Implementation

```typescript
export class FilelistParser {
  /** Parse a filelist file */
  async parse(
    filelistPath: string,
    options: FilelistParseOptions
  ): Promise<FilelistDirective[]> {
    return this.parseRecursive(filelistPath, options, 0, new Set());
  }

  private async parseRecursive(
    filelistPath: string,
    options: FilelistParseOptions,
    depth: number,
    visited: Set<string>
  ): Promise<FilelistDirective[]> {
    // Prevent infinite recursion
    if (depth > (options.maxDepth ?? 10)) {
      throw new Error(`Max nesting depth exceeded at ${filelistPath}`);
    }

    const normalizedPath = path.resolve(filelistPath);
    if (visited.has(normalizedPath)) {
      throw new Error(`Circular filelist reference: ${filelistPath}`);
    }
    visited.add(normalizedPath);

    const content = await fs.readFile(normalizedPath, 'utf-8');
    const lines = content.split('\n');
    const directives: FilelistDirective[] = [];
    const baseDir = path.dirname(normalizedPath);

    let inMultilineComment = false;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      let line = lines[lineNum];

      // Handle multi-line comments
      if (inMultilineComment) {
        const endIdx = line.indexOf('*/');
        if (endIdx >= 0) {
          line = line.slice(endIdx + 2);
          inMultilineComment = false;
        } else {
          continue;
        }
      }

      // Remove /* */ comments
      line = line.replace(/\/\*.*?\*\//g, '');
      const multiStart = line.indexOf('/*');
      if (multiStart >= 0) {
        line = line.slice(0, multiStart);
        inMultilineComment = true;
      }

      // Remove // and # comments
      line = line.replace(/\/\/.*$/, '').replace(/#.*$/, '');
      line = line.trim();

      if (!line) continue;

      // Environment variable substitution
      line = this.expandEnvVars(line, options.env);

      // Parse directive
      const directive = this.parseDirective(line, lineNum + 1, baseDir, options);
      if (directive) {
        if (directive.type === 'nested') {
          // Recursively parse nested filelist
          const nestedPath = directive.relative === 'filelist'
            ? path.resolve(baseDir, directive.path)
            : path.resolve(options.baseDir, directive.path);

          try {
            const nested = await this.parseRecursive(
              nestedPath,
              { ...options, baseDir: path.dirname(nestedPath) },
              depth + 1,
              visited
            );
            directives.push(...nested);
          } catch (e) {
            if (!options.ignoreMissing) throw e;
          }
        } else {
          directives.push(directive);
        }
      }
    }

    return directives;
  }

  private expandEnvVars(line: string, env?: Record<string, string>): string {
    const envSource = { ...process.env, ...env };

    // Match $VAR, $(VAR), ${VAR}
    return line.replace(/\$\{?(\w+)\}?|\$\((\w+)\)/g, (match, name1, name2) => {
      const name = name1 || name2;
      return envSource[name] ?? match;
    });
  }

  private parseDirective(
    line: string,
    lineNum: number,
    baseDir: string,
    options: FilelistParseOptions
  ): FilelistDirective | null {
    // +incdir+path+path+...
    if (line.startsWith('+incdir+')) {
      const paths = line.slice(8).split('+').filter(Boolean);
      return {
        type: 'incdir',
        paths: paths.map(p => this.resolvePath(p, baseDir)),
        line: lineNum
      };
    }

    // +define+NAME=value+NAME=value+...
    if (line.startsWith('+define+')) {
      const defs = line.slice(8).split('+').filter(Boolean);
      // Return first define, caller should handle multiple
      const first = defs[0];
      const [name, value] = first.split('=');
      return { type: 'define', name, value, line: lineNum };
    }

    // -f path (relative to CWD)
    if (line.startsWith('-f ')) {
      return {
        type: 'nested',
        path: line.slice(3).trim(),
        relative: 'cwd',
        line: lineNum
      };
    }

    // -F path (relative to filelist location)
    if (line.startsWith('-F ')) {
      return {
        type: 'nested',
        path: line.slice(3).trim(),
        relative: 'filelist',
        line: lineNum
      };
    }

    // +libdir+path
    if (line.startsWith('+libdir+')) {
      return {
        type: 'libdir',
        path: this.resolvePath(line.slice(8), baseDir),
        line: lineNum
      };
    }

    // -y path (library directory)
    if (line.startsWith('-y ')) {
      return {
        type: 'libdir',
        path: this.resolvePath(line.slice(3).trim(), baseDir),
        line: lineNum
      };
    }

    // +libext+.ext+.ext+...
    if (line.startsWith('+libext+')) {
      return {
        type: 'libext',
        extensions: line.slice(8).split('+').filter(Boolean),
        line: lineNum
      };
    }

    // -v path (library file)
    if (line.startsWith('-v ')) {
      return {
        type: 'libfile',
        path: this.resolvePath(line.slice(3).trim(), baseDir),
        line: lineNum
      };
    }

    // Ignore other flags starting with - or +
    if (line.startsWith('-') || line.startsWith('+')) {
      return null;
    }

    // Must be a file path
    return {
      type: 'file',
      path: this.resolvePath(line, baseDir),
      line: lineNum
    };
  }

  private resolvePath(p: string, baseDir: string): string {
    if (path.isAbsolute(p)) return path.normalize(p);
    return path.resolve(baseDir, p);
  }
}
```

### IncludeResolver Implementation

```typescript
export class IncludeResolver {
  constructor(
    private fileRegistry: FileRegistry
  ) {}

  /** Resolve all includes for a compilation unit */
  async resolveForUnit(
    unit: CompilationUnit,
    includes: IncludeFact[]
  ): Promise<Map<string, IncludeResolution>> {
    const resolutions = new Map<string, IncludeResolution>();

    for (const include of includes) {
      const resolution = await this.resolveInclude(include, unit);
      resolutions.set(include.id, resolution);
    }

    return resolutions;
  }

  private async resolveInclude(
    include: IncludeFact,
    unit: CompilationUnit
  ): Promise<IncludeResolution> {
    const searchOrder: string[] = [];
    const candidates: string[] = [];

    // 1. Directory of the including file
    const includingFile = this.fileRegistry.getById(include.includingFileId);
    if (includingFile) {
      const dir = path.dirname(includingFile.fileId.path);
      searchOrder.push(dir);
      const candidate = path.join(dir, include.includeArgRaw);
      if (await this.fileExists(candidate)) {
        candidates.push(candidate);
      }
    }

    // 2. Recipe include directories (in order)
    for (const incdir of unit.incdirs) {
      searchOrder.push(incdir);
      const candidate = path.join(incdir, include.includeArgRaw);
      if (await this.fileExists(candidate)) {
        candidates.push(candidate);
      }
    }

    // Determine status
    let status: IncludeResolution['status'];
    let chosen: string | undefined;

    if (candidates.length === 0) {
      status = 'not_found';
    } else if (candidates.length === 1) {
      status = 'resolved';
      chosen = candidates[0];
    } else {
      // Multiple candidates - use first but mark ambiguous
      status = 'ambiguous';
      chosen = candidates[0];
    }

    return {
      compilationUnitId: unit.id,
      includeFactId: include.id,
      includePath: include.includeArgRaw,
      includingFileId: include.includingFileId,
      includeLine: include.range.startLine,
      searchOrder,
      candidates,
      chosen,
      status
    };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## 8. Layer 4: Truth Cache

### Purpose
Compute and cache macro bindings and guard truth per recipe/compilation unit. Persisted to disk.

### Types

```typescript
// src/indexer/layer4/types.ts

/** Macro binding at a specific point in compilation */
export interface MacroBindingSnapshot {
  /** Compilation unit context */
  compilationUnitId: string;
  /** Macro name */
  macroName: string;
  /** ID of the active definition (null if undefined) */
  activeDefId: string | null;
  /** Effective value (for defined macros) */
  effectiveValue?: string;
  /** File index in compilation order where this binding is valid */
  validFromFileIndex: number;
  /** Line in file where this binding starts */
  validFromLine: number;
}

/** Truth for a guard span */
export interface GuardTruthSpan {
  compilationUnitId: string;
  fileId: string;
  guardId: string;
  /** Which branches are active */
  branches: Array<{
    branchType: 'then' | 'elsif' | 'else';
    macroName?: string;  // For then/elsif
    span: LineRange;
    isActive: boolean;
  }>;
  /** Confidence level */
  confidence: 'certain' | 'likely' | 'uncertain';
  /** Why uncertain (if applicable) */
  uncertainReason?: string;
}

/** Cached truth for a file in recipe context */
export interface TruthCacheEntry {
  recipeId: string;
  compilationUnitId: string;
  fileId: string;
  /** All macro bindings affecting this file */
  bindings: MacroBindingSnapshot[];
  /** Truth for all guards in this file */
  guardTruth: GuardTruthSpan[];
  /** Hash of all inputs (file content + recipe defines) */
  inputHash: string;
  /** Cache timestamp */
  cachedAt: number;
}

/** Full truth cache for a recipe */
export interface RecipeTruthCache {
  recipeId: string;
  recipeHash: string;
  entries: Map<string, TruthCacheEntry>;  // fileId → entry
  lastUpdated: number;
}
```

### TruthCache Class

```typescript
// src/indexer/layer4/TruthCache.ts

export class TruthCache {
  private caches: Map<string, RecipeTruthCache> = new Map();
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  /** Get or compute truth for a file in a recipe */
  async getTruth(
    recipeId: string,
    fileId: string,
    computeFn: () => Promise<TruthCacheEntry>
  ): Promise<TruthCacheEntry> {
    const cache = this.caches.get(recipeId);
    if (cache) {
      const entry = cache.entries.get(fileId);
      if (entry && await this.isValid(entry)) {
        return entry;
      }
    }

    // Compute and cache
    const entry = await computeFn();
    this.setEntry(recipeId, entry);
    return entry;
  }

  /** Set a truth entry */
  setEntry(recipeId: string, entry: TruthCacheEntry): void {
    let cache = this.caches.get(recipeId);
    if (!cache) {
      cache = {
        recipeId,
        recipeHash: '',
        entries: new Map(),
        lastUpdated: Date.now()
      };
      this.caches.set(recipeId, cache);
    }
    cache.entries.set(entry.fileId, entry);
    cache.lastUpdated = Date.now();
  }

  /** Invalidate all entries for files */
  invalidateFiles(fileIds: string[]): void {
    for (const cache of this.caches.values()) {
      for (const fileId of fileIds) {
        cache.entries.delete(fileId);
      }
    }
  }

  /** Invalidate entire recipe cache */
  invalidateRecipe(recipeId: string): void {
    this.caches.delete(recipeId);
    // Also delete from disk
    this.deleteCacheFile(recipeId);
  }

  /** Persist cache to disk */
  async persist(recipeId: string): Promise<void> {
    const cache = this.caches.get(recipeId);
    if (!cache) return;

    const filePath = this.getCacheFilePath(recipeId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const data = {
      recipeId: cache.recipeId,
      recipeHash: cache.recipeHash,
      entries: Object.fromEntries(cache.entries),
      lastUpdated: cache.lastUpdated
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /** Load cache from disk */
  async load(recipeId: string): Promise<boolean> {
    const filePath = this.getCacheFilePath(recipeId);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      this.caches.set(recipeId, {
        recipeId: data.recipeId,
        recipeHash: data.recipeHash,
        entries: new Map(Object.entries(data.entries)),
        lastUpdated: data.lastUpdated
      });
      return true;
    } catch {
      return false;
    }
  }

  private getCacheFilePath(recipeId: string): string {
    const hash = crypto.createHash('sha256').update(recipeId).digest('hex').slice(0, 16);
    return path.join(this.cacheDir, 'truth-cache', `${hash}.json`);
  }

  private async isValid(entry: TruthCacheEntry): Promise<boolean> {
    // Check if input hash still matches
    // This would recompute the hash from current file contents + recipe
    return true; // Simplified - full implementation would verify
  }

  private async deleteCacheFile(recipeId: string): Promise<void> {
    try {
      await fs.unlink(this.getCacheFilePath(recipeId));
    } catch {}
  }
}
```

### MacroEvaluator Implementation

```typescript
// src/indexer/layer4/MacroEvaluator.ts

export class MacroEvaluator {
  /** Compute macro bindings for a compilation unit */
  computeBindings(
    unit: CompilationUnit,
    catalog: MacroCatalog
  ): Map<string, MacroBindingSnapshot[]> {
    const bindingsByFile = new Map<string, MacroBindingSnapshot[]>();
    const currentBindings = new Map<string, MacroBindingSnapshot>();

    // Initialize with recipe defines
    for (const [name, value] of unit.defines) {
      currentBindings.set(name, {
        compilationUnitId: unit.id,
        macroName: name,
        activeDefId: `recipe:${name}`,
        effectiveValue: value,
        validFromFileIndex: -1,
        validFromLine: 0
      });
    }

    // Process files in compilation order
    for (let fileIndex = 0; fileIndex < unit.resolvedFilePaths.length; fileIndex++) {
      const filePath = unit.resolvedFilePaths[fileIndex];
      const fileId = this.pathToFileId(filePath);
      const fileBindings: MacroBindingSnapshot[] = [];

      // Get macro defs in this file
      const macrosInFile = catalog.getMacrosInFile(fileId) ?? [];
      const allDefs: MacroDefRecord[] = [];

      for (const macroName of macrosInFile) {
        const entry = catalog.getMacro(macroName);
        if (entry) {
          allDefs.push(...entry.defRecords.filter(d => d.fileId === fileId));
        }
      }

      // Sort by line number
      allDefs.sort((a, b) => a.range.startLine - b.range.startLine);

      for (const def of allDefs) {
        if (def.op === 'define') {
          const binding: MacroBindingSnapshot = {
            compilationUnitId: unit.id,
            macroName: def.macroName,
            activeDefId: def.id,
            effectiveValue: def.replacementTokensRaw,
            validFromFileIndex: fileIndex,
            validFromLine: def.range.startLine
          };
          currentBindings.set(def.macroName, binding);
          fileBindings.push(binding);
        } else if (def.op === 'undef') {
          const binding: MacroBindingSnapshot = {
            compilationUnitId: unit.id,
            macroName: def.macroName,
            activeDefId: null,
            validFromFileIndex: fileIndex,
            validFromLine: def.range.startLine
          };
          currentBindings.set(def.macroName, binding);
          fileBindings.push(binding);
        }
      }

      bindingsByFile.set(fileId, fileBindings);
    }

    return bindingsByFile;
  }

  /** Evaluate guard truth for a file given bindings */
  evaluateGuards(
    fileId: string,
    guards: MacroGuardRecord[],
    bindings: Map<string, MacroBindingSnapshot>,
    fileIndex: number
  ): GuardTruthSpan[] {
    return guards.map(guard => {
      const binding = bindings.get(guard.macroName);

      // Determine if macro is defined at guard position
      let isDefined = false;
      let confidence: 'certain' | 'likely' | 'uncertain' = 'certain';

      if (binding) {
        // Check if binding is valid at this point
        if (binding.validFromFileIndex < fileIndex ||
            (binding.validFromFileIndex === fileIndex &&
             binding.validFromLine < guard.thenSpan.startLine)) {
          isDefined = binding.activeDefId !== null;
        } else {
          // Binding happens after this guard
          isDefined = false;
        }
      } else {
        // No binding found - check if ever defined
        confidence = 'uncertain';
      }

      // Evaluate branch activity
      const thenActive = guard.guardType === 'ifdef' ? isDefined : !isDefined;

      const branches: GuardTruthSpan['branches'] = [{
        branchType: 'then',
        macroName: guard.macroName,
        span: guard.thenSpan,
        isActive: thenActive
      }];

      // Handle elsif branches
      let anyPreviousActive = thenActive;
      for (const elsif of guard.elsifSpans) {
        const elsifBinding = bindings.get(elsif.macroName);
        const elsifDefined = elsifBinding?.activeDefId !== null;
        const elsifActive = !anyPreviousActive && elsifDefined;

        branches.push({
          branchType: 'elsif',
          macroName: elsif.macroName,
          span: elsif.span,
          isActive: elsifActive
        });

        anyPreviousActive = anyPreviousActive || elsifActive;
      }

      // Handle else branch
      if (guard.elseSpan) {
        branches.push({
          branchType: 'else',
          span: guard.elseSpan,
          isActive: !anyPreviousActive
        });
      }

      return {
        compilationUnitId: '', // Set by caller
        fileId,
        guardId: guard.id,
        branches,
        confidence
      };
    });
  }

  private pathToFileId(filePath: string): string {
    return crypto.createHash('sha256')
      .update(path.resolve(filePath))
      .digest('hex')
      .slice(0, 16);
  }
}
```

---

## 9. Query Engine

### Purpose
Unified query interface with recipe filtering, graph expansion, and truth triggers.

```typescript
// src/indexer/query/QueryEngine.ts

export interface QueryOptions {
  /** Prefer results from this recipe */
  preferRecipeId?: string;
  /** Include results from all recipes */
  includeAllRecipes?: boolean;
  /** Expand to related files */
  expandRelated?: boolean;
  /** Depth for expansion */
  expansionDepth?: number;
  /** Trigger truth resolution */
  resolveTruth?: boolean;
  /** Max results */
  limit?: number;
}

export interface QueryResult<T> {
  results: T[];
  /** Which recipe(s) these results come from */
  recipeIds: string[];
  /** Whether truth was resolved */
  truthResolved: boolean;
  /** Execution time */
  queryTimeMs: number;
  /** Any warnings */
  warnings: string[];
}

export interface SymbolQueryResult {
  symbol: SymbolFact;
  file: FileRecord;
  /** Is this in the preferred recipe? */
  inPreferredRecipe: boolean;
  /** Guard status if applicable */
  guardStatus?: {
    isGuarded: boolean;
    isActive?: boolean;
    guardMacro?: string;
    confidence: 'certain' | 'uncertain';
  };
}

export class QueryEngine {
  constructor(
    private fileRegistry: FileRegistry,
    private graph: RelationshipGraph,
    private catalog: MacroCatalog,
    private recipeManager: RecipeManager,
    private truthCache: TruthCache
  ) {}

  /** Find symbols by name */
  async findSymbol(
    name: string,
    options?: QueryOptions
  ): Promise<QueryResult<SymbolQueryResult>> {
    const startTime = Date.now();
    const results: SymbolQueryResult[] = [];
    const warnings: string[] = [];

    // Get all matching symbols from graph
    const symbolNodes = this.graph.findNodesByName(name, 'symbol');

    for (const node of symbolNodes) {
      const file = this.fileRegistry.getById(node.fileId!);
      if (!file) continue;

      // Check if in preferred recipe
      const inPreferred = options?.preferRecipeId
        ? this.recipeManager.isFileInRecipe(file.fileId.id, options.preferRecipeId)
        : false;

      // Get symbol fact (would need to store or reparse)
      const symbol: SymbolFact = { /* ... */ } as any;

      // Check guard status if truth resolution requested
      let guardStatus: SymbolQueryResult['guardStatus'];
      if (options?.resolveTruth && options.preferRecipeId) {
        guardStatus = await this.getGuardStatus(
          file.fileId.id,
          symbol.range,
          options.preferRecipeId
        );
      }

      results.push({
        symbol,
        file,
        inPreferredRecipe: inPreferred,
        guardStatus
      });
    }

    // Sort: preferred recipe first, then by name match quality
    results.sort((a, b) => {
      if (a.inPreferredRecipe !== b.inPreferredRecipe) {
        return a.inPreferredRecipe ? -1 : 1;
      }
      return 0;
    });

    // Apply limit
    const limited = options?.limit ? results.slice(0, options.limit) : results;

    return {
      results: limited,
      recipeIds: options?.preferRecipeId ? [options.preferRecipeId] : [],
      truthResolved: !!options?.resolveTruth,
      queryTimeMs: Date.now() - startTime,
      warnings
    };
  }

  /** Get related files for a file */
  async getRelatedFiles(
    fileId: string,
    options?: QueryOptions
  ): Promise<RelatedFilesResult> {
    const result: RelatedFilesResult = {
      dependencies: [],
      dependents: [],
      includes: [],
      includedBy: [],
      macroRelated: []
    };

    // Get instantiation dependencies
    const instEdges = this.graph.getOutgoingEdges(fileId, 'instantiates');
    for (const edge of instEdges) {
      if (edge.resolved && edge.targetId) {
        const targetNode = this.graph.getNode(edge.targetId);
        if (targetNode?.fileId) {
          result.dependencies.push(targetNode.fileId);
        }
      }
    }

    // Get dependents (who instantiates symbols in this file)
    const depEdges = this.graph.getIncomingEdges(fileId, 'instantiates');
    for (const edge of depEdges) {
      const sourceNode = this.graph.getNode(edge.sourceId);
      if (sourceNode?.fileId) {
        result.dependents.push(sourceNode.fileId);
      }
    }

    // Get include relationships
    const includeEdges = this.graph.getOutgoingEdges(fileId, 'includes');
    result.includes = includeEdges
      .filter(e => e.resolved)
      .map(e => e.targetId);

    const includedByEdges = this.graph.getIncomingEdges(fileId, 'includes');
    result.includedBy = includedByEdges.map(e => e.sourceId);

    // Get macro relationships
    const macroUseEdges = this.graph.getOutgoingEdges(fileId, 'uses_macro');
    const macroNames = new Set(macroUseEdges.map(e => e.targetId));

    for (const macroName of macroNames) {
      const definingFiles = this.catalog.getFilesDefiningMacro(macroName);
      result.macroRelated.push(...definingFiles.filter(f => f !== fileId));
    }

    // Dedupe
    result.dependencies = [...new Set(result.dependencies)];
    result.dependents = [...new Set(result.dependents)];
    result.macroRelated = [...new Set(result.macroRelated)];

    return result;
  }

  private async getGuardStatus(
    fileId: string,
    range: LineRange,
    recipeId: string
  ): Promise<SymbolQueryResult['guardStatus']> {
    // Get truth cache entry
    const entry = await this.truthCache.getTruth(recipeId, fileId, async () => {
      // Compute truth (would call MacroEvaluator)
      return {} as TruthCacheEntry;
    });

    // Find guard containing this range
    for (const guard of entry.guardTruth) {
      for (const branch of guard.branches) {
        if (this.rangeContains(branch.span, range)) {
          return {
            isGuarded: true,
            isActive: branch.isActive,
            guardMacro: branch.macroName,
            confidence: guard.confidence
          };
        }
      }
    }

    return { isGuarded: false, confidence: 'certain' };
  }

  private rangeContains(outer: LineRange, inner: LineRange): boolean {
    return outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
  }
}

export interface RelatedFilesResult {
  dependencies: string[];
  dependents: string[];
  includes: string[];
  includedBy: string[];
  macroRelated: string[];
}
```

---

## 10. Implementation Phases

### Phase 1: Layer 0 + Parser Extensions (Foundation)
**Duration**: ~3-4 days

**Files to create**:
- `src/indexer/layer0/types.ts`
- `src/indexer/layer0/FileRegistry.ts`
- `src/indexer/layer0/index.ts`

**Files to modify**:
- `src/indexer/parser.ts` - Add LineRange tracking

**Deliverables**:
- FileRegistry with hashing and line indexing
- Extended parser with column tracking
- Unit tests for line index computation

### Phase 2: Layer 1 - Shallow Parsing
**Duration**: ~5-6 days

**Files to create**:
- `src/indexer/layer1/types.ts` (all fact types)
- `src/indexer/layer1/schemas.ts` (Zod schemas)
- `src/indexer/layer1/ShallowParser.ts`
- `src/indexer/layer1/FactExtractor.ts`
- `src/indexer/layer1/MacroCatalog.ts`
- `src/indexer/layer1/index.ts`

**Deliverables**:
- Macro-aware parsing (`define, `ifdef, etc.)
- Guard span detection with nesting
- MacroCatalog for cross-file discovery
- Unit tests for all fact types

### Phase 3: Layer 2 - Relationship Graph
**Duration**: ~3-4 days

**Files to create**:
- `src/indexer/layer2/types.ts`
- `src/indexer/layer2/RelationshipGraph.ts`
- `src/indexer/layer2/GraphQueries.ts`
- `src/indexer/layer2/index.ts`

**Deliverables**:
- Graph construction from Layer 1 facts
- BFS/DFS traversal
- Cycle detection
- Topological sort for compilation order

### Phase 4: Layer 3 - Recipe Manager
**Duration**: ~5-6 days

**Files to create**:
- `src/indexer/layer3/types.ts`
- `src/indexer/layer3/schemas.ts`
- `src/indexer/layer3/FilelistParser.ts`
- `src/indexer/layer3/RecipeManager.ts`
- `src/indexer/layer3/IncludeResolver.ts`
- `src/indexer/layer3/RecipeView.ts`
- `src/indexer/layer3/index.ts`

**Deliverables**:
- Full filelist syntax support
- Compilation plan generation
- Per-CU include resolution
- Unit tests with complex filelists

### Phase 5: Layer 4 - Truth Cache
**Duration**: ~4-5 days

**Files to create**:
- `src/indexer/layer4/types.ts`
- `src/indexer/layer4/TruthCache.ts`
- `src/indexer/layer4/MacroEvaluator.ts`
- `src/indexer/layer4/GuardResolver.ts`
- `src/indexer/layer4/index.ts`
- `src/indexer/persistence/CacheManager.ts`

**Deliverables**:
- Macro binding computation
- Guard truth evaluation
- File-based cache persistence
- Cache invalidation logic

### Phase 6: Query Engine + Integration
**Duration**: ~4-5 days

**Files to create**:
- `src/indexer/query/types.ts`
- `src/indexer/query/QueryEngine.ts`
- `src/indexer/query/GraphExpander.ts`
- `src/indexer/query/index.ts`
- `src/indexer/SVIndex.ts`

**Files to modify**:
- `src/indexer/index.ts` - Add SVIndex delegation
- `src/events/types.ts` - Add new event types

**Deliverables**:
- Unified query interface
- Recipe-aware filtering
- Truth-triggered queries
- Backward-compatible ProjectIndexer API

---

## 11. Testing Strategy

### Unit Tests Per Layer

```
src/indexer/__tests__/
├── layer0/
│   └── FileRegistry.test.ts
├── layer1/
│   ├── ShallowParser.test.ts
│   ├── FactExtractor.test.ts
│   └── MacroCatalog.test.ts
├── layer2/
│   ├── RelationshipGraph.test.ts
│   └── GraphQueries.test.ts
├── layer3/
│   ├── FilelistParser.test.ts
│   ├── RecipeManager.test.ts
│   └── IncludeResolver.test.ts
├── layer4/
│   ├── TruthCache.test.ts
│   ├── MacroEvaluator.test.ts
│   └── GuardResolver.test.ts
├── query/
│   └── QueryEngine.test.ts
└── integration/
    └── SVIndex.test.ts
```

### Test Fixtures

```
src/indexer/__tests__/fixtures/
├── simple_module.sv
├── module_with_params.sv
├── package_with_exports.sv
├── file_with_macros.sv
├── nested_guards.sv
├── multiline_macro.sv
├── simple.f
├── complex.f
├── nested/
│   ├── inner.f
│   └── files/
│       └── module.sv
└── ambiguous_includes/
    ├── dir1/defs.svh
    └── dir2/defs.svh
```

---

## 12. Verification Checklist

After implementation:

- [ ] All unit tests pass (`npm test`)
- [ ] Existing ProjectIndexer API still works (backward compat)
- [ ] Build succeeds (`npm run build`)
- [ ] Manual test with real SV project:
  - [ ] Load a `.f` filelist
  - [ ] Query for modules by name
  - [ ] Verify include resolution shows correct paths
  - [ ] Check macro guard truth (ifdef active/inactive)
  - [ ] Related files expansion works
- [ ] Cache persistence works (restart, cache hit)
- [ ] TypeScript types are clean (no `any` leaks)
- [ ] Zod schemas validate all inputs

---

## Sources

- [ChipVerify: SystemVerilog `define Macro](https://www.chipverify.com/systemverilog/systemverilog-define-macro)
- [Siemens: $unit vs $root](https://blogs.sw.siemens.com/verificationhorizons/2009/09/25/unit-vs-root/)
- [Icarus Verilog: Command File Format](https://iverilog.fandom.com/wiki/Command_File_Format)
- [Verilator Manual](https://manpages.ubuntu.com/manpages/focal/man1/verilator_bin_dbg.1.html)
- [sv-filelist-parser (Rust)](https://github.com/supleed2/sv-filelist-parser)
