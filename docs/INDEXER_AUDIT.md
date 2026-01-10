# Comprehensive Audit: src/indexer

**Date:** 2026-01-10
**Scope:** All TypeScript files in `src/indexer/`
**Categories:** Bugs, Logical Errors, Missing Cases, Edge Cases, Performance Issues

---

## Executive Summary

This audit covers 68 TypeScript files in the `src/indexer` directory. The analysis identified **23 issues** across multiple severity levels:

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 12 |
| Low | 4 |

---

## Critical Issues

### 1. Non-Contiguous Scope Matching in Project Resolver

**File:** `src/indexer/resolver/project-resolver.ts`
**Lines:** 306-317, 351-364
**Severity:** CRITICAL
**Type:** Logic Error

**Description:**
The scope matching algorithm for qualified names (e.g., `pkg::subpkg::class`) doesn't validate that scope parts appear contiguously. This can cause incorrect resolution where `pkg::subpkg::class` would incorrectly match a candidate with scope `[pkg, unrelated, subpkg]`.

**Problematic Code:**
```typescript
let matchIndex = 0;
for (const scopePart of candidate.scope) {
  if (matchIndex < scopeParts.length && scopePart === scopeParts[matchIndex]) {
    matchIndex++;
  }
}

// All scope parts must have been matched
if (matchIndex === scopeParts.length) {
  return candidate;
}
```

**Impact:** Incorrect symbol resolution can cause wrong navigation targets, incorrect dependency graphs, and phantom type errors.

**Recommended Fix:**
```typescript
// Check for contiguous match - all scope parts must appear consecutively
const candidateScopeStr = candidate.scope.join('::');
const searchScopeStr = scopeParts.join('::');
if (candidateScopeStr.endsWith(searchScopeStr) || candidateScopeStr === searchScopeStr) {
  return candidate;
}
```

---

### 2. Hierarchy Builder Visited Set Reuse Issue

**File:** `src/indexer/merge/index-merger.ts`
**Lines:** 436-490
**Severity:** CRITICAL
**Type:** State Management Bug

**Description:**
The `buildHierarchy` function uses a shared `visited` set but deletes from it after processing each node. This allows the same module to be processed again if encountered in a different branch, potentially causing:
1. Incorrect hierarchy structures
2. Missing cycle detection in certain graph topologies
3. Potential infinite loops in edge cases

**Problematic Code:**
```typescript
const visited = new Set<string>();

function buildNode(decl: Declaration, instanceName: string): HierarchyNode {
  if (visited.has(decl.id)) {
    return { /* cyclic marker */ };
  }

  visited.add(decl.id);
  // ... build children ...
  visited.delete(decl.id);  // BUG: Allows same module in different branches
  return { ... };
}
```

**Impact:** Incorrect module hierarchy, potentially incorrect "top modules" detection.

**Recommended Fix:**
Use a separate `inPath` set for cycle detection (deleted after processing) and a `processed` map for memoization (never deleted):

```typescript
const inPath = new Set<string>();      // For cycle detection
const memo = new Map<string, HierarchyNode>();  // For memoization

function buildNode(decl: Declaration, instanceName: string): HierarchyNode {
  if (inPath.has(decl.id)) {
    return { isCyclic: true, ... };
  }

  if (memo.has(decl.id)) {
    return { ...memo.get(decl.id)!, instanceName };
  }

  inPath.add(decl.id);
  const node = /* build children */;
  inPath.delete(decl.id);
  memo.set(decl.id, node);
  return node;
}
```

---

## High-Severity Issues

### 3. Binary Search Algorithm Potential Issue

**File:** `src/indexer/reader/line-index.ts`
**Lines:** 121-130
**Severity:** HIGH
**Type:** Algorithm Correctness Concern

**Description:**
The binary search uses `Math.ceil((lo + hi) / 2)` which is non-standard. While the implementation appears to work correctly in testing, this pattern is unusual and can be error-prone when modified.

**Current Code:**
```typescript
while (lo < hi) {
  const mid = Math.ceil((lo + hi) / 2);
  if (offsets[mid] <= byteOffset) {
    lo = mid;
  } else {
    hi = mid - 1;
  }
}
```

**Concern:** The ceiling division combined with `hi = mid - 1` is a valid but non-intuitive binary search variant. Any modification risks introducing off-by-one errors.

**Recommendation:** Add extensive unit tests for boundary conditions, or refactor to use the more standard floor-based pattern with clear documentation.

---

### 4. Circular Filelist Detection Returns Silent Empty Recipe

**File:** `src/indexer/recipe/filelist-parser.ts`
**Lines:** 155-166
**Severity:** HIGH
**Type:** Missing Error Reporting

**Description:**
When a circular filelist reference is detected, the parser returns an empty recipe without any indication of the cycle. This makes debugging circular includes nearly impossible.

**Problematic Code:**
```typescript
if (visited.has(absolutePath)) {
  return {
    id: 'cycle-' + absolutePath.slice(-16),
    sourceFile: absolutePath,
    includePaths: [],
    defines: {},
    files: [],
    nestedFilelists: [],
  };
}
```

**Impact:** Users cannot distinguish between an empty filelist and a circular reference.

**Recommended Fix:**
Either throw an error with details, or add a `hadCycle: boolean` and `cycleDetails?: string[]` to the Recipe type.

---

### 5. Include Pattern Only Matches Double Quotes

**File:** `src/indexer/slang/slang-cache.ts`
**Lines:** 419-443
**Severity:** HIGH
**Type:** Missing Cases

**Description:**
The regex for finding `include` directives only matches double-quoted includes, missing:
1. Single-quoted includes: `` `include 'file.sv' ``
2. Angle-bracket includes: `` `include <file.sv> ``
3. Includes with leading whitespace variations

**Problematic Code:**
```typescript
const includePattern = /`include\s+"([^"]+)"/g;
```

**Impact:** Cache invalidation won't trigger for changes in single-quoted or angle-bracket includes, leading to stale cache results.

**Recommended Fix:**
```typescript
const includePattern = /`include\s+(?:"([^"]+)"|'([^']+)'|<([^>]+)>)/g;
```

---

### 6. Dependency Graph Topological Sort Direction

**File:** `src/indexer/analyzer/dependency-analyzer.ts`
**Lines:** 231-281
**Severity:** HIGH
**Type:** Logic Error

**Description:**
The `getCompileOrder()` method has confusing semantics. It builds in-degree based on `dependsOn`, but the in-degree counting logic counts how many files depend ON a file rather than how many files it depends on. The final `reverse()` fixes this, but the intermediate logic is backwards.

**Confusing Code:**
```typescript
for (const file of this.files) {
  const deps = this.dependsOn.get(file);
  if (deps) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);  // Incrementing dep's in-degree
    }
  }
}
```

**Impact:** While the final result is correct due to the `reverse()` call, any modification to this algorithm could easily introduce bugs due to the confusing semantics.

**Recommendation:** Add clear comments explaining the reversal logic, or refactor to be more intuitive.

---

### 7. Unresolved Instance Tracking Missing

**File:** `src/indexer/resolver/project-resolver.ts`
**Lines:** 172-184
**Severity:** HIGH
**Type:** Missing Diagnostic

**Description:**
When `findInstanceTarget()` returns undefined, the instance remains unresolved without any logging or tracking. This makes it difficult to debug why certain instances aren't resolved.

**Problematic Code:**
```typescript
private resolveInstances(): void {
  for (const instance of this.instances) {
    if (instance.resolvedId) continue;
    const target = this.findInstanceTarget(instance);
    if (target) {
      instance.resolvedId = target.id;
    }
    // No logging or tracking when target is undefined
  }
}
```

**Recommendation:** Add optional verbose logging or collect unresolved instances for reporting.

---

## Medium-Severity Issues

### 8. Cache Statistics Race Condition

**File:** `src/indexer/slang/slang-cache.ts`
**Lines:** 113-114, 146, 156, 161
**Severity:** MEDIUM
**Type:** Potential Race Condition

**Description:**
The `hits` and `misses` counters are incremented without synchronization. While Node.js is single-threaded, async operations can interleave, potentially causing lost updates to statistics.

**Code:**
```typescript
get(recipeHash: string): SlangMappingResult | undefined {
  // ...
  this.hits++;   // Not atomic
  // ...
  this.misses++; // Not atomic
}
```

**Impact:** Inaccurate cache statistics (minor impact on functionality).

---

### 9. Environment Variable Fallback Leaves Unresolved Variables

**File:** `src/indexer/recipe/filelist-parser.ts`
**Lines:** 327-331
**Severity:** MEDIUM
**Type:** Unexpected Behavior

**Description:**
When an environment variable is not defined, the original `$VAR` or `${VAR}` is left in the path, which will likely fail later with a confusing "file not found" error.

**Problematic Code:**
```typescript
private expandEnvVars(inputPath: string): string {
  return inputPath.replace(/\$\{?(\w+)\}?/g, (match, varName) => {
    return process.env[varName] || match;  // Returns original if undefined
  });
}
```

**Recommendation:** Either throw an error for undefined variables, or emit a warning.

---

### 10. Weak Error Detection in Stderr Parsing

**File:** `src/indexer/slang/subprocess.ts`
**Lines:** 454-459
**Severity:** MEDIUM
**Type:** Over-Matching

**Description:**
The fallback error detection checks for the substring "error" or "Error", which can incorrectly classify informational messages as errors.

**Problematic Code:**
```typescript
} else if (line.includes('error') || line.includes('Error')) {
  diagnostics.push({
    severity: 'error',
    message: line.trim(),
  });
}
```

**Impact:** False positive error reports for messages like "No errors found" or "Error handling enabled".

---

### 11. Silent Failure in Disk Cache Operations

**File:** `src/indexer/slang/slang-cache.ts`
**Lines:** 516-519, 531-533, 546-548, 568-570
**Severity:** MEDIUM
**Type:** Silent Error Swallowing

**Description:**
All disk cache operations silently catch and ignore errors. This can hide serious issues like disk full, permission denied, or corrupted cache files.

**Problematic Code:**
```typescript
private loadFromDisk(hash: string): CacheEntry | undefined {
  try {
    // ...
  } catch {
    return undefined;  // Silently ignores ALL errors
  }
}
```

**Recommendation:** At minimum, log warnings for unexpected errors. Consider distinguishing between "file not found" (expected) and other errors (unexpected).

---

### 12. No Validation of Recipe File Existence

**File:** `src/indexer/slang/slang-backend.ts`
**Lines:** 197-295
**Severity:** MEDIUM
**Type:** Missing Validation

**Description:**
The `analyzeRecipe` method doesn't validate that files in the recipe actually exist before passing to slang. This results in unclear errors from slang rather than early, clear validation errors.

**Recommendation:** Add pre-flight validation:
```typescript
for (const file of recipe.files) {
  if (!existsSync(file)) {
    return { success: false, error: `File not found: ${file}` };
  }
}
```

---

### 13. Missing Parser Consistency Check

**File:** `src/indexer/understander/file-understander.ts`
**Lines:** 159-177
**Severity:** MEDIUM
**Type:** Missing Validation

**Description:**
When both Slang and Verible succeed, their results are merged without any validation that they agree on basic facts (e.g., same number of modules, same module names).

**Impact:** Subtle inconsistencies between parsers could go unnoticed.

**Recommendation:** Add an optional validation mode that logs discrepancies.

---

### 14. Cycle Detection Resets State Per File

**File:** `src/indexer/analyzer/dependency-analyzer.ts`
**Lines:** 376-381
**Severity:** MEDIUM
**Type:** Inefficiency

**Description:**
The cycle detection algorithm resets the `visited` set for every starting file, which is necessary for correctness but could lead to O(V * (V + E)) complexity in worst case.

**Code:**
```typescript
for (const file of this.files) {
  visited.clear();
  recStack.clear();
  dfs(file, []);
}
```

**Note:** The deduplication via `seenCycles` prevents reporting duplicate cycles, but the algorithm still does redundant work.

---

### 15. ID Uniqueness Not Validated

**File:** `src/indexer/merge/index-merger.ts`
**Lines:** 160-166
**Severity:** MEDIUM
**Type:** Missing Validation

**Description:**
When building lookup maps from Layer B, duplicate IDs silently overwrite earlier entries without warning.

**Code:**
```typescript
for (const decl of layerB.declarations) {
  layerBDeclById.set(decl.id, decl);  // Silently overwrites duplicates
}
```

**Recommendation:** Add assertions or logging to detect and report duplicates.

---

### 16. Abort Signal Handler Memory Leak Risk

**File:** `src/indexer/slang/subprocess.ts`
**Lines:** 199-203
**Severity:** MEDIUM
**Type:** Resource Management

**Description:**
The abort signal event listener uses `{ once: true }` which is good, but there's no cleanup if the process completes normally before abort. In long-running applications, this could accumulate.

**Code:**
```typescript
if (signal) {
  signal.addEventListener('abort', () => {
    killed = true;
    proc.kill('SIGTERM');
  }, { once: true });
}
```

**Note:** The `{ once: true }` option mitigates this, but explicit cleanup would be cleaner.

---

### 17. LooksLikeSvFile Missing Extensions

**File:** `src/indexer/recipe/filelist-parser.ts`
**Lines:** 337-341
**Severity:** MEDIUM
**Type:** Missing Cases

**Description:**
The file extension check doesn't include all valid SystemVerilog file extensions.

**Current Extensions:** `.sv`, `.svh`, `.v`, `.vh`, `.svi`

**Missing Extensions:**
- `.svp` (SystemVerilog package files in some projects)
- `.vlib` (library files)
- Case variations (though this may be intentional for case-sensitive filesystems)

---

### 18. includePattern Regex State Issue

**File:** `src/indexer/slang/slang-cache.ts`
**Lines:** 421-435
**Severity:** MEDIUM
**Type:** Regex State Bug

**Description:**
The regex with `/g` flag maintains state between `exec()` calls, but the same regex is reused across different file contents without resetting `lastIndex`.

**Problematic Code:**
```typescript
const includePattern = /`include\s+"([^"]+)"/g;  // Defined once

for (const sourceFile of recipe.files) {
  const content = readFileSync(sourceFile, 'utf-8');
  while ((match = includePattern.exec(content)) !== null) {
    // ...
  }
  // lastIndex not reset before next file!
}
```

**Impact:** After the regex exhausts matches in one file, it may skip the beginning of the next file.

**Recommended Fix:**
Reset `lastIndex` before each file:
```typescript
includePattern.lastIndex = 0;
```
Or create a new regex per file.

---

### 19. childInstances Filter May Miss Nested Modules

**File:** `src/indexer/resolver/project-resolver.ts`
**Lines:** 503-505
**Severity:** MEDIUM
**Type:** Logic Limitation

**Description:**
The filter to find child instances only checks the last element of `parentScope`:

```typescript
const childInstances = this.instances.filter(
  (i) => i.parentScope.length > 0 && i.parentScope[i.parentScope.length - 1] === module.name
);
```

This could incorrectly include instances from nested modules with the same parent name (e.g., `A::counter` and `B::counter` both would match a module named "counter").

---

## Low-Severity Issues

### 20. Unused lookupKey in Index Merger

**File:** `src/indexer/merge/index-merger.ts`
**Lines:** 164-166
**Severity:** LOW
**Type:** Dead Code

**Description:**
`layerBDeclByNameScope` is populated but appears to never be used.

```typescript
const layerBDeclByNameScope = new Map<string, Declaration>();
for (const decl of layerB.declarations) {
  const key = buildLookupKey(decl.name, decl.scope);
  layerBDeclByNameScope.set(key, decl);  // Never used
}
```

---

### 21. Magic Numbers in Cache Configuration

**File:** `src/indexer/slang/slang-cache.ts`
**Lines:** 84-88
**Severity:** LOW
**Type:** Maintainability

**Description:**
Magic numbers for cache configuration could be documented better.

```typescript
const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_ENTRIES = 100;
```

**Recommendation:** Consider making these configurable via environment variables for production tuning.

---

### 22. Inconsistent Error Message Format

**File:** `src/indexer/understander/file-understander.ts`
**Lines:** 152-156
**Severity:** LOW
**Type:** UX Consistency

**Description:**
Error messages mix different styles (some have URLs, some don't, some have line breaks).

**Recommendation:** Create a consistent error message format across the codebase.

---

### 23. getStats() Calls hasCycles() Redundantly

**File:** `src/indexer/analyzer/dependency-analyzer.ts`
**Lines:** 404-441
**Severity:** LOW
**Type:** Performance

**Description:**
`getStats()` calls `hasCycles()` which calls `detectCycles()`, doing a full DFS traversal just to check if cycles exist.

```typescript
getStats(): DependencyStats {
  // ... other stats ...
  return {
    // ...
    hasCycles: this.hasCycles(),  // Full DFS traversal
  };
}
```

**Recommendation:** Cache the cycle detection result or use a lightweight check when only existence (not details) is needed.

---

## Recommendations Summary

### Immediate Actions (Critical/High)
1. Fix scope matching algorithm to require contiguous matches
2. Fix hierarchy builder visited set handling
3. Extend include pattern to support all quote styles
4. Add cycle detection warning to filelist parser

### Short-term Improvements (Medium)
5. Add pre-flight file existence validation
6. Fix regex lastIndex issue in cache include detection
7. Add optional parser consistency validation
8. Improve error messages with consistent formatting
9. Add logging for unresolved instances

### Long-term Technical Debt (Low)
10. Remove dead code (unused Maps)
11. Document magic numbers
12. Consider caching cycle detection results
13. Add comprehensive unit tests for binary search edge cases

---

## Testing Recommendations

Add unit tests for:
1. Binary search boundary conditions (empty arrays, single element, exact matches)
2. Scope matching with various qualified name patterns
3. Circular filelist detection
4. Include directive variations (single quotes, angle brackets)
5. Hierarchy building with complex module graphs including diamonds and cycles
6. Cache invalidation scenarios

---

*End of Audit Report*
