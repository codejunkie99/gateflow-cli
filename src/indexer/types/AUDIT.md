# Security & Logic Audit: Types Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 0 | No critical issues |
| 🟠 High | 1 | Missing `guard` field on Directive type |
| 🟡 Medium | 2 | Type inconsistencies; missing HierarchyNode.isCyclic |
| 🟢 Low | 2 | Documentation clarifications |
| ℹ️ Info | 3 | Design observations |

**Overall Assessment:** The types module is well-designed with excellent documentation. The discriminated unions are properly typed, and the module organization is clean. Most issues are minor type gaps or documentation clarifications.

---

## File: `location.ts`

### ✅ VERIFIED CORRECT: Line/Column Numbering

Documentation clearly states:
- Line and column numbers are **1-based** (first line is line 1)
- `LineOffsets[i]` = byte offset where line `(i+1)` begins
- `LineOffsets[0]` = 0 (first line starts at byte 0)

This is consistent with editor conventions.

---

### 🟢 LOW: Guard.inverted Semantics Need Clarification

**Location:** Lines 87-101

**Observation:**
```typescript
export interface Guard {
  condition: string;   // e.g., "A && !B"
  inverted: boolean;   // ???
}
```

The `condition` string already contains `!` for negation (e.g., `"A && !B"`).
The separate `inverted` boolean is redundant/confusing.

**Issue:** `scope-tracker.ts` returns the innermost guard's inversion as the overall `inverted` value, which doesn't represent the combined condition semantics.

**Recommendation:** Either:
1. Remove `inverted` field (condition string is sufficient)
2. Or document that `inverted` represents something specific (e.g., "overall polarity hint")

---

## File: `directive.ts`

### 🟠 HIGH: Missing `guard` Field on Directive Type

**Location:** Lines 120-156 (Directive interface)

**Problem:**
```typescript
export interface Directive {
  id: string;
  kind: DirectiveKind;
  location: Location;
  data: DirectiveData;
  // NO guard field!
}
```

Compare with Declaration (has `guard`), Reference (has `guard`), Instance (has `guard`).

**Impact:** Cannot track which `ifdef` a `define` is inside:
```systemverilog
`ifdef DEBUG
  `define LOG(x) $display(x)  // This define is conditional!
`endif
```

**Evidence:** In `directive-scanner.ts`, `guard` is retrieved but never attached:
```typescript
const guard = scopeTracker.getGuard();  // Retrieved...
directives.push({
  id: locationId(...),
  kind: 'define',
  location: {...},
  data,
  // guard NOT included!
});
```

**Fix:**
```typescript
export interface Directive {
  id: string;
  kind: DirectiveKind;
  location: Location;
  data: DirectiveData;
  
  /** If inside an `ifdef/`ifndef block, the condition */
  guard?: Guard;  // ADD THIS
}
```

---

## File: `declaration.ts`

### ✅ VERIFIED CORRECT: Discriminated Union

The `DeclarationData` discriminated union is properly typed with `kind` discriminator:
- Each data type has `kind: 'typename'` as literal
- TypeScript can narrow correctly in switch statements
- All 28 declaration kinds have corresponding data types

---

### ℹ️ INFO: Some Data Types Are Empty Markers

Several data types only have `kind`:
- `PackageData`, `ProgramData`, `InitialBlockData`, `SequenceData`, `PropertyData`, `CovergroupData`, `ConstraintData`

This is intentional - these exist for discrimination but have no additional fields. Consider adding a comment explaining this pattern.

---

## File: `instance.ts`

### 🟡 MEDIUM: PortConnection.location is Required But Often Invalid

**Location:** Lines 297-320

**Problem:**
```typescript
export interface PortConnection {
  portName: string;
  signalName: string;
  location: Location;  // REQUIRED, not optional
}
```

But in `instance-scanner.ts`:
```typescript
connections.push({
  portName,
  signalName,
  location: { file: '', line: 0, col: 0 },  // Always invalid!
});
```

**Options:**
1. Make `location` optional: `location?: Location`
2. Fix the scanner to calculate proper locations (harder)

---

### ℹ️ INFO: Instance.parentScope Always Empty

The type correctly defines `parentScope: string[]`, but the scanner always sets it to `[]`. This is a scanner bug, not a type bug. (See scanners/AUDIT.md)

---

## File: `reference.ts`

### ℹ️ INFO: ReferenceData Only Covers 3 of 13 Kinds

**Location:** Lines 214-217

```typescript
export type ReferenceData =
  | ImportReferenceData
  | PortConnReferenceData
  | ExtendsReferenceData;
```

But `ReferenceKind` has 13 types. The other 10 kinds have no extra data.

**Assessment:** This is fine - the `data` field is optional. However, consider adding stub types for completeness or documenting why only 3 kinds have data.

---

## File: `result.ts`

### 🟡 MEDIUM: HierarchyNode Missing `isCyclic` Flag

**Location:** Lines 270-291

**Problem:** When fixing the circular instantiation bug in `project-resolver.ts`, we need to mark cyclic nodes:

```typescript
export interface HierarchyNode {
  instanceName: string;
  moduleName: string;
  moduleId: string;
  file: string;
  line: number;
  children: HierarchyNode[];
  // MISSING: isCyclic?: boolean;
}
```

**Fix:**
```typescript
export interface HierarchyNode {
  instanceName: string;
  moduleName: string;
  moduleId: string;
  file: string;
  line: number;
  children: HierarchyNode[];
  
  /** True if this node represents a cycle (breaks recursion) */
  isCyclic?: boolean;
}
```

---

### 🟢 LOW: FileDependency.reason Could Be Extended

**Location:** Lines 339-340

```typescript
reason: 'instantiates' | 'imports' | 'includes' | 'extends';
```

Consider adding:
- `'uses_type'`: File uses a type from another file
- `'calls'`: File calls a function/task from another file

These might be useful for finer-grained dependency analysis.

---

## File: `file.ts`

### ✅ VERIFIED CORRECT: FileRecord Design

Well-designed for change detection:
- `hash`: SHA-256 for content comparison
- `lastModified`: mtime for quick dirty check
- `size`: Another quick check before hash

---

## File: `index.ts`

### ✅ VERIFIED CORRECT: Export Organization

All exports are properly re-exported from their source modules. The module provides a clean single-import point.

---

## Cross-Module Type Consistency

### Guard Field Presence

| Type | Has `guard?` | Notes |
|------|-------------|-------|
| Declaration | ✅ Yes | Line 216 |
| Reference | ✅ Yes | Line 188 |
| Instance | ✅ Yes | Line 238 |
| Directive | ❌ **No** | Should have it |

**Action:** Add `guard?: Guard` to Directive interface.

### ID Field Formats

| Type | ID Field | Format | Notes |
|------|----------|--------|-------|
| Declaration | `id` | `decl:<hash>` | Unique identity |
| Declaration | `locationId` | `loc:<hash>` | Where it is |
| Reference | `id` | `loc:<hash>` | Only location |
| Instance | `id` | `loc:<hash>` | Only location |
| Directive | `id` | `loc:<hash>` | Only location |
| FileRecord | `id` | `file:<hash>` | File identity |

This is consistent and well-designed. References/Instances/Directives only have location IDs because they don't create new named entities.

---

## Recommended Priority

1. **🟠 Add `guard` field to Directive** - Type consistency, enables tracking conditional defines
2. **🟡 Add `isCyclic` to HierarchyNode** - Supports cycle detection fix
3. **🟡 Make PortConnection.location optional** - Matches actual usage
4. **🟢 Clarify Guard.inverted semantics** - Documentation improvement

---

## Type Safety Recommendations

### 1. Stricter PortData.direction

Currently:
```typescript
direction: 'input' | 'output' | 'inout' | 'ref';
```

Consider extracting:
```typescript
export type PortDirection = 'input' | 'output' | 'inout' | 'ref';
```

### 2. Consider Branded Types for IDs

To prevent mixing up declaration IDs and location IDs:
```typescript
type DeclarationId = string & { readonly brand: 'DeclarationId' };
type LocationId = string & { readonly brand: 'LocationId' };
```

This would catch bugs at compile time where wrong ID types are passed.

### 3. Add JSDoc @see References

Link related types:
```typescript
/**
 * @see DeclarationId - computed from file + kind + name + scope
 * @see LocationId - computed from file + line + col
 */
export interface Declaration {
  id: DeclarationId;
  locationId: LocationId;
  // ...
}
```

---

## Test Scenarios

```typescript
// 1. Guard on directive
const define: Directive = {
  id: 'loc:abc123',
  kind: 'define',
  location: {...},
  data: { kind: 'define', name: 'LOG', body: '...' },
  guard: { condition: 'DEBUG', inverted: false },  // Should work after fix
};

// 2. Cyclic hierarchy node
const cyclic: HierarchyNode = {
  instanceName: 'u_recursive',
  moduleName: 'recursive',
  moduleId: 'decl:xyz',
  file: '/path/file.sv',
  line: 10,
  children: [],
  isCyclic: true,  // Marks break point
};

// 3. Optional port location
const conn: PortConnection = {
  portName: 'clk',
  signalName: 'clock',
  // location is optional after fix
};
```

