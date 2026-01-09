# Security & Logic Audit: Preprocessor Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | Unterminated block comment loses last character |
| 🟠 High | 0 | - |
| 🟡 Medium | 2 | Inconsistent `\r` handling, missing edge case |
| 🟢 Low | 1 | No input validation |
| ℹ️ Info | 2 | Documentation notes |

---

## File: `comment-stripper.ts`

### 🔴 CRITICAL: Unterminated Block Comment Off-By-One Error

**Location:** Lines 137-148

**Problem:**
```typescript
// Find closing */
while (i < content.length - 1) {  // ⚠️ Loop exits too early!
  if (content[i] === '*' && content[i + 1] === '/') {
    i += 2;
    break;
  }
  i++;
}

// Handle unterminated block comment
if (i >= content.length) {  // ⚠️ This condition fails to trigger!
  i = content.length;
}
```

**Trace Example:**
```
content = "/*abc" (length 5, indices 0-4)
start = 0
i = 2 (after /*)

While loop iterations:
- i=2: 2 < 4 ✓, 'a'!='*', i++ → i=3
- i=3: 3 < 4 ✓, 'b'!='*', i++ → i=4
- i=4: 4 < 4 ✗, EXIT LOOP

Check: i >= content.length → 4 >= 5 → FALSE
Comment recorded as [0, 4) - MISSING index 4 ('c')!
```

**Impact:**
- Last character of unterminated block comment is left in output
- Could cause false positives in parsing (seeing code that's actually commented)
- Regex patterns might match inside what should be a comment

**Fix:**
```typescript
// Find closing */
while (i < content.length) {  // Changed: removed -1
  if (i + 1 < content.length && content[i] === '*' && content[i + 1] === '/') {
    i += 2;
    break;
  }
  i++;
}
// The unterminated check is now unnecessary since loop goes to end
```

**Alternative Fix (minimal change):**
```typescript
// Handle unterminated block comment
if (i >= content.length - 1) {  // Changed: -1 added
  i = content.length;
}
```

---

### 🟡 MEDIUM: Missing Single-Quote Escape in Strings

**Location:** Lines 168-197 (string handling)

**Note:** The current code handles `\"` escapes but not `\'`. While SystemVerilog doesn't have single-quoted string literals, escape sequences like `\'` can appear in double-quoted strings and should be handled.

**Current Code:**
```typescript
if (content[i] === '\\' && i + 1 < content.length) {
  // Escape sequence - copy both characters
  chars.push(content[i]);
  chars.push(content[i + 1]);
  i += 2;
}
```

**Status:** Actually OK - this handles ALL escape sequences generically, including `\'`. No fix needed.

---

### 🟢 LOW: No Validation of Empty Input

**Location:** Line 94

**Problem:**
```typescript
export function stripComments(content: string, preserveText = false): StripCommentsResult {
  // No check if content is null/undefined
```

**Impact:** Will crash on null/undefined input (TypeScript guards at compile time, but runtime JS doesn't).

**Recommended Fix:**
```typescript
export function stripComments(content: string, preserveText = false): StripCommentsResult {
  if (!content) {
    return { cleaned: '', commentMap: { ranges: [], totalChars: 0 } };
  }
  // ... rest
}
```

---

## File: `line-continuation.ts`

### 🟡 MEDIUM: Inconsistent `\r` Handling Between Functions

**Location:** 
- `handleLineContinuation()` - Lines 124-137 (handles `\r`)
- `handleLineContinuationSimple()` - Line 185 (does NOT handle `\r`)

**Problem:**
```typescript
// Main function handles all three line endings:
// - \n (Unix)
// - \r\n (Windows)  
// - \r (Old Mac)

// But simple version only handles two:
export function handleLineContinuationSimple(content: string): string {
  return content.replace(/\\\r?\n/g, ' ');  // ⚠️ Doesn't handle \\\r alone!
}
```

**Impact:** Old Mac files processed with `Simple` version will have different results than the main function.

**Fix:**
```typescript
export function handleLineContinuationSimple(content: string): string {
  // Handle all three: \\\r\n, \\\n, \\\r
  return content.replace(/\\(\r\n|\r|\n)/g, ' ');
}
```

---

### ℹ️ INFO: `getOriginalLineNumber` Complexity

**Location:** Lines 229-244

**Analysis:** The algorithm is correct but has O(n) complexity where n = number of continuations. For files with many continuations, this could be slow if called frequently.

**Current Logic (verified correct):**
```typescript
export function getOriginalLineNumber(
  continuations: LineContinuation[],
  processedLine: number
): number {
  let offset = 0;
  for (const cont of continuations) {
    if (cont.originalLine < processedLine + offset) {
      offset++;
    }
  }
  return processedLine + offset;
}
```

**Trace verification:**
```
Original:        Processed:
Line 1: a \      Line 1: a   b
Line 2:   b      
Line 3: c        Line 2: c

Query: getOriginalLineNumber([{originalLine:1}], 2)
- offset=0
- cont.originalLine(1) < processedLine+offset(2) → true → offset=1
- return 2+1 = 3 ✓
```

**Verdict:** Logic is correct. Consider caching for performance-critical paths.

---

### ℹ️ INFO: `countPhysicalLines` Edge Case

**Location:** Lines 259-275

**Note:** Function doesn't handle CRLF continuation markers:
```typescript
if (line.endsWith('\\')) {  // Works for \n files
  // ...
}
```

If file has CRLF endings, `line` after split might be `"text\\\r"` which doesn't end with just `\\`.

**Status:** The `split(/\r?\n/)` handles this correctly - it splits ON the line ending, so `line` won't include `\r`. Verified OK.

---

## File: `index.ts`

### ✅ Clean

All exports match their sources. The `preprocess()` function correctly chains:
1. Line continuation handling
2. Comment stripping

---

## Verified Correct ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Line comment detection (`//`) | ✅ | Correctly handles to EOL |
| Block comment detection (`/*`) | ⚠️ | Off-by-one on unterminated |
| String literal preservation | ✅ | Handles `\"` and all escapes |
| Newline preservation in comments | ✅ | Keeps `\n` and `\r` |
| Windows CRLF handling | ✅ | Both functions handle `\r\n` |
| Unix LF handling | ✅ | Both functions handle `\n` |
| Old Mac CR handling | ⚠️ | Main function yes, Simple no |
| Line number tracking | ✅ | Correct in both modules |
| `isInComment()` | ✅ | Correct range check |
| `restoreComments()` | ✅ | Correct reverse iteration |
| Export structure | ✅ | All exports match sources |

---

## Test Cases to Add

### Critical Test Cases

```typescript
// 1. Unterminated block comment - last char should be in comment
const { cleaned } = stripComments('code /* unterminated');
assert(cleaned === 'code                ');  // All spaces after 'code '

// 2. Block comment at exact end of file
const { cleaned: c2 } = stripComments('a /* b */');
assert(c2 === 'a         ');

// 3. Nested comment markers in line comment
const { cleaned: c3 } = stripComments('a // b /* c */ d\ne');
assert(c3 === 'a                \ne');

// 4. \r line continuation (Old Mac)
const { processed } = handleLineContinuation('a\\\rb');
assert(processed === 'a b');
const simple = handleLineContinuationSimple('a\\\rb');
// CURRENT BUG: simple === 'a\\\rb' (not handled)
// AFTER FIX: simple === 'a b'

// 5. Mixed line endings
const { processed: p2 } = handleLineContinuation('a\\\nb\\\r\nc\\\rd');
assert(p2 === 'a b c d');

// 6. Empty input
const { cleaned: empty } = stripComments('');
assert(empty === '');
```

---

## Recommended Priority

1. **🔴 Fix unterminated block comment off-by-one** - Can cause parsing errors
2. **🟡 Fix `handleLineContinuationSimple` for `\r`** - Consistency
3. **🟢 Add empty input validation** - Defensive programming

