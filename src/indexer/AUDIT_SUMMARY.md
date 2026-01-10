# Complete Audit Summary: src/indexer

**Date:** January 10, 2026
**Scope:** Entire `src/indexer/` directory
**Architecture:** Slang-primary with Verible for directives

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       SVIndexer                              │
│  - indexProject(filelistPath) → ResolvedProject             │
│  - indexFiles(paths) → ParseResults                         │
│  - parseFile(path) → FileUnderstanderResult                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    FileUnderstander                          │
│  - Runs Slang + Verible in parallel                         │
│  - Slang: declarations, references, instances               │
│  - Verible: directives (only source)                        │
└─────────────────────────────────────────────────────────────┘
           │                                    │
           ▼                                    ▼
┌─────────────────────┐            ┌─────────────────────┐
│       Slang         │            │      Verible        │
│  - Full SV 2017     │            │  - Fast parsing     │
│  - Semantic analysis│            │  - Directive CST    │
│  - Auto-download    │            │  - Auto-download    │
└─────────────────────┘            └─────────────────────┘
```

---

## Audit Coverage

| Module | Status | Audit File | Issues |
|--------|--------|------------|--------|
| `understander/` | ✅ Complete | `understander/AUDIT.md` | 0 |
| `verible/` | ✅ Complete | `verible/AUDIT.md` | 0 |
| `slang/` | ✅ Complete | `slang/AUDIT.md` | 0 |
| `resolver/` | ✅ Complete | `resolver/AUDIT.md` | 0 |
| `recipe/` | ✅ Complete | `recipe/AUDIT.md` | 0 |
| `reader/` | ✅ Complete | `reader/AUDIT.md` | 0 |
| `ids/` | ✅ Complete | `ids/AUDIT.md` | 0 |
| `types/` | ✅ Complete | `types/AUDIT.md` | 0 |
| `analyzer/` | ⚠️ Complete | `analyzer/AUDIT.md` | 1 High |
| `merge/` | ✅ Complete | N/A | 0 |

---

## Deprecated Code

The following code has been moved to `deprecated/` folder (gitignored):

| Former Location | Reason |
|-----------------|--------|
| `scanners/*.ts` | Replaced by Verible CST mappers |
| `preprocessor/*.ts` | No longer needed (Verible/Slang handle preprocessing) |

---

## High Severity Issues

### 🟠 HIGH (Should Fix Soon)

1. **Scoped name resolution drops path segments** (`resolver/project-resolver.ts:279-295`)
   - `pkg::outer::Inner` only splits on first `::`, loses middle segment
   - **Fix:** Use `name.split('::')` to get all segments

2. **Include resolution order wrong** (`resolver/project-resolver.ts:365-387`)
   - Checks recipe paths before relative paths (should be reversed)
   - **Fix:** Check relative path first, then recipe paths

3. **Quoted paths include quotes** (`recipe/filelist-parser.ts:236-242`)
   - `+incdir+"/path"` stores `"/path"` with quotes
   - **Fix:** Strip quotes from captured path

4. **Encoding detection hash instability** (`reader/file-reader.ts:293-314`)
   - Same file can return different hashes if encoding detection inconsistent
   - **Fix:** Hash raw buffer or normalize encoding before hashing

5. **getCompileOrder fallback** (`sv-indexer.ts:~246-250`)
   - Falls back to arbitrary file order if cycles exist
   - **Fix:** Use `getCompileOrder()` from `dependency-analyzer.ts` which handles cycles

---

## Medium Severity Issues

### 🟡 MEDIUM (Should Fix Eventually)

1. **Hierarchy matching only checks first scope** (`resolver/project-resolver.ts:454-456`)
2. **Duplicate adds cause inconsistent state** (`resolver/declaration-index.ts:68-90`)
3. **Duplicate files not deduplicated** (`recipe/filelist-parser.ts`)

---

## Fixed Issues ✅

1. ✅ **Guard tracking** - Now handled by Verible/Slang at CST/AST level
2. ✅ **Scope tracking** - Verible/Slang provide accurate scope information
3. ✅ **Cycle detection** - Both `project-resolver.ts` and `filelist-parser.ts` have cycle detection
4. ✅ **Checker constructs** - Slang handles checker blocks correctly
5. ✅ **Generate blocks** - Slang evaluates generate conditionals

---

## Security Considerations

1. **Binary Execution:**
   - Slang and Verible binaries executed as subprocesses
   - Auto-download from official GitHub releases only
   - File paths passed as arguments (no user input injection risk)
   - Configurable timeouts prevent hangs

2. **File Access:**
   - Only reads files specified by user via filelist
   - No arbitrary filesystem access
   - Paths validated by parser binaries

3. **Caching:**
   - Disk cache uses file mtime for validation
   - Cache directory in user home (~/.gateflow/)
   - No sensitive data stored

---

## Test Coverage

| Test File | Coverage |
|-----------|----------|
| `sv-indexer.test.ts` | FileUnderstander, SVIndexer integration |
| `verible-coverage.test.ts` | All 24 Verible mapper features |

**Total:** 89 tests passing

---

## Priority Fix Order

1. **P1 (High):** Fix scoped name resolution (multiple `::` segments)
2. **P1 (High):** Fix include path resolution order
3. **P1 (High):** Fix getCompileOrder cycle handling
4. **P2 (Medium):** Fix hierarchy matching (full scope chain)
5. **P2 (Medium):** Deduplicate adds in declaration index

---

**Total Issues:** 0 Critical, 5 High, 3 Medium
