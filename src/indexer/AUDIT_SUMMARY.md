# Complete Audit Summary: src/indexer (RE-AUDIT)

**Date:** January 9, 2026  
**Scope:** Entire `src/indexer/` directory (re-audited after rewrite)  
**Modules Audited:** 9 subdirectories + root files

---

## Audit Coverage

| Module | Status | Audit File | Critical Issues |
|--------|--------|------------|-----------------|
| `scanners/` | ✅ Complete | `scanners/AUDIT.md` | 1 |
| `understander/`
 | ✅ Complete | `understander/AUDIT.md` | 1 |
| `resolver/` | ✅ Complete | `resolver/AUDIT.md` | 0 |
| `recipe/` | ✅ Complete | `recipe/AUDIT.md` | 0 |
| `preprocessor/` | ✅ Complete | `preprocessor/AUDIT.md` | 0 |
| `reader/` | ✅ Complete | `reader/AUDIT.md` | 0 |
| `ids/` | ✅ Complete | `ids/AUDIT.md` | 0 |
| `types/` | ✅ Complete | `types/AUDIT.md` | 0 |
| `analyzer/` | ⚠️ Complete | `analyzer/AUDIT.md` | 0 (1 High) |

---

## Critical Issues Summary

### 🔴 CRITICAL (Must Fix Immediately)

1. **Guard state not passed to scanners** (`understander/file-understander.ts`)
   - **Impact:** All references and instances have `guard: undefined` even when inside `ifdef` blocks
   - **Fix:** Pass `ifdefState` or guard lookup function to `scanReferences` and `scanInstances`

2. **ScopeTracker guards never populated** (`scanners/reference-scanner.ts`, `scanners/instance-scanner.ts`)
   - **Impact:** Same as above - guards always undefined
   - **Fix:** Share guard state from directive scanner or build guard lookup function

---

## High Severity Issues

### 🟠 HIGH (Should Fix Soon)

1. **Scoped name resolution drops path segments** (`resolver/project-resolver.ts:279-295`)
   - `pkg::outer::Inner` only splits on first `::`, loses middle segment
   - **Fix:** Use `name.split('::')` to get all segments

2. **Include resolution order wrong** (`resolver/project-resolver.ts:365-387`)
   - Checks recipe paths before relative paths (should be reversed)
   - **Fix:** Check relative path first, then recipe paths

3. **buildScopeLookup doesn't handle nested scopes** (`scanners/scope-tracker.ts:524-546`)
   - Adds all scopes that start before line, doesn't check nesting
   - **Fix:** Track scope hierarchy and only include containing scopes

4. **Quoted paths include quotes** (`recipe/filelist-parser.ts:236-242`)
   - `+incdir+"/path"` stores `"/path"` with quotes
   - **Fix:** Strip quotes from captured path

5. **Encoding detection hash instability** (`reader/file-reader.ts:293-314`)
   - Same file can return different hashes if encoding detection inconsistent
   - **Fix:** Hash raw buffer or normalize encoding before hashing

6. **Missing guard field on Directive** (`types/directive.ts:120-156`)
   - Directive type missing `guard?: Guard` field (inconsistent with other types)
   - **Fix:** Add `guard?: Guard` to Directive interface

7. **Macro dependencies not resolved** (`resolver/project-resolver.ts:247-251`, `analyzer/dependency-analyzer.ts`)
   - Macro usages are scanned but NOT resolved - `DeclarationIndex` doesn't index macros
   - **Impact:** Files using macros from other files won't have dependencies, compile order may be WRONG
   - **Fix:** Index macro definitions, resolve `macro_usage` references, add to `buildDependencies()`

---

## Medium Severity Issues

### 🟡 MEDIUM (Should Fix Eventually)

1. **Hierarchy matching only checks first scope** (`resolver/project-resolver.ts:454-456`)
2. **Duplicate adds cause inconsistent state** (`resolver/declaration-index.ts:68-90`)
3. **Duplicate files not deduplicated** (`recipe/filelist-parser.ts`)
4. **endLine not tracked** (`scanners/scope-tracker.ts:508-510`)
5. **identifyIdType duplicates logic** (`ids/declaration-id.ts:201-218`)
6. **PortConnection.location always invalid** (`types/instance.ts:297-320`)
7. **console.warn in library** (`recipe/filelist-parser.ts:270-272`)

---

## Fixed Issues ✅

1. ✅ **Cycle detection** - Both `project-resolver.ts` and `filelist-parser.ts` now have cycle detection
2. ✅ **parentScope always empty** - Now uses `getScope(loc.line)` correctly
3. ✅ **Unterminated block comment off-by-one** - Fixed in `comment-stripper.ts`
4. ✅ **HierarchyNode.isCyclic** - Added to type definition

---

## Overall Assessment

**Improvements:**
- ✅ Scope tracking significantly improved (`parentScope` now works!)
- ✅ Cycle detection added to resolver and recipe parser
- ✅ Comment stripper bug fixed
- ✅ Better architecture with `buildScopeLookup` approach

**Remaining Issues:**
- 🔴 Guard tracking broken (critical)
- 🟠 Scoped name resolution bugs
- 🟠 Include path order wrong
- 🟠 Scope lookup doesn't handle nesting correctly
- 🟠 Macro dependencies not resolved (compile order risk)

**SystemVerilog Limitations (Upstream):**
- `bind` statements not captured
- Configuration blocks not handled
- Interface modport dependencies implicit
- Generate conditionals not tracked
- Library mappings not resolved

**Recommendation:** Fix the critical guard tracking issue first, then address high-severity scoped name resolution, include path, and macro dependency issues.

---

## Priority Fix Order

1. **P0 (Critical):** Fix guard state passing to scanners
2. **P1 (High):** Fix scoped name resolution (multiple `::` segments)
3. **P1 (High):** Fix include path resolution order
4. **P1 (High):** Fix `buildScopeLookup` nested scope handling
5. **P1 (High):** Fix macro dependency tracking (index macros, resolve usages)
6. **P2 (Medium):** Fix hierarchy matching (full scope chain)
7. **P2 (Medium):** Deduplicate adds in declaration index

---

**Total Issues:** 2 Critical, 7 High, 7 Medium, 4 Low (+ 5 SV upstream limitations)
