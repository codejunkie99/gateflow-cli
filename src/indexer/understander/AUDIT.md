# Security & Logic Audit: Understander Module

**Date:** January 10, 2026
**Auditor:** Code Review
**Severity Scale:** Critical | High | Medium | Low | Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 0 | No critical issues |
| High | 0 | No high-severity issues |
| Medium | 0 | No medium-severity issues |
| Low | 0 | No low-severity issues |

**Status:** Clean - Two-parser architecture working correctly

---

## Architecture Overview

The `FileUnderstander` uses a **two-parser architecture**:

```
understand(filePath)
       │
       ├─── Promise.all() ───┐
       │                     │
       ▼                     ▼
    Slang                 Verible
  (primary)            (directives)
       │                     │
       │ declarations        │ directives
       │ references          │
       │ instances           │
       │                     │
       └─────── merge ───────┘
                │
                ▼
           Result
```

### Parser Responsibilities

| Component | Source | Why |
|-----------|--------|-----|
| Declarations | Slang (fallback: Verible) | Better semantic analysis |
| References | Slang (fallback: Verible) | Full symbol resolution |
| Instances | Slang (fallback: Verible) | Evaluates generate blocks |
| Directives | Verible only | Slang evaluates but doesn't report directives |

---

## File: `file-understander.ts`

### Verified Correct: Parallel Parser Execution

**Location:** Lines 125-164

**Implementation:**
```typescript
const [slangResult, veribleResult] = await Promise.allSettled([
  this.parseWithSlang(filePath),
  this.parseWithVerible(filePath),
]);
```

**Verification:**
- Both parsers run in parallel for performance
- `Promise.allSettled` handles failures gracefully
- Slang failure falls back to Verible data
- Verible failure throws clear error (required for directives)

---

### Verified Correct: Graceful Fallback

**Location:** Lines 146-164

**Implementation:**
```typescript
return {
  declarations: slang?.declarations ?? verible.declarations,
  references: slang?.references ?? verible.references,
  instances: slang?.instances ?? verible.instances,
  directives: verible.directives,  // Always from Verible
  // ...
};
```

**Verification:**
- Slang results preferred when available
- Falls back to Verible if Slang unavailable or fails
- Directives always from Verible (only source)

---

### Verified Correct: Error Handling

**Location:** Lines 136-144, 224-227

**Verification:**
- Verible failure throws descriptive error with install instructions
- Slang failure silently falls back (returns null)
- Slang diagnostics converted to standard error format

---

## File: `index.ts`

### Verified Correct: Exports

**Status:** All exports are correct.

---

## Security Considerations

1. **Binary Execution:** Both Slang and Verible are executed as subprocesses
   - Binaries auto-download from GitHub releases
   - No user input passed to command line (file paths only)
   - Timeouts configured to prevent hangs

2. **File Access:** Only reads files specified by user
   - No arbitrary file access
   - Paths validated by parser binaries

---

## Summary

The understander correctly orchestrates the two-parser architecture with proper fallback behavior and error handling. No security or logic issues identified.
