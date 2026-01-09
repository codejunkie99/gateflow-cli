# Security & Logic Audit: Reader Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | - |
| 🟠 High | 1 | Encoding detection may flip-flop causing hash instability |
| 🟡 Medium | 2 | Dead code, misleading terminology |
| 🟢 Low | 2 | Unused constant, file ID instability |
| ℹ️ Info | 1 | Design note |

---

## File: `file-reader.ts`

### 🟠 HIGH: Encoding Detection Can Cause Hash Instability

**Location:** Lines 293-314 (`readWithEncoding`) + Line 322-324 (`computeHash`)

**Problem:**
The encoding detection relies on checking for `\ufffd` (replacement character):

```typescript
const content = buffer.toString('utf-8');
if (!content.includes('\ufffd')) {
  return { content, encoding: 'utf-8' };
}
// Fall back to Latin-1
const content = buffer.toString('latin1');
```

But hash computation always uses the string:
```typescript
function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
```

**Issue 1:** `buffer.toString('utf-8')` never throws - it replaces invalid bytes with `\ufffd`. The catch block (lines 307-309) is dead code.

**Issue 2:** If a file barely triggers the UTF-8 detection one time (no `\ufffd`) but triggers Latin-1 another time (has `\ufffd`), the hash will change even though the file didn't! This causes phantom "file changed" events.

**Issue 3:** `\ufffd` is a valid Unicode character. A file legitimately containing this character would incorrectly fall back to Latin-1.

**Impact:**
- Incremental indexing could re-index unchanged files
- Hash-based caching could miss hits

**Recommended Fix:**
```typescript
async function readWithEncoding(filePath: string): Promise<{ content: string; encoding: string }> {
  const buffer = await fs.readFile(filePath);
  
  // Always use UTF-8 - it handles all valid SV files
  // Invalid bytes become replacement chars, which is acceptable
  const content = buffer.toString('utf-8');
  
  // For hash stability, always hash the raw buffer
  return { content, encoding: 'utf-8', buffer };
}

function computeHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
```

---

### 🟡 MEDIUM: Dead Code - Catch Block Never Executes

**Location:** Lines 307-309

```typescript
try {
  const content = buffer.toString('utf-8');
  if (!content.includes('\ufffd')) {
    return { content, encoding: 'utf-8' };
  }
} catch {
  // UTF-8 failed, try Latin-1  ← THIS NEVER RUNS!
}
```

**Problem:** `Buffer.toString('utf-8')` does NOT throw on invalid UTF-8. It silently replaces invalid bytes with `\ufffd`. The catch block is unreachable.

**Fix:** Remove the try-catch or document why it's there.

---

### 🟢 LOW: Unused Constant

**Location:** Line 30

```typescript
const SUPPORTED_ENCODINGS: BufferEncoding[] = ['utf-8', 'latin1'];
```

**Problem:** This constant is defined but never used anywhere in the code.

**Fix:** Remove it or use it in the encoding detection logic.

---

### 🟢 LOW: File ID Changes When Content Changes

**Location:** Lines 335-340 (`generateFileId`)

```typescript
function generateFileId(filePath: string, contentHash: string): string {
  const input = `${filePath}:${contentHash}`;
  // ...
}
```

**Note:** File ID includes content hash, so it changes when file content changes. This may be intentional for content-addressable storage, but could be surprising for use cases expecting stable file identifiers.

**Recommendation:** Document this behavior or provide a separate `stableFileId(path)` function.

---

### ℹ️ INFO: `DEFAULT_ENCODING` Constant Unused

**Location:** Line 35

```typescript
const DEFAULT_ENCODING: BufferEncoding = 'utf-8';
```

Same as `SUPPORTED_ENCODINGS` - defined but not used.

---

## File: `line-index.ts`

### 🟡 MEDIUM: Misleading "Byte Offset" Terminology

**Location:** Throughout file (comments and function names)

**Problem:**
Comments refer to "byte offsets" but JavaScript strings use UTF-16 code units, not bytes:

```typescript
/**
 * Get the 1-based line number for a byte offset.  ← Misleading!
 */
export function getLineNumber(offsets: LineOffsets, byteOffset: number): number {
```

For ASCII content (most SV files), UTF-16 code units = bytes, so this works.
But for Unicode content:
- `'café'.length` = 4 (UTF-16 code units)
- Byte length (UTF-8) = 5 bytes
- Byte length (UTF-16) = 8 bytes

**Impact:** Low - regex match indices are also in UTF-16 code units, so consistency is maintained. But documentation is technically incorrect.

**Fix:** Update comments to say "character offset" or "string index" instead of "byte offset".

---

### ✅ Verified Correct: Binary Search

**Location:** Lines 117-134 (`getLineNumber`)

The binary search correctly finds the line containing a given offset:

```
Trace: offsets = [0, 7, 14], find offset 10
- lo=0, hi=2
- mid = ceil((0+2)/2) = 2
- offsets[2]=14 > 10 → hi=1
- mid = ceil((0+1)/2) = 1
- offsets[1]=7 ≤ 10 → lo=1
- lo=hi=1, exit
- return 1+1 = 2 ✓
```

---

### ✅ Verified Correct: Line Ending Handling

**Location:** Lines 55-79 (`buildLineIndex`)

Correctly handles:
- `\n` (Unix)
- `\r\n` (Windows) - skips the `\n` to avoid double-counting
- `\r` alone (Old Mac)

---

### ✅ Verified Correct: `extractLines`

**Location:** Lines 312-329

Edge cases verified:
- Last line without trailing newline: ✓
- Single line extraction: ✓
- Multi-line extraction: ✓
- Invalid range handling: ✓

---

## File: `index.ts`

### ✅ Clean

All exports correctly match their source definitions.

---

## Verified Correct ✅

| Component | Status | Notes |
|-----------|--------|-------|
| `readFile()` | ⚠️ | Hash stability concern |
| `readFiles()` | ✅ | Proper batch handling with allSettled |
| `checkFileChanged()` | ✅ | Correct mtime/size comparison |
| `checkHashChanged()` | ⚠️ | Affected by encoding issue |
| `buildLineIndex()` | ✅ | All line endings handled |
| `getLineNumber()` | ✅ | Binary search correct |
| `getColumnNumber()` | ✅ | Correct calculation |
| `getLocation()` | ✅ | Efficient combined lookup |
| `getLineOffset()` | ✅ | Correct boundary handling |
| `getLineRange()` | ✅ | Correct range calculation |
| `extractLines()` | ✅ | Correct edge case handling |
| `fileExists()` | ✅ | Proper async check |
| `isSystemVerilogFile()` | ✅ | Correct extensions |
| `isFilelistFile()` | ✅ | Correct extension |

---

## Test Cases to Add

```typescript
// 1. Encoding stability - same file should always get same hash
const r1 = await readFile('/path/with/unicode.sv');
const r2 = await readFile('/path/with/unicode.sv');
assert(r1.file.hash === r2.file.hash);  // Should ALWAYS be true

// 2. File with legitimate U+FFFD character
const content = 'module has_replacement \ufffd;\nendmodule';
// This should NOT trigger Latin-1 fallback

// 3. Line index with surrogate pairs (emoji)
const content = 'module 🎉;\nendmodule';
const offsets = buildLineIndex(content);
// offsets[1] should be correct for regex matches

// 4. Empty file handling
const { file } = await readFile('/path/to/empty.sv');
assert(file.lineCount === 1);  // Even empty file has "line 1"
assert(file.lineOffsets.length === 1);

// 5. Binary search edge cases
const offsets = [0, 10, 20];
assert(getLineNumber(offsets, 0) === 1);   // Exact line start
assert(getLineNumber(offsets, 9) === 1);   // End of line 1
assert(getLineNumber(offsets, 10) === 2);  // Start of line 2
assert(getLineNumber(offsets, 100) === 3); // Beyond content
assert(getLineNumber(offsets, -1) === 1);  // Negative offset
```

---

## Recommended Priority

1. **🟠 Fix encoding/hash stability** - Use buffer for hashing
2. **🟡 Remove dead code** - Delete unreachable catch block
3. **🟡 Fix documentation** - "character offset" not "byte offset"
4. **🟢 Clean up unused constants** - Remove SUPPORTED_ENCODINGS, DEFAULT_ENCODING

