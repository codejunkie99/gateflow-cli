# Security & Logic Audit: Indexer Module

**Date:** January 10, 2026
**Auditor:** Code Review
**Severity Scale:** Critical | High | Medium | Low | Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 0 | No critical issues |
| High | 0 | No high-severity issues |
| Medium | 1 | getCompileOrder fallback could be improved |
| Low | 0 | No low-severity issues |

**Status:** Clean architecture with Slang-primary parsing

---

## Architecture Overview

The indexer uses a **two-parser architecture** with Slang as primary and Verible for directives:

```
┌─────────────────────────────────────────────────────────────┐
│                       SVIndexer                              │
│  - indexProject(filelist) → ResolvedProject                 │
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

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| SVIndexer | `sv-indexer.ts` | Main entry point, project indexing |
| FileUnderstander | `understander/file-understander.ts` | Two-parser orchestration |
| Verible Adapter | `verible/verible-adapter.ts` | Verible integration |
| Slang Backend | `slang/slang-backend.ts` | Slang integration |
| CST Mapper | `verible/cst-mapper.ts` | Verible CST to types |
| Slang Mapper | `slang/slang-mapper.ts` | Slang AST to types |

---

## File: `sv-indexer.ts`

### Verified Correct: Main Orchestrator

**Status:** Clean API and proper separation of concerns.

**Public API:**
- `indexProject(filelistPath)` - Index entire project from filelist
- `indexFiles(paths)` - Index specific files
- `parseFile(path)` - Parse single file
- `getCompileOrder(project)` - Get dependency-sorted file order

---

### Medium: getCompileOrder Fallback

**Location:** Lines ~246-250

**Current Behavior:**
```typescript
getCompileOrder(project: ResolvedProject): string[] {
  const graph = new DependencyGraph();
  graph.addEdges(project.dependencies);
  return graph.tryGetCompileOrder() || project.files.map((f) => f.path);
}
```

**Issue:** Falls back to arbitrary file order if cycles exist, instead of partial order.

**Recommendation:** Use `getCompileOrder()` from `dependency-analyzer.ts` which handles cycles gracefully.

---

## File: `index.ts`

### Verified Correct: Re-exports

**Status:** Clean re-export module, no logic issues.

---

## Deprecated Code

The following code has been moved to `deprecated/` folder (gitignored):

| Former Location | Reason |
|-----------------|--------|
| `scanners/*.ts` | Replaced by Verible CST mappers |
| `preprocessor/*.ts` | No longer needed (Verible/Slang handle preprocessing) |

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

## Summary

The indexer module is architecturally clean with proper separation between:
- **Parsing layer:** Slang + Verible
- **Resolution layer:** ProjectResolver, DeclarationIndex
- **Query layer:** Query API for lookups

No critical or high-severity issues. One medium issue (compile order fallback) noted for future improvement.
