# Complete Audit Summary: src/indexer

**Date:** January 9, 2026  
**Scope:** Entire `src/indexer/` directory  
**Modules Audited:** 9 subdirectories + root files

---

## Audit Coverage

| Module | Status | Audit File |
|--------|--------|------------|
| `ids/` | ✅ Complete | `ids/AUDIT.md` |
| `preprocessor/` | ✅ Complete | `preprocessor/AUDIT.md` |
| `reader/` | ✅ Complete | `reader/AUDIT.md` |
| `recipe/` | ✅ Complete | `recipe/AUDIT.md` |
| `resolver/` | ✅ Complete | `resolver/AUDIT.md` |
| `scanners/` | ✅ Complete | `scanners/AUDIT.md` |
| `types/` | ✅ Complete | `types/AUDIT.md` |
| `understander/` | ✅ Complete | `understander/AUDIT.md` |
| `analyzer/` | ✅ Complete | `analyzer/AUDIT.md` + `CODE_REVIEW.md` |
| Root files | ✅ Complete | `AUDIT.md` |

---

## Critical Issues Summary

### 🔴 CRITICAL (Must Fix Immediately)

1. **ScopeTracker not shared** (`understander/file-understander.ts`)
   - **Impact:** All references have `scope: []`, all instances have `parentScope: []`
   - **Cascade:** Breaks hierarchy building, scoped resolution, guard tracking
   - **Fix:** Pass ScopeTracker through scanner pipeline

2. **Infinite recursion on circular filelists** (`recipe/filelist-parser.ts`)
   - **Impact:** Stack overflow crash
   - **Fix:** Add cycle detection with `visited: Set<string>`

3. **Infinite recursion on circular instantiation** (`resolver/project-resolver.ts`)
   - **Impact:** Stack overflow crash
   - **Fix:** Add cycle detection in `buildHierarchyNode()`

---

## High Severity Issues Summary

### 🟠 HIGH (Fix Soon)

1. **Missing `guard` field on Directive** (`types/directive.ts`)
   - Can't track conditional macros

2. **Quoted paths include quotes** (`recipe/filelist-parser.ts`)
   - Path resolution fails for quoted paths

3. **Include resolution order wrong** (`resolver/project-resolver.ts`)
   - Relative paths should be checked before include directories

4. **Scoped name resolution drops segments** (`resolver/project-resolver.ts`)
   - `pkg::outer::Inner` loses middle parts

5. **Errors array always empty** (`understander/file-understander.ts`)
   - No error reporting to users

6. **Legacy indexer still active** (`index.ts`)
   - Creates confusion about which indexer to use

---

## Bug Pattern Analysis

### Pattern 1: Missing Cycle Detection (3 instances)
- `recipe/filelist-parser.ts` - Circular `-f` includes
- `resolver/project-resolver.ts` - Circular instantiation
- **Root cause:** No `visited` tracking in recursive functions

### Pattern 2: Scope Tracking Not Integrated (Cross-module)
- `understander/file-understander.ts` - Doesn't pass ScopeTracker
- `reference-scanner.ts` - Creates empty tracker
- `instance-scanner.ts` - No tracker at all
- **Root cause:** Scanners designed independently, no shared state

### Pattern 3: String Parsing Edge Cases (2 instances)
- `preprocessor/comment-stripper.ts` - Off-by-one in block comments
- `recipe/filelist-parser.ts` - Quoted paths not stripped
- **Root cause:** Regex patterns don't handle all edge cases

---

## Statistics

| Severity | Count | Percentage |
|----------|-------|------------|
| 🔴 Critical | 3 | 8% |
| 🟠 High | 6 | 16% |
| 🟡 Medium | 20 | 54% |
| 🟢 Low | 8 | 22% |
| **Total** | **37** | **100%** |

---

## Recommended Fix Order

### Phase 1: Critical Fixes (Prevent Crashes)
1. ✅ Add cycle detection to `recipe/filelist-parser.ts`
2. ✅ Add cycle detection to `resolver/project-resolver.ts`
3. ✅ Share ScopeTracker across scanners in `understander/file-understander.ts`

### Phase 2: High Priority (Core Functionality)
4. ✅ Add `guard` field to Directive type
5. ✅ Fix include resolution order
6. ✅ Fix scoped name resolution
7. ✅ Strip quotes from paths
8. ✅ Implement error collection

### Phase 3: Medium Priority (Quality)
9. Fix duplicate adds in DeclarationIndex
10. Fix hierarchy scope matching
11. Use ifdefState for guard propagation
12. Fix port connection locations
13. Fix enum value locations

### Phase 4: Low Priority (Polish)
14. Remove duplicate buildLineOffsets
15. Use SHA-256 consistently
16. Remove unused variables
17. Deprecate legacy indexer

---

## Architecture Observations

### ✅ Strengths
- **Clean separation of concerns** - Each module has single responsibility
- **Well-typed** - Excellent use of TypeScript discriminated unions
- **Good documentation** - Comprehensive JSDoc comments
- **Modular design** - Easy to test individual components

### ⚠️ Weaknesses
- **Lack of integration testing** - Scanners work independently but don't share state
- **Legacy code still present** - Old parser/indexer creates confusion
- **Error handling incomplete** - Errors collected but not propagated
- **No validation** - Input validation missing in many places

---

## Test Coverage Gaps

Based on audit findings, these scenarios need testing:

1. **Circular dependencies:**
   - Circular filelists (`a.f → b.f → a.f`)
   - Circular instantiation (`module A; A a(); endmodule`)

2. **Scope tracking:**
   - Nested modules/classes/packages
   - References inside nested scopes
   - Instances inside nested scopes

3. **Edge cases:**
   - Quoted paths in filelists
   - Unterminated block comments
   - Multi-signal declarations
   - Scoped identifiers (`pkg::outer::Inner`)

4. **Error conditions:**
   - Missing files in filelist
   - Parse errors in individual files
   - Missing declarations for references

---

## Files Requiring Immediate Attention

1. `understander/file-understander.ts` - **ROOT CAUSE** of scope issues
2. `recipe/filelist-parser.ts` - Critical crash bug
3. `resolver/project-resolver.ts` - Critical crash bug + resolution bugs
4. `types/directive.ts` - Missing field breaks type consistency

---

## Conclusion

The indexer architecture is **solid** with excellent modular design. However, there are **3 critical bugs** that cause crashes and **1 architectural issue** (scope tracking) that breaks core functionality.

**Estimated Fix Time:**
- Critical fixes: 2-4 hours
- High priority: 4-6 hours
- Medium priority: 8-12 hours
- Low priority: 4-6 hours
- **Total: 18-28 hours**

**Recommendation:** Fix critical issues immediately, then tackle high-priority items before production use.

