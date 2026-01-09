# Code Review: Analyzer Module

**Date:** January 9, 2026  
**Files Reviewed:**
- `dependency-analyzer.ts`
- `hierarchy-builder.ts`
- `index.ts`

---

## Summary

| File | Status | Issues Found |
|------|--------|--------------|
| `dependency-analyzer.ts` | ⚠️ Minor Issues | 2 |
| `hierarchy-builder.ts` | ✅ Clean | 0 |
| `index.ts` | ✅ Clean | 0 |

---

## `dependency-analyzer.ts`

### Issue 1: Unused Import (Low Severity)

**Location:** Line 15

```typescript
import type { FileDependency, FileRecord } from '../types/index.js';
```

**Problem:** `FileRecord` is imported but never used in this file.

**Fix:** Remove unused import:
```typescript
import type { FileDependency } from '../types/index.js';
```

---

### Issue 2: Cycle Detection Continues After Finding Cycle (Medium Severity)

**Location:** Lines 305-355 (`detectCycles()` method)

**Problem:** When a cycle is detected, the algorithm adds it to the `cycles` array but does **not** return early. This causes:
1. Potential duplicate/overlapping cycles in complex graphs
2. Unnecessary continued traversal

**Current Code:**
```typescript
} else if (recStack.has(dep)) {
  // Found a cycle
  const cycleStart = path.indexOf(dep);
  const cyclePath = path.slice(cycleStart);
  cyclePath.push(dep);
  
  // ... builds cycle ...
  
  cycles.push({
    files: cyclePath,
    edges: cycleEdges,
  });
  // ⚠️ No return here - continues processing
}
```

**Note:** This may be intentional if you want to find ALL cycles. If only detecting presence of cycles matters, consider returning early for performance.

---

### Verified Correct: `getCompileOrder()` Algorithm

The Kahn's algorithm implementation is **correct**:

1. **In-degree calculation:** Files that are depended upon get higher in-degree
2. **Queue initialization:** Files with no dependencies (in-degree 0) start first
3. **Processing:** Decrements in-degree as dependencies are "satisfied"
4. **Reverse at end:** Correctly produces dependencies-first compile order

**Trace Example:**
```
A depends on B, B depends on C

Initial in-degree: A=0, B=1, C=1
Queue: [A]

Step 1: Pop A → result=[A], decrement B to 0, queue=[B]
Step 2: Pop B → result=[A,B], decrement C to 0, queue=[C]
Step 3: Pop C → result=[A,B,C]

Reverse: [C, B, A] ✓ (C first, then B, then A)
```

---

## `hierarchy-builder.ts`

### Status: ✅ No Issues Found

**Verified Correct:**

1. **`getNodeDepth()`** - Handles empty children with early return
2. **`getHierarchyStats()`** - Uses `Math.max(...[], 0)` for empty hierarchy edge case
3. **`findModuleInHierarchy()`** - Correctly finds all occurrences of a module
4. **`formatHierarchy()`** - Proper tree formatting with correct prefixes

**Design Note:** The `unusedModules` calculation in `getHierarchyStats()` only checks top-level hierarchy nodes, not nested modules. This is correct behavior since:
- Instantiated modules are tracked in `instantiatedModuleIds`
- Top-level modules are design entry points (not unused)

---

## `index.ts`

### Status: ✅ No Issues Found

All exports correctly match their source definitions:

**From `hierarchy-builder.js`:**
- `findTopModules` ✓
- `getHierarchyStats` ✓
- `findModuleInHierarchy` ✓
- `getPathString` ✓
- `findLeafModules` ✓
- `flattenHierarchy` ✓
- `formatHierarchy` ✓
- `type HierarchyStats` ✓
- `type HierarchyPath` ✓

**From `dependency-analyzer.js`:**
- `DependencyGraph` ✓
- `createDependencyGraph` ✓
- `formatCycle` ✓
- `getAffectedFiles` ✓
- `type DependencyCycle` ✓
- `type DependencyStats` ✓

---

## Recommendations

### Immediate (Low Effort)
1. Remove unused `FileRecord` import from `dependency-analyzer.ts`

### Optional (Performance)
2. Consider adding early-return in `detectCycles()` if only cycle presence matters
3. Cache `hasCycles()` result in `getStats()` to avoid redundant computation

---

## Test Coverage Suggestions

Consider adding tests for these edge cases:

1. **Empty graph** - `getCompileOrder()` should return `[]`
2. **Single file** - Both with and without self-dependency
3. **Disconnected components** - Multiple independent subgraphs
4. **Diamond dependency** - A→B, A→C, B→D, C→D
5. **Multiple cycles** - Ensure all are detected (or just first, depending on intent)

