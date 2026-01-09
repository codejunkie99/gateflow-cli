# Security & Logic Audit: Analyzer Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

**Note:** This module was previously reviewed in `CODE_REVIEW.md`. This audit adds cross-module concerns and verifies integration.

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 1 | Macro dependencies not resolved (compile order risk) |
| 🟡 Medium | 2 | Unused import; conditional includes over-estimated |
| 🟢 Low | 2 | Cycle detection behavior; duplicate cycle reports |
| ℹ️ Info | 5 | SV features not captured (upstream limitations) |

**Status:** ⚠️ Functional with known limitations - see SystemVerilog-Specific Analysis section

---

## Cross-Module Integration

### ✅ VERIFIED CORRECT: Integration with Resolver

The analyzer correctly uses:
- `DeclarationIndex` from `resolver/` for module lookups
- `Instance[]` from resolved project
- `HierarchyNode[]` from resolved project

**No integration issues found.**

---

## Reference: CODE_REVIEW.md

See `CODE_REVIEW.md` for detailed findings:
- Unused `FileRecord` import in `dependency-analyzer.ts`
- Cycle detection continues after finding cycles (may be intentional)
- Verified correctness of Kahn's algorithm in `getCompileOrder()`

---

## Verified Correct ✅

| Component | Status | Notes |
|-----------|--------|-------|
| `DependencyGraph.addEdge()` | ✅ | Correct adjacency list building |
| `DependencyGraph.getCompileOrder()` | ✅ | Kahn's algorithm correctly implemented |
| `DependencyGraph.detectCycles()` | ⚠️ | Continues after finding cycles (may be intentional) |
| `findTopModules()` | ✅ | Correctly filters non-instantiated modules |
| `getHierarchyStats()` | ✅ | Handles empty hierarchy correctly |
| `formatHierarchy()` | ✅ | Proper tree formatting |

---

## SystemVerilog-Specific Analysis

**Date:** January 10, 2026

### Edge Cases & Limitations

#### 🟠 High: Macro Dependencies NOT Handled

**Finding:** Macro usages are scanned but NOT resolved, resulting in missing dependencies.

- `reference-scanner.ts` detects macro usages as `macro_usage` references
- `project-resolver.ts:247-251` explicitly does NOT resolve them:
  ```typescript
  case 'macro_usage':
    // References a macro (define directive)
    // We don't have macros in declaration index currently
    return undefined;
  ```

**Impact:** If `counter.sv` uses `` `WIDTH`` from `defines.svh`, no dependency is created and compile order may be WRONG.

**Fix Required:**
1. Index macro definitions from `` `define`` directives in `DeclarationIndex`
2. Resolve `macro_usage` references to their defining files
3. Add macro dependencies to `buildDependencies()`

---

#### 🟡 Medium: Conditional Compilation Over-Estimates Dependencies

**Finding:** Guards are tracked but NOT used for dependency filtering.

- `directive-scanner.ts` tracks `ifdefState` with guard conditions
- References store guard info (condition + inverted flag)
- BUT `project-resolver.ts:529-542` adds include dependencies unconditionally

**Behavior:** ALL `` `include`` directives become dependencies, even inside `` `ifdef`` blocks.

**Impact:** Safe (over-estimates) but may include unnecessary files in compile order.

---

#### ✅ Package Imports: Handled Correctly

`import my_pkg::*` and `import my_pkg::item` correctly create dependencies.

---

#### ✅ Multiple Modules Per File: Handled Correctly

Dependencies are at file level. If `top.sv` instantiates `helper1` from `utils.sv` (which also defines unused `helper2`), the file-level dependency is correct.

---

### SV Features NOT Captured (Upstream Limitations)

These require changes to the **parser/resolver**, not this analyzer:

| Feature | Description | Impact |
|---------|-------------|--------|
| `bind` statements | Insert modules without traditional instantiation | Missing dependencies |
| Configuration blocks | Alter module binding at elaboration time | Wrong module resolved |
| Interface modports | Implicit dependencies through interface connections | Missing dependencies |
| Generate conditionals | Dependencies may be compile-time conditional | Over/under-estimation |
| Library mappings | SV library semantics affect module resolution | Wrong file resolved |

---

### Cycle Detection Behavior

**Note:** The cycle detection algorithm may report the same cycle multiple times when DFS starts from different nodes within the cycle. This doesn't affect correctness but may clutter output.

---

## Summary

| Issue | Severity | Status |
|-------|----------|--------|
| Macro dependencies not resolved | 🟠 High | Needs fix |
| Conditional includes over-estimated | 🟡 Medium | Acceptable |
| Duplicate cycle reports | 🟢 Low | Minor cosmetic |
| Package imports | ✅ | Working |
| Multi-module files | ✅ | Working |

---

## No Additional Issues Found

This module is well-integrated and follows the patterns established in other modules. The issues documented in CODE_REVIEW.md are minor and don't affect functionality.


