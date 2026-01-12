# Multi-Language Architecture Plan

## Overview

Extend the indexer to support multiple HDLs (SystemVerilog, VHDL, Verilog) while maintaining the current architecture's strengths.

---

## Current Architecture (SystemVerilog-Only)

```
SVIndexer
  └── FileUnderstander (hardcoded to Slang/Verible)
       ├── Slang (SV semantic analysis)
       └── Verible (SV directives)
```

**Language-Specific Parts:**
- `SVIndexer` class name
- `FileUnderstander` hardcoded to Slang/Verible
- File extensions: `.sv`, `.svh`, `.v`, `.vh`
- Declaration kinds: SV-specific (module, package, interface, etc.)
- Parsers: Slang (SV), Verible (SV/Verilog)

**Language-Agnostic Parts:**
- Declaration/Reference/Instance types
- Dependency graph
- Hierarchy tree
- ID system
- Query API
- Caching

---

## Target Languages

### Phase 1: Verilog (Easy)
- **Why**: Verilog is a subset of SystemVerilog
- **Parser**: Verible (already supports Verilog)
- **Changes**: Minimal - just detect `.v` files
- **Effort**: 1-2 days

### Phase 2: VHDL (Medium)
- **Why**: Second most popular HDL
- **Parser**: GHDL (open source), or VHDL LS (language server)
- **Changes**: New parser adapter, VHDL-specific mappers
- **Effort**: 1-2 weeks

### Phase 3: Mixed Projects (Hard)
- **Why**: Real projects often mix SV + VHDL
- **Parser**: Run both parsers, merge results
- **Changes**: Language detection, multi-parser orchestration
- **Effort**: 1 week

---

## Proposed Architecture

### 1. Language Detection Layer

```typescript
// src/indexer/language/detector.ts

export type Language = 'systemverilog' | 'verilog' | 'vhdl';

export interface LanguageInfo {
  language: Language;
  extensions: string[];
  parser: ParserType;
}

export function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  
  if (['.sv', '.svh'].includes(ext)) return 'systemverilog';
  if (['.v', '.vh'].includes(ext)) return 'verilog';
  if (['.vhd', '.vhdl'].includes(ext)) return 'vhdl';
  
  // Fallback: try to detect from content
  return detectFromContent(filePath);
}
```

### 2. Parser Interface (Abstraction)

```typescript
// src/indexer/language/parser-interface.ts

export interface ParserAdapter {
  /** Language this parser supports */
  language: Language;
  
  /** Check if parser is available */
  isAvailable(): Promise<boolean>;
  
  /** Parse a single file */
  parseFile(filePath: string, options?: ParseOptions): Promise<ParseResult>;
  
  /** Parse multiple files (for semantic analysis) */
  parseFiles(filePaths: string[], options?: ParseOptions): Promise<ParseResult[]>;
}

export interface ParseResult {
  declarations: Declaration[];
  references: Reference[];
  instances: Instance[];
  directives?: Directive[];  // Optional (VHDL doesn't have preprocessor)
  errors: ParseError[];
  stats: ParseStats;
}
```

### 3. Language-Specific Parsers

```typescript
// src/indexer/language/parsers/

// SystemVerilog (existing)
export class SystemVerilogParser implements ParserAdapter {
  language = 'systemverilog' as const;
  private slang: SlangBackend;
  private verible: VeribleAdapter;
  
  async parseFile(filePath: string): Promise<ParseResult> {
    // Use existing Slang + Verible logic
  }
}

// Verilog (new, but easy)
export class VerilogParser implements ParserAdapter {
  language = 'verilog' as const;
  private verible: VeribleAdapter;  // Verible supports Verilog
  
  async parseFile(filePath: string): Promise<ParseResult> {
    // Use Verible only (Verilog is simpler)
  }
}

// VHDL (new)
export class VHDLParser implements ParserAdapter {
  language = 'vhdl' as const;
  private ghdl?: GHDLAdapter;  // Or VHDL LS
  
  async parseFile(filePath: string): Promise<ParseResult> {
    // Use GHDL or VHDL LS
  }
}
```

### 4. Unified File Understander

```typescript
// src/indexer/understander/file-understander.ts (refactored)

export class FileUnderstander {
  private parsers: Map<Language, ParserAdapter> = new Map();
  
  constructor() {
    // Register parsers
    this.parsers.set('systemverilog', new SystemVerilogParser());
    this.parsers.set('verilog', new VerilogParser());
    this.parsers.set('vhdl', new VHDLParser());
  }
  
  async understand(filePath: string): Promise<FileUnderstanderResult> {
    // 1. Detect language
    const language = detectLanguage(filePath);
    
    // 2. Get appropriate parser
    const parser = this.parsers.get(language);
    if (!parser) {
      throw new Error(`No parser available for language: ${language}`);
    }
    
    // 3. Check availability
    if (!await parser.isAvailable()) {
      throw new Error(`Parser for ${language} is not available`);
    }
    
    // 4. Parse
    return parser.parseFile(filePath);
  }
}
```

### 5. Unified Indexer

```typescript
// src/indexer/indexer.ts (rename from sv-indexer.ts)

export class HDLIndexer {  // Renamed from SVIndexer
  private understander: FileUnderstander;
  
  async indexProject(filelistPath: string): Promise<ResolvedProject> {
    const recipe = await this.filelistParser.parse(filelistPath);
    
    // Group files by language
    const filesByLanguage = groupFilesByLanguage(recipe.files);
    
    // Parse each language group in parallel
    const results = await Promise.all(
      Array.from(filesByLanguage.entries()).map(([language, files]) =>
        this.parseLanguageGroup(language, files)
      )
    );
    
    // Merge all results
    return this.mergeMultiLanguageResults(results);
  }
  
  private async parseLanguageGroup(
    language: Language,
    files: string[]
  ): Promise<LanguageParseResult> {
    const parser = this.understander.getParser(language);
    // ... parse files
  }
}
```

---

## Implementation Plan

### Phase 1: Refactor to Language-Agnostic Core (Week 1)

**Goal**: Extract language-specific code into adapters

1. **Create parser interface**
   - `src/indexer/language/parser-interface.ts`
   - Define `ParserAdapter` interface
   - Define `Language` type

2. **Refactor FileUnderstander**
   - Extract SV-specific logic to `SystemVerilogParser`
   - Make `FileUnderstander` use parser interface
   - Add language detection

3. **Rename SVIndexer → HDLIndexer**
   - Keep `SVIndexer` as alias for backward compatibility
   - Update all references

4. **Update types to be language-agnostic**
   - Declaration kinds: Keep SV-specific, but make extensible
   - Add `language` field to `Declaration`, `Reference`, `Instance`

**Files to create:**
```
src/indexer/language/
  ├── detector.ts          (language detection)
  ├── parser-interface.ts (abstraction)
  └── parsers/
      └── systemverilog-parser.ts (refactored from FileUnderstander)
```

**Files to modify:**
- `src/indexer/understander/file-understander.ts` (use parser interface)
- `src/indexer/sv-indexer.ts` → `src/indexer/indexer.ts` (rename)
- `src/indexer/types/declaration.ts` (add language field)

---

### Phase 2: Add Verilog Support (Week 1-2)

**Goal**: Support pure Verilog files

1. **Create VerilogParser**
   - Use Verible (already supports Verilog)
   - Map Verilog AST to unified types
   - Handle Verilog-specific constructs

2. **Update language detection**
   - Detect `.v`/`.vh` as Verilog
   - Handle Verilog-specific syntax

3. **Test with Verilog projects**
   - Verify declarations, references, instances work
   - Test compile order

**Files to create:**
```
src/indexer/language/parsers/
  └── verilog-parser.ts
```

**Files to modify:**
- `src/indexer/language/detector.ts` (add Verilog detection)
- `src/indexer/understander/file-understander.ts` (register Verilog parser)

---

### Phase 3: Add VHDL Support (Week 3-4)

**Goal**: Support VHDL files

1. **Choose VHDL parser**
   - **Option A**: GHDL (compiler, can extract AST)
   - **Option B**: VHDL LS (language server protocol)
   - **Option C**: pyVHDL2AST (Python, needs wrapper)
   - **Recommendation**: Start with GHDL (most mature)

2. **Create VHDLParser**
   - Implement `ParserAdapter` interface
   - Map VHDL AST to unified types
   - Handle VHDL-specific constructs:
     - Entity/Architecture (vs Module)
     - Package/Use (vs Include)
     - Component/Port (vs Instance)

3. **VHDL-specific mappers**
   - Entity → Declaration (kind: 'entity')
   - Architecture → Declaration (kind: 'architecture')
   - Component → Declaration (kind: 'component')
   - Signal → Declaration (kind: 'signal')
   - Port → Declaration (kind: 'port')

4. **Update types**
   - Add VHDL-specific declaration kinds
   - Extend `DeclarationKind` union type

**Files to create:**
```
src/indexer/language/parsers/
  └── vhdl-parser.ts

src/indexer/vhdl/
  ├── ghdl-adapter.ts      (GHDL integration)
  └── mappers/
      ├── entity-mapper.ts
      ├── architecture-mapper.ts
      └── component-mapper.ts
```

**Files to modify:**
- `src/indexer/types/declaration.ts` (add VHDL kinds)
- `src/indexer/language/detector.ts` (add VHDL detection)

---

### Phase 4: Mixed Language Projects (Week 5)

**Goal**: Support projects with multiple languages

1. **Multi-language filelist parsing**
   - Detect language per file
   - Group files by language
   - Parse each group with appropriate parser

2. **Cross-language resolution**
   - VHDL entities instantiated in SV
   - SV modules instantiated in VHDL
   - Shared packages/types

3. **Unified dependency graph**
   - Language-agnostic file dependencies
   - Cross-language instance resolution

**Files to modify:**
- `src/indexer/indexer.ts` (multi-language orchestration)
- `src/indexer/resolver/project-resolver.ts` (cross-language resolution)

---

## Type System Changes

### Declaration Kinds (Extended)

```typescript
export type DeclarationKind =
  // SystemVerilog (existing)
  | 'module' | 'package' | 'interface' | 'class' | 'program'
  | 'function' | 'task' | 'typedef' | 'struct' | 'union' | 'enum'
  | 'port' | 'parameter' | 'localparam' | 'signal'
  
  // Verilog (subset of SV)
  | 'module' | 'function' | 'task' | 'port' | 'parameter' | 'signal'
  
  // VHDL (new)
  | 'entity'           // Entity declaration
  | 'architecture'     // Architecture body
  | 'package'          // Package declaration
  | 'package_body'     // Package body
  | 'component'        // Component declaration
  | 'signal'           // Signal declaration
  | 'port'             // Port declaration
  | 'constant'         // Constant declaration
  | 'type'             // Type declaration
  | 'subtype'          // Subtype declaration
  | 'function'         // Function declaration
  | 'procedure';       // Procedure declaration
```

### Add Language Field

```typescript
export interface Declaration {
  id: string;
  kind: DeclarationKind;
  name: string;
  language: Language;  // NEW: 'systemverilog' | 'verilog' | 'vhdl'
  location: Location;
  // ... rest of fields
}
```

---

## VHDL-Specific Challenges

### 1. Entity vs Architecture

**VHDL:**
```vhdl
entity counter is
  port (clk: in std_logic);
end entity;

architecture rtl of counter is
begin
  -- implementation
end architecture;
```

**Mapping:**
- `entity counter` → Declaration (kind: 'entity')
- `architecture rtl of counter` → Declaration (kind: 'architecture', parent: 'counter')

### 2. Component vs Entity

**VHDL:**
```vhdl
component counter is
  port (clk: in std_logic);
end component;

-- Later instantiated:
inst: counter port map (clk => clk);
```

**Mapping:**
- Component → Declaration (kind: 'component')
- Instance → Instance (target: component or entity)

### 3. Package vs Include

**VHDL:**
```vhdl
package my_pkg is
  type my_type is ...;
end package;

-- Used via:
use work.my_pkg.all;
```

**Mapping:**
- Package → Declaration (kind: 'package')
- Use statement → Reference (kind: 'package_usage')

---

## File Structure

```
src/indexer/
├── language/                    # NEW: Language abstraction
│   ├── detector.ts             # Language detection
│   ├── parser-interface.ts     # Parser abstraction
│   └── parsers/
│       ├── systemverilog-parser.ts  # Refactored from FileUnderstander
│       ├── verilog-parser.ts        # NEW
│       └── vhdl-parser.ts          # NEW
│
├── slang/                      # SystemVerilog-specific (keep)
├── verible/                     # SystemVerilog/Verilog (keep)
├── vhdl/                        # NEW: VHDL-specific
│   ├── ghdl-adapter.ts
│   └── mappers/
│       ├── entity-mapper.ts
│       ├── architecture-mapper.ts
│       └── component-mapper.ts
│
├── types/                       # Language-agnostic (extend)
│   └── declaration.ts          # Add language field, VHDL kinds
│
├── understander/                # Language-agnostic (refactor)
│   └── file-understander.ts    # Use parser interface
│
├── indexer.ts                   # Renamed from sv-indexer.ts
└── sv-indexer.ts               # Alias for backward compatibility
```

---

## Backward Compatibility

### Keep SVIndexer as Alias

```typescript
// src/indexer/sv-indexer.ts
export { HDLIndexer as SVIndexer } from './indexer.js';
export type { ResolvedProject } from './types/index.js';
// ... re-export everything
```

### Default to SystemVerilog

```typescript
// If language can't be detected, default to SV
export function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  // ... detection logic
  return 'systemverilog';  // Default fallback
}
```

---

## Testing Strategy

### Unit Tests
- Language detection for each file type
- Parser adapter interface compliance
- VHDL-specific mappers

### Integration Tests
- Pure Verilog project
- Pure VHDL project
- Mixed SV + VHDL project
- Cross-language instantiation

### Test Fixtures
```
src/__tests__/fixtures/
├── sv/              (existing)
├── verilog/          (new)
│   └── counter.v
└── vhdl/             (new)
    ├── counter.vhd
    └── counter_tb.vhd
```

---

## Migration Path

### Step 1: Refactor (No Breaking Changes)
- Create parser interface
- Refactor FileUnderstander to use interface
- Keep SVIndexer working as-is

### Step 2: Add Verilog (Optional)
- Add VerilogParser
- Users opt-in by using `.v` files

### Step 3: Add VHDL (Optional)
- Add VHDLParser
- Users opt-in by using `.vhd` files

### Step 4: Mixed Projects (Advanced)
- Automatic language detection
- Multi-language orchestration

---

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| **Phase 1: Refactor** | 1 week | Low (internal refactor) |
| **Phase 2: Verilog** | 3-5 days | Low (Verible supports it) |
| **Phase 3: VHDL** | 2-3 weeks | Medium (new parser integration) |
| **Phase 4: Mixed** | 1 week | Medium (cross-language resolution) |

**Total**: ~5-6 weeks for full multi-language support

---

## Next Steps

1. **Start with Phase 1** (refactor to parser interface)
2. **Validate with Verilog** (easiest addition)
3. **Research VHDL parsers** (GHDL vs VHDL LS)
4. **Prototype VHDL support** (proof of concept)
5. **Full implementation** (all phases)

---

## Questions to Resolve

1. **VHDL Parser Choice**: GHDL vs VHDL LS vs other?
2. **Cross-Language**: How to handle SV instantiating VHDL entities?
3. **Declaration Kinds**: Keep separate or unify (entity vs module)?
4. **Filelist Format**: Support VHDL-specific filelists (different from .f)?



