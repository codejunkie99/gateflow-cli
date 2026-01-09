# Security & Logic Audit: Resolver Module (RE-AUDIT)

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 2 | Scoped name resolution drops path segments; include order wrong |
| 🟡 Medium | 2 | Hierarchy matching only checks first scope element; duplicate adds |
| 🟢 Low | 1 | Variable naming misleading |

**Status:** ✅ Cycle detection fixed! But scoped name resolution has bugs

---

## File: `project-resolver.ts`

### ✅ VERIFIED CORRECT: Cycle Detection Fixed

**Location:** Lines 431-447

**Status:** Cycle detection now works correctly with `visited: Set<string>` and `isCyclic: true` flag. No infinite recursion!

---

### 🟠 HIGH: Scoped Name Resolution Drops Path Segments

**Location:** Lines 279-295 (`resolveClassName`)

**Problem:**
```typescript
if (name.includes('::')) {
  const [pkgName, className] = name.split('::');
  // Only splits on FIRST '::', loses middle segments!
  // "pkg::outer::Inner" becomes ["pkg", "outer::Inner"]
}
```

For `pkg::outer::Inner`, this only splits on the first `::`, losing the middle segment.

**Impact:** Scoped class names with multiple `::` segments are resolved incorrectly.

**Fix:** Use `name.split('::')` to get all segments, then match the full path.

---

### 🟠 HIGH: Include Resolution Order Wrong

**Location:** Lines 365-387 (`resolveIncludePath`)

**Problem:**
```typescript
// Try include paths from recipe FIRST
if (this.recipe) {
  for (const incDir of this.recipe.includePaths) { ... }
}

// Try relative to the including file SECOND
const relative = path.join(fromDir, includePath);
```

SystemVerilog spec says: relative paths should be checked FIRST, then include paths. Current order is reversed.

**Impact:** May resolve includes incorrectly, matching wrong files.

**Fix:** Check relative path first, then recipe include paths.

---

### 🟡 MEDIUM: Hierarchy Matching Only Checks First Scope Element

**Location:** Lines 454-456

**Problem:**
```typescript
const childInstances = this.instances.filter(
  (i) => i.parentScope.length > 0 && i.parentScope[0] === module.name
);
```

Only checks if the FIRST element of `parentScope` matches. Doesn't handle nested scopes correctly.

**Example:**
- Module: `top`
- Instance at scope: `['outer', 'inner']`
- Current code: Won't find it (checks `parentScope[0] === 'top'`, but it's `'outer'`)

**Impact:** Instances in nested scopes aren't included in hierarchy.

**Fix:** Check if `module.name` is ANYWHERE in `parentScope`, or use proper scope matching.

---

### 🟡 MEDIUM: Duplicate Adds Cause Inconsistent Index State

**Location:** Lines 92-104 (`addFile`)

**Problem:**
If the same file is added twice:
- `declarations`, `references`, `instances` arrays: Duplicated
- `index.addAll()`: May overwrite or duplicate entries

**Impact:** Duplicate entities in flat lists, inconsistent index state.

**Fix:** Check if file already added, or deduplicate by ID.

---

### 🟢 LOW: Variable Naming Misleading

**Location:** Line 178 (`targetName`)

**Problem:**
`targetName` suggests it's the name of the target, but it's actually the name from the instance/reference.

**Impact:** Minor confusion, no functional impact.

---

## File: `declaration-index.ts`

### 🟡 MEDIUM: Duplicate Adds Cause Inconsistent State

**Location:** Lines 68-90 (`add` method)

**Problem:**
If the same declaration is added twice:
- `byId`: Overwritten (single entry) ✓
- `byLocationId`: Overwritten (single entry) ✓
- `byName`: Duplicated in array ✗
- `byKind`: Duplicated in array ✗
- `byFile`: Duplicated in array ✗

**Impact:** `getByName()`, `getByKind()`, `getByFile()` return duplicates.

**Fix:** Check if declaration already exists before adding, or deduplicate arrays.

---

## Recommendations

1. **Fix scoped name resolution** - Handle multiple `::` segments correctly
2. **Fix include order** - Check relative paths before recipe paths
3. **Fix hierarchy matching** - Check full scope chain, not just first element
4. **Deduplicate adds** - Check for existing declarations/instances before adding

---

## Summary

Cycle detection is fixed! But scoped name resolution and hierarchy building have bugs that need attention.
