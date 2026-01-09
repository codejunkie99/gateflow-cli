# Security & Logic Audit: Recipe Module (RE-AUDIT)

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 1 | Quoted paths include quotes |
| 🟡 Medium | 2 | Duplicate files not deduplicated; console.warn in library |
| 🟢 Low | 2 | Windows env vars not expanded; non-SV files ignored |

**Status:** ✅ Cycle detection fixed! But path parsing has issues

---

## File: `filelist-parser.ts`

### ✅ VERIFIED CORRECT: Cycle Detection Fixed

**Location:** Lines 152-166

**Status:** Cycle detection now works correctly with `_visitedFilelists` Set. Circular filelists are detected and handled gracefully.

---

### 🟠 HIGH: Quoted Paths Include Quotes

**Location:** Lines 236-242 (`+incdir` parsing)

**Problem:**
```typescript
const incdirMatch = line.match(/^\+incdir\+(.+)$/);
const incPath = this.resolvePath(incdirMatch[1], basePath);
```

If the filelist has `+incdir+"/path/to/dir"`, the regex captures `"/path/to/dir"` WITH quotes. The quotes are not stripped.

**Impact:** Include paths have quotes in them, causing file resolution to fail.

**Fix:** Strip quotes from captured path: `incdirMatch[1].replace(/^["']|["']$/g, '')`

---

### 🟡 MEDIUM: Duplicate Files Not Deduplicated

**Location:** Lines 304-306, 358 (`mergeRecipe`)

**Problem:**
If the same file appears multiple times in a filelist (or nested filelists), it's added multiple times to `recipe.files`.

**Impact:** Files compiled multiple times, wasted work.

**Fix:** Use a Set or check for duplicates before adding.

---

### 🟡 MEDIUM: `console.warn` in Library Code

**Location:** Lines 270-272

**Problem:**
Library code uses `console.warn` directly, which is not configurable and may not be desired in production.

**Impact:** Warnings always printed, can't be suppressed.

**Fix:** Use a logger interface or make warnings optional.

---

### 🟢 LOW: Windows `%VAR%` Environment Variables Not Expanded

**Location:** Lines 327-332 (`expandEnvVars`)

**Problem:**
Only handles `$VAR` and `${VAR}` (Unix style), not `%VAR%` (Windows style).

**Impact:** Windows environment variables not expanded on Windows.

**Fix:** Also handle `%VAR%` pattern.

---

### 🟢 LOW: Non-SV Files Silently Ignored

**Location:** Lines 303-306

**Problem:**
Files without `.sv`/`.svh`/`.v`/`.vh` extensions are silently skipped.

**Impact:** May miss files that should be compiled (e.g., `.svi`, custom extensions).

**Fix:** Make file extension check configurable or warn about skipped files.

---

## Recommendations

1. **Fix quoted paths** - Strip quotes from `+incdir` paths
2. **Deduplicate files** - Use Set or check for duplicates
3. **Replace console.warn** - Use logger interface
4. **Support Windows env vars** - Handle `%VAR%` syntax

---

## Summary

Cycle detection is fixed! But path parsing needs to handle quotes correctly, and file deduplication would improve robustness.
