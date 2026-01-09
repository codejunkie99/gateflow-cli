# Security & Logic Audit: Understander Module (RE-AUDIT)

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | Guard state not passed to reference/instance scanners |
| 🟠 High | 0 | No high-severity issues |
| 🟡 Medium | 1 | `ifdefState` returned but never used |
| 🟢 Low | 1 | Duplicate `buildLineOffsets` function |

**Status:** ✅ Improved but guard state not shared

---

## File: `file-understander.ts`

### 🔴 CRITICAL: Guard State Not Passed to Scanners

**Location:** Lines 108-141

**Problem:**
```typescript
const { directives, ifdefState } = scanDirectives(..., scopeTracker);
// ifdefState contains guard information

const { references } = scanReferences(..., declarations);
// No guard state passed! References will have guard: undefined

const { instances } = scanInstances(..., declarations);
// No guard state passed! Instances will have guard: undefined
```

The `ifdefState` from directive scanning is not passed to reference or instance scanners. This means guards are lost.

**Impact:** All references and instances have `guard: undefined` even when inside `ifdef` blocks, breaking conditional compilation tracking.

**Fix:** Pass `ifdefState` to `scanReferences` and `scanInstances`, or build a guard lookup function and pass it.

---

### 🟡 MEDIUM: `ifdefState` Returned But Never Used

**Location:** Lines 108, 163

**Problem:**
`ifdefState` is returned from `scanDirectives` but never used in the result or passed to other scanners.

**Impact:** Dead code, wasted computation.

**Fix:** Either use it (pass to scanners) or remove it from the return value.

---

### 🟢 LOW: Duplicate `buildLineOffsets` Function

**Location:** Lines 321-338

**Problem:**
`buildLineOffsets` duplicates functionality from `reader/line-index.ts`. Should use `buildLineIndex` instead.

**Impact:** Code duplication, maintenance burden.

**Fix:** Import and use `buildLineIndex` from `reader/line-index.js`.

---

## File: `index.ts`

### ✅ VERIFIED CORRECT: Exports

**Status:** All exports are correct.

---

## Recommendations

1. **Fix guard passing** - Pass `ifdefState` or guard lookup to reference/instance scanners
2. **Remove duplicate** - Use `buildLineIndex` instead of `buildLineOffsets`
3. **Use or remove** - Either use `ifdefState` or remove it from return value

---

## Summary

The understander correctly orchestrates the scanning pipeline, but fails to pass guard state to reference and instance scanners, causing the critical guard tracking bug.
