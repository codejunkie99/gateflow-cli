# Security & Logic Audit: Types Module (RE-AUDIT)

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 1 | Missing `guard` field on Directive type |
| 🟡 Medium | 1 | `PortConnection.location` always invalid |
| 🟢 Low | 1 | `Guard.inverted` semantics unclear |

**Status:** ✅ HierarchyNode.isCyclic added! But Directive missing guard

---

## File: `directive.ts`

### 🟠 HIGH: Missing `guard` Field on Directive Type

**Location:** Lines 120-156

**Problem:**
All other entity types (`Declaration`, `Reference`, `Instance`) have `guard?: Guard`, but `Directive` does not. This is inconsistent.

**Impact:** Can't track which directives are conditionally compiled (inside `ifdef` blocks).

**Fix:** Add `guard?: Guard` to `Directive` interface.

---

## File: `instance.ts`

### 🟡 MEDIUM: `PortConnection.location` Always Invalid

**Location:** Lines 297-320

**Problem:**
```typescript
connections.push({
  portName,
  signalName,
  location: { file: '', line: 0, col: 0 }, // Would need proper location tracking
});
```

The comment says "Would need proper location tracking" but it's never implemented. All port connections have invalid locations.

**Impact:** Can't locate port connections in source code.

**Fix:** Track port connection locations during instance scanning.

---

## File: `location.ts`

### 🟢 LOW: `Guard.inverted` Semantics Unclear

**Location:** Lines 87-101

**Problem:**
Documentation doesn't clearly explain what `inverted: true` means. Is it:
- The condition itself is inverted (`!MACRO`)?
- The entire guard block is inverted (`ifndef` vs `ifdef`)?

**Impact:** Minor confusion, but code seems to use it correctly.

**Fix:** Add clearer documentation.

---

## File: `result.ts`

### ✅ VERIFIED CORRECT: `HierarchyNode.isCyclic` Added

**Location:** Lines 292-293

**Status:** The `isCyclic?: boolean` field has been added! This fixes the previous issue.

---

## Recommendations

1. **Add guard to Directive** - Make Directive consistent with other types
2. **Track port locations** - Implement proper location tracking for port connections
3. **Clarify Guard.inverted** - Improve documentation

---

## Summary

Most types are well-designed. The main issue is `Directive` missing the `guard` field, which breaks consistency with other entity types.
