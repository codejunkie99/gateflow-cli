# Security & Logic Audit: IDs Module (RE-AUDIT)

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 0 | No high-severity issues |
| 🟡 Medium | 1 | `identifyIdType()` duplicates location ID logic |
| 🟢 Low | 1 | No input validation |

**Status:** ✅ Mostly clean, minor duplication issue

---

## File: `declaration-id.ts`

### 🟡 MEDIUM: `identifyIdType()` Duplicates Location ID Logic

**Location:** Lines 201-218

**Problem:**
```typescript
export function identifyIdType(id: string): {...} {
  if (isDeclarationId(id)) {
    return { valid: true, type: 'declaration' };
  }

  // Check for location ID format - DUPLICATES logic from location-id.ts!
  if (id.startsWith('loc:') && id.length === 4 + HASH_LENGTH) {
    const hash = id.slice(4);
    if (/^[0-9a-f]+$/.test(hash)) {
      return { valid: true, type: 'location' };
    }
  }
  ...
}
```

This duplicates the location ID validation logic that exists in `location-id.ts`. Should import and use `isLocationId()` instead.

**Impact:** Code duplication, maintenance risk if location ID format changes.

**Fix:** Import `isLocationId` from `./location-id.js` and use it.

---

### 🟢 LOW: No Input Validation

**Location:** Lines 105-129 (`declarationId` function)

**Problem:**
Accepts empty strings for `file`, `kind`, `name`, or `scope`, which could lead to unexpected ID generation.

**Impact:** Edge case - empty inputs generate valid but meaningless IDs.

**Fix:** Add validation or document that empty strings are allowed.

---

## File: `location-id.ts`

### ✅ VERIFIED CORRECT: Location ID Generation

**Status:** Location ID generation works correctly.

---

## Recommendations

1. **Fix duplication** - Use `isLocationId()` in `identifyIdType()`
2. **Add validation** - Document or validate empty string inputs

---

## Summary

Minor code duplication issue. Otherwise clean.
