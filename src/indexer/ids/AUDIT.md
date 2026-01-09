# Security & Logic Audit: IDs Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | - |
| 🟠 High | 1 | Logic duplication bug in `identifyIdType()` |
| 🟡 Medium | 2 | Missing input validation, constant duplication |
| 🟢 Low | 1 | Potential collision probability (acceptable) |
| ℹ️ Info | 2 | Documentation notes |

---

## File: `declaration-id.ts`

### 🟠 HIGH: `identifyIdType()` Duplicates Location ID Logic

**Location:** Lines 201-218

**Problem:**
```typescript
// This duplicates isLocationId() logic instead of importing it!
if (id.startsWith('loc:') && id.length === 4 + HASH_LENGTH) {
  const hash = id.slice(4);
  if (/^[0-9a-f]+$/.test(hash)) {
    return { valid: true, type: 'location' };
  }
}
```

**Impact:**
- If `isLocationId()` in `location-id.ts` is modified, this function will NOT be updated
- Violates DRY (Don't Repeat Yourself) principle
- Could cause silent bugs where `isLocationId()` returns different result than `identifyIdType()`

**Fix Required:**
```typescript
// At top of file, add:
import { isLocationId } from './location-id.js';

// Replace lines 209-215 with:
if (isLocationId(id)) {
  return { valid: true, type: 'location' };
}
```

---

### 🟡 MEDIUM: Constant Duplication Across Files

**Location:** 
- `location-id.ts` line 37: `const HASH_LENGTH = 16;`
- `declaration-id.ts` line 55: `const HASH_LENGTH = 16;`

**Problem:**
Both files independently define `HASH_LENGTH`. If one changes, the other won't.

**Impact:**
- `identifyIdType()` uses `declaration-id.ts`'s `HASH_LENGTH` for location ID validation
- If `location-id.ts` changes its hash length, `identifyIdType()` breaks silently

**Recommended Fix:**
Create a shared constants file:
```typescript
// src/indexer/ids/constants.ts
export const HASH_LENGTH = 16;
export const LOCATION_ID_PREFIX = 'loc:';
export const DECLARATION_ID_PREFIX = 'decl:';
```

---

### 🟡 MEDIUM: No Input Validation

**Location:** 
- `declarationId()` lines 105-129
- `locationId()` lines 71-85

**Problem:**
Functions accept invalid inputs without validation:

```typescript
// These all produce valid-looking IDs:
declarationId('', '', '', []);           // Empty everything
declarationId('file.sv', 'module', '', []); // Empty name
locationId('', -1, -999);                 // Negative line/col
locationId('file.sv', 0, 0);              // Zero line/col (invalid - 1-based)
```

**Impact:**
- Garbage in = valid-looking garbage out
- No way to detect invalid IDs after generation
- Could mask bugs in calling code

**Recommended Fix:**
```typescript
export function locationId(file: string, line: number, col: number): string {
  // Validate inputs
  if (!file || file.trim() === '') {
    throw new Error('locationId: file path cannot be empty');
  }
  if (line < 1 || !Number.isInteger(line)) {
    throw new Error(`locationId: line must be positive integer, got ${line}`);
  }
  if (col < 1 || !Number.isInteger(col)) {
    throw new Error(`locationId: col must be positive integer, got ${col}`);
  }
  
  // ... rest of function
}
```

---

## File: `location-id.ts`

### 🟢 LOW: Collision Probability

**Location:** Lines 77-81 (hash generation)

**Analysis:**
- Using 16 hex chars = 64 bits of SHA-256
- Birthday paradox: 50% collision chance at ~2^32 = 4 billion IDs
- For typical codebases (<100M locations), collision probability is < 10^-9

**Verdict:** Acceptable for practical use. No action required.

---

### ℹ️ INFO: Colon Separator in File Paths

**Location:** Line 74

```typescript
const input = `${file}:${line}:${col}`;
```

**Note:** On Windows, file paths contain colons (e.g., `C:\path\file.sv`).
The comment "unlikely to appear in file paths" is incorrect for Windows.

**Impact:** None - we hash the full string, not parse it. Same input always gives same output.

**Documentation Fix:** Update comment:
```typescript
// Build the input string that uniquely identifies this location
// Note: Colons may appear in Windows paths, but since we hash the entire
// string (not parse it), this doesn't affect correctness.
const input = `${file}:${line}:${col}`;
```

---

## File: `index.ts`

### ℹ️ INFO: `identifyIdType` Placement

**Location:** Line 74

**Note:** `identifyIdType()` is exported from `declaration-id.js` but handles both declaration AND location IDs. Logically, it should either:
1. Be in a shared module, OR
2. Import `isLocationId` from location-id.js (as noted in the 🟠 HIGH issue above)

---

## Verified Correct ✅

| Component | Status | Notes |
|-----------|--------|-------|
| SHA-256 hash algorithm | ✅ | Cryptographically secure |
| Hex encoding | ✅ | Consistent lowercase |
| Prefix format (`loc:`, `decl:`) | ✅ | Easy type identification |
| `isLocationId()` | ✅ | Correct validation logic |
| `isDeclarationId()` | ✅ | Correct validation logic |
| `extractLocationHash()` | ✅ | Correct extraction |
| `extractDeclarationHash()` | ✅ | Correct extraction |
| Export structure | ✅ | All exports match sources |

---

## Test Cases to Add

### Critical Test Cases

```typescript
// 1. identifyIdType consistency with isLocationId
const locId = locationId('/test.sv', 1, 1);
assert(isLocationId(locId) === true);
assert(identifyIdType(locId).type === 'location');  // Should match!

// 2. Empty input handling (currently produces valid IDs - decide if this is OK)
const emptyId = declarationId('', '', '', []);
// Should this throw? Currently doesn't.

// 3. Invalid line/col (currently produces valid IDs)
const badLocId = locationId('file.sv', -1, 0);
// Should this throw? Currently doesn't.

// 4. Scope edge cases
const scopeId1 = declarationId('f.sv', 'module', 'x', ['a', 'b']);
const scopeId2 = declarationId('f.sv', 'module', 'x', ['a::b']);
// These SHOULD be different (different scope structures)
// Current: scopeStr = 'a::b' for both - BUG? 
// Actually ['a::b'].join('::') = 'a::b', not 'a::::b'
// But SV identifiers can't contain '::', so this is OK.

// 5. Unicode in file paths
const unicodeId = locationId('/путь/файл.sv', 1, 1);
// Should work - SHA-256 handles UTF-8
```

---

## Recommended Priority

1. **🟠 Fix `identifyIdType()` to use `isLocationId()`** - Easy fix, prevents silent divergence
2. **🟡 Add input validation** - Prevents garbage-in-garbage-out
3. **🟡 Extract shared constants** - Reduces maintenance burden
4. **🟢 Update comments about colons** - Documentation accuracy

