# Security & Logic Audit: Resolver Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | Infinite recursion in hierarchy building on circular instantiation |
| 🟠 High | 2 | Scoped name resolution drops path segments; include order wrong |
| 🟡 Medium | 3 | Duplicate adds cause inconsistent index state; hierarchy matching too weak |
| 🟢 Low | 2 | removeFile relies on object identity; variable naming misleading |
| ℹ️ Info | 1 | Design note on visibility |

---

## File: `declaration-index.ts`

### 🟡 MEDIUM: Duplicate Adds Cause Inconsistent Index State

**Location:** Lines 68-90 (`add` method)

**Problem:**
If the same declaration is added twice:
- `byId` and `byLocationId`: Overwritten (single entry)
- `byName`, `byKind`, `byFile`: Appended (duplicate entries)

```typescript
add(decl: Declaration): void {
  this.byId.set(decl.id, decl);  // Overwrites
  // ...
  byName.push(decl);  // Always appends - DUPLICATE!
  byKind.push(decl);  // Always appends - DUPLICATE!
  byFile.push(decl);  // Always appends - DUPLICATE!
}
```

**Impact:**
- `getByName('foo')` returns duplicates
- Stats are inflated
- Memory waste

**Fix:**
```typescript
add(decl: Declaration): void {
  // Check if already exists
  if (this.byId.has(decl.id)) {
    return; // Already indexed
  }
  
  this.byId.set(decl.id, decl);
  // ... rest of indexing
}
```

---

### 🟢 LOW: `removeFile` Uses Object Identity

**Location:** Lines 376-405 (`removeFile` method)

**Problem:**
```typescript
const idx = byName.indexOf(decl);  // Uses === comparison
if (idx >= 0) byName.splice(idx, 1);
```

If declarations were added as different object instances (e.g., through serialization/deserialization), `indexOf` won't find them.

**Impact:** Low - unlikely in normal usage, but could cause memory leaks in edge cases.

**Fix:**
```typescript
const idx = byName.findIndex((d) => d.id === decl.id);
if (idx >= 0) byName.splice(idx, 1);
```

---

### ✅ VERIFIED CORRECT: `getByNameInScope` and `isPrefix`

The scope visibility logic is correct:
- `getByNameInScope`: Searches from innermost to outermost scope
- `getVisibleFrom`: Returns all declarations whose scope is a prefix of the target

---

## File: `project-resolver.ts`

### 🔴 CRITICAL: Infinite Recursion in Hierarchy Building

**Location:** Lines 427-455 (`buildHierarchyNode` method)

**Problem:**
If module A instantiates itself (directly or through a chain), infinite recursion occurs:

```typescript
private buildHierarchyNode(
  module: Declaration,
  instanceName: string
): HierarchyNode {
  // ...
  for (const inst of childInstances) {
    // ...
    children.push(this.buildHierarchyNode(childModule, inst.instanceName));
    // NO CYCLE DETECTION!
  }
}
```

**Scenario:**
```systemverilog
module recursive;
  recursive r();  // Instantiates itself!
endmodule
```

**Impact:** Stack overflow crash.

**Fix:**
```typescript
private buildHierarchyNode(
  module: Declaration,
  instanceName: string,
  visited: Set<string> = new Set()  // Track visited modules
): HierarchyNode {
  // Detect cycle
  if (visited.has(module.id)) {
    return {
      instanceName,
      moduleName: module.name,
      moduleId: module.id,
      file: module.location.file,
      line: module.location.line,
      children: [],  // Break cycle
      isCyclic: true,  // Flag it
    };
  }
  
  visited.add(module.id);
  
  // ... rest of method, passing visited to recursive calls
  children.push(this.buildHierarchyNode(childModule, inst.instanceName, new Set(visited)));
}
```

---

### 🟠 HIGH: Scoped Name Resolution Drops Path Segments

**Location:** Lines 279-295 (`resolveClassName` method)

**Problem:**
```typescript
if (name.includes('::')) {
  const [pkgName, className] = name.split('::');  // ONLY GETS FIRST TWO!
```

For `my_pkg::outer_class::InnerClass`:
- `name.split('::')` → `['my_pkg', 'outer_class', 'InnerClass']`
- `[pkgName, className]` → `pkgName = 'my_pkg'`, `className = 'outer_class'`
- `'InnerClass'` is **LOST**!

**Impact:** Nested class references like `pkg::Class::NestedClass` fail to resolve.

**Fix:**
```typescript
if (name.includes('::')) {
  const parts = name.split('::');
  const className = parts[parts.length - 1];  // Last part is the class
  const scopeParts = parts.slice(0, -1);      // Everything else is scope
  
  const candidates = this.index.getAllByNameAndKind(className, 'class');
  for (const cls of candidates) {
    // Check if all scope parts are in the class's scope
    if (scopeParts.every((p) => cls.scope.includes(p))) {
      return cls;
    }
  }
}
```

---

### 🟠 HIGH: Include Resolution Order is Incorrect

**Location:** Lines 365-387 (`resolveIncludePath` method)

**Problem:**
```typescript
private async resolveIncludePath(...) {
  // Try include paths from recipe FIRST
  if (this.recipe) {
    for (const incDir of this.recipe.includePaths) {
      // ...
    }
  }

  // THEN try relative to the including file
  const fromDir = path.dirname(fromFile);
```

**Standard SV tool behavior:** Relative paths from the including file should be checked **FIRST**, then include directories.

**Impact:**
- If `defs.svh` exists in both `./` and `/global/includes/`:
- With `+incdir+/global/includes/` in recipe
- Including `defs.svh` from `./foo.sv` will find `/global/includes/defs.svh` instead of `./defs.svh`
- This breaks projects that rely on local file shadowing

**Fix:**
```typescript
private async resolveIncludePath(
  includePath: string,
  fromFile: string
): Promise<string | null> {
  // 1. Try relative to the including file FIRST
  const fromDir = path.dirname(fromFile);
  const relative = path.join(fromDir, includePath);
  if (await this.fileExists(relative)) {
    return relative;
  }

  // 2. Then try include paths from recipe
  if (this.recipe) {
    for (const incDir of this.recipe.includePaths) {
      const candidate = path.join(incDir, includePath);
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
```

---

### 🟡 MEDIUM: Hierarchy Matching Only Checks First Scope Element

**Location:** Lines 432-434 (`buildHierarchyNode` method)

**Problem:**
```typescript
const childInstances = this.instances.filter(
  (i) => i.parentScope.length > 0 && i.parentScope[0] === module.name
);
```

Only checks `parentScope[0]`. For nested modules:

```systemverilog
module outer;
  module inner;
    submod s();  // parentScope = ['outer', 'inner']
  endmodule
endmodule
```

When building hierarchy for `outer`, instances inside `inner` (with `parentScope = ['outer', 'inner']`) would be incorrectly matched since `parentScope[0] === 'outer'`.

**Impact:** Wrong hierarchy tree with instances appearing at wrong nesting levels.

**Fix:**
```typescript
const childInstances = this.instances.filter(
  (i) => i.parentScope.length === 1 && i.parentScope[0] === module.name
);

// OR for nested scope matching:
const childInstances = this.instances.filter(
  (i) => i.parentScope.length > 0 && 
         i.parentScope[i.parentScope.length - 1] === module.name
);
```

The exact fix depends on how `parentScope` is defined - need to verify the Instance type semantics.

---

### 🟡 MEDIUM: resolveTypeName Weak Scope Matching

**Location:** Lines 300-336 (`resolveTypeName` method)

**Problem:**
```typescript
if (name.includes('::')) {
  const parts = name.split('::');
  const typeName = parts[parts.length - 1];  // OK - gets last
  
  // ...
  if (candidate.scope.includes(parts[0])) {  // WEAK - only checks first!
```

For `pkg::subpkg::MyType`, only checks if `'pkg'` is in scope, not `'subpkg'`.

**Impact:** Incorrect type resolution when multiple types with same name exist in different sub-scopes.

**Fix:**
```typescript
// Check all scope parts are present and in order
const scopeParts = parts.slice(0, -1);
const matchesScope = scopeParts.every((part, idx) => 
  candidate.scope.length > idx && candidate.scope[idx] === part
);
if (matchesScope) {
  return candidate;
}
```

---

### 🟢 LOW: Misleading Variable Name

**Location:** Lines 283-285 (`resolveClassName`)

**Problem:**
```typescript
const classes = this.index.getByNameAndKind(className, 'class');
if (classes && classes.scope.includes(pkgName)) {
```

`classes` (plural) suggests an array, but `getByNameAndKind` returns a single `Declaration | undefined`.

**Impact:** Readability confusion only.

**Fix:** Rename to `classDecl` or `cls`.

---

## File: `index.ts`

### ✅ Clean

All exports correctly match their source definitions.

---

## Verified Correct ✅

| Component | Status | Notes |
|-----------|--------|-------|
| `DeclarationIndex.add()` | ⚠️ | No duplicate check |
| `DeclarationIndex.getById()` | ✅ | Correct |
| `DeclarationIndex.getByName()` | ✅ | Returns array correctly |
| `DeclarationIndex.getByNameAndKind()` | ✅ | Returns first match |
| `DeclarationIndex.getByNameInScope()` | ✅ | Correct scope traversal |
| `DeclarationIndex.getVisibleFrom()` | ✅ | Correct prefix check |
| `ProjectResolver.resolveInstances()` | ✅ | Correct |
| `ProjectResolver.resolveReferences()` | ⚠️ | Scoped names lose segments |
| `ProjectResolver.resolveIncludes()` | ⚠️ | Wrong search order |
| `ProjectResolver.buildHierarchy()` | ⚠️ | No cycle detection |
| `ProjectResolver.buildDependencies()` | ✅ | Correct with deduplication |

---

## Test Cases to Add

```typescript
// 1. Circular instantiation
// mod.sv: module recursive; recursive r(); endmodule
const project = await resolver.resolve();
// Should NOT stack overflow!

// 2. Nested scoped class
// pkg.sv: package p; class A; class Inner; endclass endclass endpackage
// ref: p::A::Inner
const decl = resolver.resolveClassName('p::A::Inner', []);
assert(decl?.name === 'Inner');  // Currently FAILS

// 3. Include order
// ./foo.sv exists
// /global/foo.sv exists
// +incdir+/global
const resolved = await resolver.resolveIncludePath('foo.sv', './bar.sv');
assert(resolved === './foo.sv');  // Currently returns /global/foo.sv!

// 4. Duplicate add handling
index.add(decl);
index.add(decl);  // Same declaration
assert(index.getByName(decl.name).length === 1);  // Currently FAILS - returns 2

// 5. Hierarchy scope matching
// outer::inner::inst should not appear as direct child of outer
const hierarchy = resolver.buildHierarchy();
// Verify correct nesting levels
```

---

## Recommended Priority

1. **🔴 Add cycle detection to buildHierarchyNode** - Prevents crash
2. **🟠 Fix resolveClassName/resolveTypeName** - Correct nested scope resolution
3. **🟠 Fix include resolution order** - Match standard SV tool behavior
4. **🟡 Add duplicate check to DeclarationIndex.add()** - Consistent state
5. **🟡 Fix hierarchy scope matching** - Correct tree structure

