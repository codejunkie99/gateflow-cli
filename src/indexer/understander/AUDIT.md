# Security & Logic Audit: Understander Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | ScopeTracker not shared - ROOT CAUSE of empty scopes |
| 🟠 High | 1 | Errors array always empty (no error reporting) |
| 🟡 Medium | 2 | Unused return values (ifdefState, commentMap) |
| 🟢 Low | 1 | Duplicate buildLineOffsets function |
| ℹ️ Info | 1 | Design observation |

**This module is the orchestrator - bugs here cascade to ALL scanners.**

---

## File: `file-understander.ts`

### 🔴 CRITICAL: ScopeTracker Not Shared Across Scanners

**Location:** Lines 107-141

**Problem:**
```typescript
// Step 4: Scan Directives
const scopeTracker = new ScopeTracker();
const { directives, ifdefState } = scanDirectives(
  cleaned, filePath, file.lineOffsets, scopeTracker
);
// scopeTracker now has GUARD state (ifdef/ifndef)

// Step 5: Scan Declarations
const { declarations } = scanDeclarations(cleaned, filePath, file.lineOffsets);
// ❌ NO scopeTracker passed! Creates its own internally.

// Step 6: Scan References
const { references } = scanReferences(
  cleaned, filePath, file.lineOffsets, declarations
);
// ❌ NO scopeTracker passed! Creates empty one internally.

// Step 7: Scan Instances
const { instances } = scanInstances(
  cleaned, filePath, file.lineOffsets, declarations
);
// ❌ NO scopeTracker! No scope tracking at all.
```

**Impact:** This is the **ROOT CAUSE** of all scope-related bugs identified in the scanners audit:
- References have `scope: []` (always empty)
- Instances have `parentScope: []` (always empty)  
- Guard conditions are not propagated
- Hierarchy building fails in project-resolver

**The Fix:**

```typescript
// Step 4: Scan Directives (populates guard state)
const scopeTracker = new ScopeTracker();
const { directives, ifdefState } = scanDirectives(
  cleaned, filePath, file.lineOffsets, scopeTracker
);

// Step 5: Scan Declarations (needs to track scope entries)
// Reset guards but pass tracker to populate scope stack
scopeTracker.reset();  // Clear guards from directive pass
const { declarations } = scanDeclarations(
  cleaned, filePath, file.lineOffsets, scopeTracker  // PASS IT!
);

// Step 6: Scan References (needs scope for resolution)
// Don't reset - references need the scope state from declarations
const { references } = scanReferences(
  cleaned, filePath, file.lineOffsets, declarations, scopeTracker  // PASS IT!
);

// Step 7: Scan Instances (needs scope for parentScope)
const { instances } = scanInstances(
  cleaned, filePath, file.lineOffsets, declarations, scopeTracker  // PASS IT!
);
```

**Required Scanner Changes:**
1. `scanDeclarations()` - Accept optional `ScopeTracker` parameter
2. `scanReferences()` - Accept optional `ScopeTracker` parameter
3. `scanInstances()` - Accept optional `ScopeTracker` parameter

---

### 🟠 HIGH: Errors Array Always Empty

**Location:** Lines 88, 157-165

**Problem:**
```typescript
async understand(filePath: string): Promise<FileUnderstanderResult> {
  const errors: ParseError[] = [];  // Created but...
  
  // ... ALL STEPS ...
  
  // NOTHING EVER PUSHES TO errors!
  
  return {
    ...
    errors,  // Always []
  };
}
```

**Impact:**
- Parse errors are silently swallowed
- Users can't know if parsing was incomplete
- No warnings for malformed constructs

**Fix:** Collect errors from each scanner:

```typescript
async understand(filePath: string): Promise<FileUnderstanderResult> {
  const errors: ParseError[] = [];
  
  // Each scanner should return errors
  const { directives, ifdefState, errors: directiveErrors } = scanDirectives(...);
  errors.push(...directiveErrors);
  
  const { declarations, errors: declErrors } = scanDeclarations(...);
  errors.push(...declErrors);
  
  // etc.
}
```

**Required Changes:**
1. Each scanner needs to return `errors: ParseError[]`
2. Or create a shared error collector passed to all scanners

---

### 🟡 MEDIUM: `ifdefState` Returned But Never Used

**Location:** Lines 108-113

**Problem:**
```typescript
const { directives, ifdefState } = scanDirectives(...);
// ifdefState is NEVER used!
```

**Purpose of ifdefState:** It contains a map from line numbers to active guard conditions. This should be used to:
- Attach guards to declarations/references/instances
- Filter entities based on compile configuration

**Fix:** Pass `ifdefState` to subsequent scanners or use it when building guards:

```typescript
const { directives, ifdefState } = scanDirectives(...);

// Use ifdefState to add guards to entities
const { declarations } = scanDeclarations(cleaned, filePath, lineOffsets, ifdefState);
```

---

### 🟡 MEDIUM: `commentMap` Returned But Never Used

**Location:** Line 101

**Problem:**
```typescript
const { cleaned, commentMap } = preprocess(content);
// commentMap is NEVER used!
```

**Purpose of commentMap:** Contains positions of all comments. Could be used for:
- Documentation extraction (doc comments)
- Preserving comment locations in output
- Comment-aware error messages

**Assessment:** May be intentionally unused for now. Consider removing from destructure if not needed, or implement doc comment extraction.

---

### 🟢 LOW: Duplicate `buildLineOffsets` Function

**Location:** Lines 321-338

**Problem:**
```typescript
function buildLineOffsets(content: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      offsets.push(i + 1);
    } else if (content[i] === '\r') {
      // ...
    }
  }
  return offsets;
}
```

But `reader/line-index.ts` already exports `buildLineIndex()` which does the same thing!

**Fix:** Use the existing function:
```typescript
import { buildLineIndex } from '../reader/index.js';

// In understandContent:
const lineOffsets = buildLineIndex(content);
```

---

### ℹ️ INFO: Pipeline Order is Correct

The 7-step pipeline is properly ordered:
1. Read (must be first)
2. Line continuation (before comment stripping)
3. Comments (before scanning)
4. Directives (first scan - sets up guards)
5. Declarations (core entities)
6. References (uses declarations)
7. Instances (uses declarations)

The order is correct; the issue is lack of data sharing between steps.

---

## File: `index.ts`

### ✅ VERIFIED CORRECT

Clean re-exports, good documentation.

---

## Impact Analysis

### Cascade Effect of Missing ScopeTracker

```
┌─────────────────────────────────────────────────────────────┐
│ file-understander.ts: ScopeTracker not shared               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ reference-scanner.ts: Creates empty ScopeTracker            │
│ → All references have scope: []                             │
│ → All references have guard: undefined                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ instance-scanner.ts: No ScopeTracker at all                 │
│ → All instances have parentScope: []                        │
│ → All instances have guard: undefined                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ project-resolver.ts: buildHierarchyNode()                   │
│ → Filters by parentScope[0] === module.name                 │
│ → NOTHING MATCHES because parentScope is []                 │
│ → Hierarchy tree is EMPTY or WRONG                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Users: Hierarchy, "find usages", scoped resolution BROKEN   │
└─────────────────────────────────────────────────────────────┘
```

---

## Recommended Fix Strategy

### Option A: Pass ScopeTracker Through Pipeline (Recommended)

```typescript
async understand(filePath: string): Promise<FileUnderstanderResult> {
  const errors: ParseError[] = [];
  const { file, content } = await readFile(filePath);
  const { cleaned, commentMap } = preprocess(content);
  
  // Create shared tracker
  const scopeTracker = new ScopeTracker();
  
  // Step 4: Directives (populates guards)
  const { directives, ifdefState } = scanDirectives(
    cleaned, filePath, file.lineOffsets, scopeTracker
  );
  
  // Step 5: Declarations (uses shared tracker for scope)
  // Note: declaration-scanner already handles scope internally,
  // but we could unify this
  const { declarations } = scanDeclarations(
    cleaned, filePath, file.lineOffsets
  );
  
  // Build scope map from declarations for other scanners
  const scopeMap = buildScopeMap(declarations, file.lineOffsets);
  
  // Step 6: References (uses scope map)
  const { references } = scanReferences(
    cleaned, filePath, file.lineOffsets, declarations, scopeMap, ifdefState
  );
  
  // Step 7: Instances (uses scope map)
  const { instances } = scanInstances(
    cleaned, filePath, file.lineOffsets, declarations, scopeMap, ifdefState
  );
  
  // ...
}
```

### Option B: Two-Pass Approach

1. First pass: Extract all scope boundaries (module/endmodule, etc.)
2. Build scope map: For any byte offset, determine active scope
3. Second pass: Scan all entities, look up scope from map

---

## Test Cases to Add

```typescript
// 1. Scope tracking through pipeline
const result = await understander.understand('nested.sv');
// nested.sv contains: module m; class c; function f(); endfunction endclass endmodule

const func = result.declarations.find(d => d.name === 'f');
assert.deepEqual(func.scope, ['m', 'c']);  // Currently: []

const ref = result.references.find(r => r.kind === 'type_usage');
assert(ref.scope.length > 0);  // Currently: [] always

const inst = result.instances[0];
assert(inst.parentScope.length > 0);  // Currently: [] always

// 2. Error collection
const result = await understander.understand('malformed.sv');
assert(result.errors.length > 0);  // Currently: always 0

// 3. Guard propagation
// File with: `ifdef DEBUG \n module m; endmodule \n `endif
const result = await understander.understand('guarded.sv');
const mod = result.declarations.find(d => d.name === 'm');
assert(mod.guard?.condition === 'DEBUG');  // Currently: works
// But references/instances inside should also have guard
```

---

## Recommended Priority

1. **🔴 Share ScopeTracker across scanners** - Fixes hierarchy, scoped resolution
2. **🟠 Implement error collection** - Users need feedback on parse issues
3. **🟡 Use ifdefState for guard propagation** - Complete conditional compilation tracking
4. **🟢 Remove duplicate buildLineOffsets** - Code cleanup

