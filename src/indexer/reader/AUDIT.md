# Security & Logic Audit: Reader Module (RE-AUDIT)

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 1 | Encoding detection can cause hash instability |
| 🟡 Medium | 0 | No medium-severity issues |
| 🟢 Low | 2 | Unused constants; misleading terminology |

**Status:** ⚠️ Encoding detection still has hash stability issue

---

## File: `file-reader.ts`

### 🟠 HIGH: Encoding Detection Hash Instability

**Location:** Lines 293-314 (`readWithEncoding`)

**Problem:**
```typescript
// Try UTF-8
const content = buffer.toString('utf-8');
if (!content.includes('\ufffd')) {
  return { content, encoding: 'utf-8' };
}

// Fall back to Latin-1
const content = buffer.toString('latin1');
return { content, encoding: 'latin1' };
```

The same file can return different content strings (UTF-8 vs. Latin-1) if encoding detection is inconsistent, leading to different SHA-256 hashes. This breaks the stability of `FileRecord.hash`.

**Example:**
- File with mixed encoding: First read → UTF-8 → hash1
- Same file, second read → Latin-1 → hash2
- `hash1 !== hash2` even though file didn't change!

**Impact:** File change detection fails, files re-indexed unnecessarily.

**Fix:** Always hash the raw buffer directly, or normalize encoding before hashing.

---

### 🟢 LOW: Unused Constants

**Location:** Lines 30-35

**Problem:**
`SUPPORTED_ENCODINGS` and `DEFAULT_ENCODING` are declared but never used.

**Impact:** Dead code.

**Fix:** Remove unused constants or use them in encoding detection logic.

---

### 🟢 LOW: Misleading "Byte Offset" Terminology

**Location:** Comments throughout

**Problem:**
Comments refer to "byte offsets" but JavaScript strings use UTF-16 code units. While it works for ASCII, it's technically inaccurate for multi-byte characters.

**Impact:** Minor confusion, no functional impact for ASCII files.

**Fix:** Update comments to say "character offset" or "UTF-16 code unit offset".

---

## File: `line-index.ts`

### ✅ VERIFIED CORRECT: Line Index Building

**Status:** Line index building works correctly. The "byte offset" terminology is misleading but doesn't affect functionality.

---

## Recommendations

1. **Fix hash stability** - Hash raw buffer or normalize encoding before hashing
2. **Remove unused constants** - Clean up dead code
3. **Update terminology** - Clarify "byte offset" vs "character offset"

---

## Summary

The encoding detection hash instability issue remains. This can cause false positives in file change detection.
