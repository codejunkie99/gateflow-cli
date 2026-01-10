# Security & Logic Audit: Indexer Root Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 1 | Legacy parser still in use |
| 🟡 Medium | 2 | Missing error handling; unused code |
| 🟢 Low | 1 | Documentation note |

**Note:** This directory contains both the NEW indexer (`sv-indexer.ts`) and LEGACY indexer (`index.ts` + `parser.ts`). The legacy code should be deprecated/removed.

---

## File: `sv-indexer.ts` (NEW Indexer)

### ✅ VERIFIED CORRECT: Main Orchestrator

The `SVIndexer` class correctly:
- Uses `FileUnderstander` for parsing
- Uses `FilelistParser` for recipe parsing
- Uses `ProjectResolver` for cross-file resolution
- Provides clean API: `indexProject()`, `indexFiles()`, `parseFile()`

**Architecture:** Clean separation of concerns ✓

---

### 🟡 MEDIUM: Missing Error Handling in `indexProject`

**Location:** Lines 160-176

**Problem:**
```typescript
async indexProject(filelistPath: string): Promise<ResolvedProject> {
  const recipe = await this.filelistParser.parse(filelistPath);
  // ❌ No try/catch - parse errors propagate unhandled
  
  const results = await this.parseFiles(recipe.files);
  // ❌ No check for failed parses
  
  const resolver = new ProjectResolver(recipe);
  for (const result of results) {
    if (result.success) {
      resolver.addFile(result.result!);
    }
    // ❌ Failed files silently ignored
  }
  
  return resolver.resolve();
  // ❌ No error handling if resolution fails
}
```

**Impact:** 
- Filelist parse errors crash the entire operation
- Failed file parses are silently ignored
- No way to know which files failed

**Fix:**
```typescript
async indexProject(filelistPath: string): Promise<ResolvedProject> {
  try {
    const recipe = await this.filelistParser.parse(filelistPath);
  } catch (error) {
    throw new Error(`Failed to parse filelist ${filelistPath}: ${error}`);
  }
  
  const results = await this.parseFiles(recipe.files);
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.warn(`Failed to parse ${failed.length} files:`, failed.map(f => f.path));
  }
  
  // ... rest
}
```

---

### 🟡 MEDIUM: `getCompileOrder` Falls Back Incorrectly

**Location:** Lines 246-250

**Problem:**
```typescript
getCompileOrder(project: ResolvedProject): string[] {
  const graph = new DependencyGraph();
  graph.addEdges(project.dependencies);
  return graph.tryGetCompileOrder() || project.files.map((f) => f.path);
  // ❌ Falls back to file order, not dependency order!
}
```

**Impact:** If dependency graph has cycles, returns files in arbitrary order instead of best-effort partial order.

**Fix:** Use `getCompileOrder()` from `dependency-analyzer.ts` which handles cycles gracefully.

---

## File: `index.ts` (LEGACY Indexer)

### 🟠 HIGH: Legacy Code Still Active

**Location:** Entire file

**Problem:** This is the OLD indexer using the legacy `SVParser`. It should be:
1. Deprecated with warnings
2. Removed entirely
3. Or clearly marked as legacy

**Current State:** Still exported and usable, creating confusion about which indexer to use.

**Recommendation:** 
- Add `@deprecated` JSDoc tag
- Add console.warn on construction
- Or remove entirely if `sv-indexer.ts` is production-ready

---

### 🟡 MEDIUM: `getDependencyGraph` Has Cycle Detection Bug

**Location:** Lines 319-384

**Problem:** Same issue as in `dependency-analyzer.ts` - continues processing after finding a cycle:

```typescript
if (stack.includes(name)) {
  // Cycle detected
  graph.cycles.push([...stack.slice(cycleStart), name]);
  return;  // ✓ Returns here
}
```

Actually, this one DOES return early, so it's correct. But the cycle detection logic is duplicated between legacy and new code.

---

### 🟢 LOW: `hashContent` Uses MD5 Instead of SHA-256

**Location:** Line 591

**Problem:**
```typescript
private hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}
```

**Impact:** Inconsistent with `FileRecord.hash` which uses SHA-256. Not a security issue for indexing, but inconsistent.

**Fix:** Use SHA-256 for consistency:
```typescript
return crypto.createHash('sha256').update(content).digest('hex');
```

---

## File: `parser.ts` (LEGACY Parser)

### 🟠 HIGH: Legacy Regex-Based Parser

**Location:** Entire file

**Problem:** This is a "80% solution" regex parser that:
- Doesn't handle complex syntax
- Has known false positives/negatives
- Should be replaced by the new `FileUnderstander`

**Status:** Still exported and used by legacy `ProjectIndexer`.

**Recommendation:** Mark as deprecated or remove.

---

### 🟡 MEDIUM: `getLineNumber` Has Index Mismatch Bug

**Location:** Lines 459-463

**Problem:**
```typescript
private getLineNumber(content: string, index: number): number {
  const safeIndex = Math.min(index, content.length);
  return content.slice(0, safeIndex).split('\n').length;
}
```

**Issue:** When called with `originalContent` but `index` from `cleanContent` (after comment removal), the index is wrong!

**Example:**
```typescript
// originalContent: "module m; // comment\nendmodule"
// cleanContent: "module m; \nendmodule"
// match.index in cleanContent = 10
// But index 10 in originalContent points to different location!
```

**Fix:** Either:
1. Use `cleanContent` for both matching and line calculation
2. Or map indices back to original content

---

### 🟡 MEDIUM: Port Line Numbers Always 0

**Location:** Lines 386, 398, 410

**Problem:**
```typescript
ports.push({
  name: match[2],
  direction: 'input',
  type: 'logic',
  width: match[1] || undefined,
  line: 0  // ❌ Always 0!
});
```

**Impact:** Can't navigate to port declarations.

**Fix:** Calculate line number from match index in module body.

---

## Cross-Module Issues

### Duplicate Functionality

| Feature | Legacy (`index.ts`) | New (`sv-indexer.ts`) |
|---------|-------------------|---------------------|
| File parsing | `SVParser` (regex) | `FileUnderstander` (proper) |
| Dependency graph | `getDependencyGraph()` | `DependencyGraph` class |
| Compile order | `getCompilationOrder()` | `getCompileOrder()` |
| Include resolution | `resolveInclude()` | `ProjectResolver.resolveIncludes()` |

**Recommendation:** Remove legacy code once new indexer is fully tested.

---

## Recommended Priority

1. **🟠 Deprecate/remove legacy indexer** - Eliminate confusion
2. **🟡 Add error handling to `indexProject`** - Better user experience
3. **🟡 Fix `getCompileOrder` fallback** - Use proper dependency order
4. **🟡 Fix `getLineNumber` index mismatch** - Accurate line numbers
5. **🟢 Use SHA-256 consistently** - Code consistency

---

## Migration Path

If removing legacy code:

1. **Update imports:** Replace `from './indexer/index.js'` with `from './indexer/sv-indexer.js'`
2. **Update API calls:** 
   - `ProjectIndexer.buildIndex()` → `SVIndexer.indexProject()`
   - `ProjectIndexer.findModule()` → Query `ResolvedProject.declarations`
3. **Update types:** `ModuleInfo` → `Declaration` with `kind: 'module'`



