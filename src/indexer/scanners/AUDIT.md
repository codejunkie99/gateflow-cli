# Security & Logic Audit: Scanners Module (RE-AUDIT)

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | ScopeTracker guards never populated in reference/instance scanners |
| 🟠 High | 1 | buildScopeLookup doesn't handle nested scopes correctly |
| 🟡 Medium | 2 | Unused ScopeTracker instances; endLine not tracked |
| 🟢 Low | 1 | ScopeTracker created but never used for scope |

**Status:** ✅ Scope tracking improved but guard tracking broken

---

## File: `scope-tracker.ts`

### 🟠 HIGH: `buildScopeLookup()` Doesn't Handle Nested Scopes Correctly

**Location:** Lines 524-546

**Problem:**
The lookup function doesn't properly handle nested scopes when `endLine` is 0 (unknown). It adds ALL scopes that start before the line, without checking:
1. If scopes are actually nested (parent-child relationship)
2. If a scope ends before the line (when endLine is known)
3. Scope hierarchy (should return `['outer', 'inner']` not `['outer', 'inner', 'sibling']`)

**Example:**
```typescript
// File has:
// Line 10: module outer;
// Line 20: module inner;
// Line 30: module sibling;

// At line 25, should return ['outer', 'inner']
// But current code returns ['outer', 'inner', 'sibling'] if endLine not set
```

**Impact:** Incorrect scope chains for references/instances, breaking name resolution.

**Fix:** Need to track scope nesting and only include scopes that actually contain the line.

---

### 🟡 MEDIUM: `endLine` Not Tracked in Declarations

**Location:** Lines 508-510

**Problem:**
The code tries to extract `endLine` from `decl.data`, but declaration scanner doesn't set `endLine` in the data. This means `endLine` is always 0, making scope lookup unreliable.

**Impact:** Without end lines, `buildScopeLookup` can't determine scope boundaries accurately.

**Fix:** Declaration scanner should track `endmodule`, `endclass`, etc. and set `endLine` in declaration data.

---

## File: `reference-scanner.ts`

### 🔴 CRITICAL: ScopeTracker Guards Never Populated

**Location:** Lines 91, 137, 175, 229, 259, 276, 293, 322

**Problem:**
```typescript
const scopeTracker = new ScopeTracker();  // Created fresh
// ... never populated with guards ...
const guard = scopeTracker.getGuard();  // Always returns undefined!
```

The `scopeTracker` is created but never populated with guard information. Guards are only tracked in `directive-scanner.ts`, but that tracker is not shared with `reference-scanner`.

**Impact:** All references have `guard: undefined` even when they're inside `ifdef` blocks. This breaks conditional compilation tracking.

**Fix:** Either:
1. Pass the directive scanner's `scopeTracker` to reference scanner, OR
2. Build a guard lookup function similar to `buildScopeLookup` from `ifdefState`

---

### 🟡 MEDIUM: Unused ScopeTracker Instance

**Location:** Line 91

**Problem:**
A `ScopeTracker` is created but only used for `getGuard()` calls (which always return undefined). The actual scope lookup uses `buildScopeLookup(declarations)`.

**Impact:** Dead code, wasted allocation.

**Fix:** Remove the unused `scopeTracker` and use only `getScope` from `buildScopeLookup`.

---

## File: `instance-scanner.ts`

### 🔴 CRITICAL: ScopeTracker Guards Never Populated

**Location:** Similar to reference-scanner

**Problem:**
Same issue as `reference-scanner.ts` - `scopeTracker` created but never populated with guards.

**Impact:** All instances have `guard: undefined` even when inside `ifdef` blocks.

**Fix:** Same as reference-scanner - share guard state from directive scanner.

---

### ✅ VERIFIED CORRECT: `parentScope` Now Uses `getScope()`

**Location:** Lines 157, 223, 256, 326, 364

**Status:** Fixed! `parentScope` now correctly uses `getScope(loc.line)` instead of empty array.

---

## File: `declaration-scanner.ts`

### ✅ VERIFIED CORRECT: ScopeTracker Used Correctly

**Location:** Lines 81-125

**Status:** Declaration scanner correctly uses `ScopeTracker` to track scope during scanning. Guards are also retrieved correctly (though they may be undefined if directive scanner hasn't run yet).

---

## File: `directive-scanner.ts`

### ✅ VERIFIED CORRECT: Guard Tracking Works

**Location:** Lines 296-322

**Status:** Directive scanner correctly tracks guards using `pushGuard()` and `popGuard()`. The `ifdefState` is also built correctly.

**Note:** The guard state is tracked but not shared with other scanners, causing the critical bug above.

---

## Cross-Module Issues

### 🔴 CRITICAL: Guard State Not Shared Across Scanners

**Problem:**
- `directive-scanner.ts` tracks guards in `scopeTracker` and builds `ifdefState`
- `reference-scanner.ts` and `instance-scanner.ts` create NEW `scopeTracker` instances
- Result: Guards are lost, all references/instances have `guard: undefined`

**Fix:**
1. Pass `ifdefState` from directive scanner to reference/instance scanners
2. Build a guard lookup function: `buildGuardLookup(ifdefState): (line: number) => Guard | undefined`
3. Use guard lookup instead of `scopeTracker.getGuard()`

---

## Recommendations

1. **Fix guard tracking** - Share guard state from directive scanner
2. **Fix scope nesting** - Improve `buildScopeLookup` to handle nested scopes correctly
3. **Track end lines** - Declaration scanner should track `endmodule`/`endclass` and set `endLine`
4. **Remove dead code** - Remove unused `scopeTracker` instances in reference/instance scanners

---

## Summary

The rewrite improved scope tracking significantly (`parentScope` now works!), but introduced a critical bug where guards are not tracked in references and instances. The `buildScopeLookup` approach is good but needs improvement for nested scopes.
