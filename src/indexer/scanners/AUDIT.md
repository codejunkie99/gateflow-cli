# Security & Logic Audit: Scanners Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | Scope tracking not integrated in reference/instance scanners |
| 🟠 High | 3 | parentScope always empty; dead code; getGuard inverted logic broken |
| 🟡 Medium | 5 | Unused variables; port locations invalid; signal pattern incomplete |
| 🟢 Low | 3 | Enum value locations imprecise; string bracket counting edge case |
| ℹ️ Info | 2 | Design notes |

---

## File: `scope-tracker.ts`

### 🟠 HIGH: `getGuard()` inverted Field Has Broken Semantics

**Location:** Lines 364-377

**Problem:**
```typescript
getGuard(): { condition: string; inverted: boolean } | undefined {
  // Build combined condition
  const parts = this.guards.map((g) => (g.inverted ? `!${g.macro}` : g.macro));
  const condition = parts.join(' && ');

  // Consider inverted if the innermost guard is inverted
  const inverted = this.guards[this.guards.length - 1].inverted;  // ???

  return { condition, inverted };
}
```

For guards `ifdef A` → `ifndef B`, the result is:
- `condition`: `"A && !B"` ✓
- `inverted`: `true` (because `B` is inverted) ✗

The `inverted` field is meaningless - it's just the innermost guard's inversion, not a property of the combined condition.

**Impact:** Downstream code using `guard.inverted` will get incorrect results.

**Fix:** Either:
1. Remove `inverted` from return type (condition string already includes `!`)
2. Or change semantics to indicate if ALL guards are inverted

```typescript
getGuard(): { condition: string } | undefined {
  if (this.guards.length === 0) return undefined;
  const parts = this.guards.map((g) => (g.inverted ? `!${g.macro}` : g.macro));
  return { condition: parts.join(' && ') };
}
```

---

### ℹ️ INFO: `getParentId()` Naming is Confusing

**Location:** Lines 232-237

```typescript
getParentId(): string | undefined {
  return this.stack[this.stack.length - 1].id;  // Returns CURRENT scope's ID
}
```

The name suggests "parent's ID" but it returns the current (topmost) scope's ID. This is actually CORRECT for how it's used in `declaration-scanner.ts` (when creating a declaration, you want the current scope as parent before entering the new scope), but the naming is confusing.

**Suggestion:** Rename to `getCurrentId()` or add clarifying comment.

---

## File: `directive-scanner.ts`

### 🟡 MEDIUM: Guard Variable Retrieved but Never Used

**Location:** Lines 130, 198 (and similar)

**Problem:**
```typescript
function scanDefines(...) {
  // ...
  const guard = scopeTracker.getGuard();  // Retrieved but NEVER USED!
  
  directives.push({
    id: locationId(filePath, loc.line, loc.col),
    kind: 'define',
    // guard is NOT attached to the directive!
    ...
  });
}
```

**Impact:** Directives don't know what `ifdef` guard they're under.

**Fix:**
```typescript
directives.push({
  id: locationId(filePath, loc.line, loc.col),
  kind: 'define',
  location: { file: filePath, line: loc.line, col: loc.col },
  guard: guard ? { condition: guard.condition, inverted: guard.inverted } : undefined,
  data,
});
```

---

## File: `declaration-scanner.ts`

### 🟢 LOW: Enum Values Share Parent Enum's Location

**Location:** Lines 428-443

**Problem:**
```typescript
events.push({
  type: 'declaration',
  kind: 'enum_value',
  name: valueName,
  loc,  // Same as enum's location for ALL values
  offset: match.index,
  ...
});
```

**Impact:** Can't navigate to specific enum values; all point to enum declaration.

**Suggestion:** Calculate approximate offset for each value within the enum body.

---

### ✅ VERIFIED CORRECT: Scope Tracking in Declaration Scanner

The declaration scanner correctly:
1. Builds sorted events (enter/exit/declaration)
2. Updates `ScopeTracker` as it processes events
3. Attaches correct scope chain to non-container declarations

---

## File: `reference-scanner.ts`

### 🔴 CRITICAL: ScopeTracker Never Updated - All Scopes Empty

**Location:** Lines 82-110

**Problem:**
```typescript
export function scanReferences(...) {
  const scopeTracker = new ScopeTracker();  // Empty tracker

  // NO CALLS to scopeTracker.enter() or scopeTracker.exit()
  
  scanImports(content, filePath, lineOffsets, scopeTracker, references);
  // ...
}
```

Every call to `scopeTracker.getScope()` returns `[]`.
Every call to `scopeTracker.getGuard()` returns `undefined`.

**Impact:**
- All references have `scope: []` - impossible to tell if they're inside a module/class
- No guard tracking - can't tell if reference is under `ifdef`

**Fix:** Either:
1. Accept a pre-populated `ScopeTracker` as parameter (from declaration scanner)
2. Or integrate scope boundary scanning in reference scanner

```typescript
export function scanReferences(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  declarations: Declaration[],
  scopeTracker?: ScopeTracker  // Accept existing tracker
): ReferenceScanResult {
  const tracker = scopeTracker ?? new ScopeTracker();
  // ...
}
```

---

### 🟡 MEDIUM: Unused `declNames` Variable

**Location:** Lines 91-92

**Problem:**
```typescript
// Build set of known declaration names for filtering
const declNames = new Set(declarations.map((d) => d.name));  // NEVER USED!
```

**Impact:** Dead code; no performance impact but confusing.

**Fix:** Remove the variable.

---

### 🟡 MEDIUM: All Scoped Identifiers Marked as `type_usage`

**Location:** Lines 300-326

**Problem:**
```typescript
references.push({
  kind: 'type_usage',  // Always type_usage!
  targetName: `${scopeName}::${memberName}`,
  ...
});
```

`pkg::my_function()` gets marked as `type_usage` instead of `func_call`.

**Impact:** Incorrect classification; may affect resolution logic.

**Fix:** Analyze context to determine if it's a type or function:
```typescript
// Check if followed by '(' for function call
const afterMatch = content.slice(match.index + match[0].length);
const isCall = /^\s*\(/.test(afterMatch);
const kind = isCall ? 'func_call' : 'type_usage';
```

---

## File: `instance-scanner.ts`

### 🔴 CRITICAL: `parentScope` Always Empty

**Location:** Lines 144-153, 209-219, 239-251, 312-321, 349-358

**Problem:**
```typescript
instances.push({
  ...
  parentScope: [],  // ALWAYS EMPTY
  ...
});
```

Every instance has `parentScope: []`, making it impossible to:
- Know which module contains the instance
- Build correct hierarchy
- Resolve scoped references

**Impact:** Hierarchy building in `project-resolver.ts` breaks:
```typescript
// In buildHierarchyNode:
const childInstances = this.instances.filter(
  (i) => i.parentScope[0] === module.name  // Always fails!
);
```

**Fix:** Pass and update a `ScopeTracker`:
```typescript
export function scanInstances(
  content: string,
  filePath: string,
  lineOffsets: LineOffsets,
  declarations: Declaration[],
  scopeTracker?: ScopeTracker
): InstanceScanResult {
  const tracker = scopeTracker ?? createScopeTrackerFromDeclarations(declarations);
  // ...use tracker.getScope() when creating instances
}
```

---

### 🟠 HIGH: Unused Function `determineInstanceKind`

**Location:** Lines 676-690

**Problem:**
```typescript
function determineInstanceKind(
  targetName: string,
  moduleNames: Set<string>,
  interfaceNames: Set<string>,
  checkerNames: Set<string>
): InstanceKind {
  // Never called!
}
```

All instances get `instanceKind: 'module'` even when instantiating interfaces or checkers.

**Impact:** Can't distinguish interface/checker instances from module instances.

**Fix:** Call `determineInstanceKind` when creating instances:
```typescript
const kind = determineInstanceKind(
  moduleName,
  moduleNames,
  interfaceNames,
  checkerNames
);
instances.push({
  instanceKind: kind,  // Instead of hardcoded 'module'
  ...
});
```

---

### 🟡 MEDIUM: Port Connections Have Invalid Locations

**Location:** Lines 437-441, 452-456

**Problem:**
```typescript
connections.push({
  portName,
  signalName,
  location: { file: '', line: 0, col: 0 },  // Invalid!
});
```

**Impact:** Can't navigate to port connection locations.

**Fix:** Calculate proper location from match offset:
```typescript
const connLoc = getLocation(lineOffsets, matchOffset + portMatchIndex);
connections.push({
  portName,
  signalName,
  location: { file: filePath, ...connLoc },
});
```

---

### 🟢 LOW: Bracket Counting Doesn't Handle String Literals

**Location:** Lines 370-385 (`skipBracketedSection`)

**Problem:**
```typescript
while (i < content.length && depth > 0) {
  if (content[i] === '(') depth++;
  else if (content[i] === ')') depth--;
  i++;
}
```

A parameter like `.MSG("Hello (world)")` would break bracket counting.

**Impact:** Rare edge case; preprocessed code should have strings intact.

**Mitigation:** Add string tracking:
```typescript
let inString = false;
let stringChar = '';
while (i < content.length && depth > 0) {
  if (inString) {
    if (content[i] === stringChar && content[i-1] !== '\\') inString = false;
  } else if (content[i] === '"' || content[i] === "'") {
    inString = true;
    stringChar = content[i];
  } else if (content[i] === '(') depth++;
  else if (content[i] === ')') depth--;
  i++;
}
```

---

## File: `patterns.ts`

### 🟡 MEDIUM: Signal Pattern Only Captures First Signal

**Location:** Lines 328-333

**Problem:**
```typescript
signal: /\b(wire|reg|logic)\s*(?:(\[[^\]]+\])\s+)?(\w+)/g,
```

For `wire [7:0] a, b, c;`, only captures `a`.

**Impact:** Signals `b` and `c` are not indexed.

**Fix:** Multiple approaches possible - either:
1. Match entire declaration and split by comma
2. Use separate pass for multi-signal declarations

---

### 🟢 LOW: Parameter Type Pattern Too Simple

**Location:** Lines 314-319

**Problem:**
```typescript
parameter: /\bparameter\s+(?:(\w+)\s+)?(\w+)\s*=\s*([^,;]+)/g,
```

Type capture `(\w+)` misses complex types like `logic [7:0]`, `integer unsigned`.

**Impact:** Parameter type information is incomplete.

---

### ℹ️ INFO: Patterns Work on Preprocessed Code

All patterns are designed for comment-stripped, line-continuation-handled code. This is documented and correct behavior.

---

## Cross-Module Issues

### 🔴 CRITICAL: Scope Tracking Not Integrated Across Scanners

**Root Cause:** Each scanner creates its own `ScopeTracker` or ignores scope entirely.

**Affected:**
- `directive-scanner.ts`: Creates tracker, updates it, but doesn't export/pass it
- `declaration-scanner.ts`: Creates tracker, updates it correctly ✓
- `reference-scanner.ts`: Creates empty tracker, never updates ❌
- `instance-scanner.ts`: Doesn't use tracker at all ❌

**Solution:** Single scope-aware scanning pass or shared tracker:

```typescript
// In file-understander.ts (orchestrator)
const scopeTracker = new ScopeTracker();
const { directives, ifdefState } = scanDirectives(content, file, lineOffsets, scopeTracker);
// scopeTracker now has guard state

// Reset for declaration pass
scopeTracker.reset();
const { declarations } = scanDeclarations(content, file, lineOffsets, scopeTracker);
// scopeTracker now has scope state

// Pass to other scanners
const { references } = scanReferences(content, file, lineOffsets, declarations, scopeTracker);
const { instances } = scanInstances(content, file, lineOffsets, declarations, scopeTracker);
```

---

## Recommended Priority

1. **🔴 Integrate ScopeTracker across all scanners** - Critical for correct resolution
2. **🔴 Fix parentScope in instance-scanner** - Hierarchy building depends on this
3. **🟠 Call determineInstanceKind** - Fix dead code, correct instance types
4. **🟠 Fix getGuard inverted semantics** - Clean up confusing API
5. **🟡 Use guard in directive-scanner** - Attach guard to directives
6. **🟡 Remove unused declNames** - Clean up dead code
7. **🟡 Fix scoped identifier classification** - Correct type_usage vs func_call

---

## Test Cases to Add

```typescript
// 1. Scope tracking integration
// File with: package pkg; class Foo; function bar; endfunction endclass endpackage
const { references } = scanReferences(content, file, offsets, decls, scopeTracker);
// References inside `bar` should have scope: ['pkg', 'Foo', 'bar']
// Currently: scope: []

// 2. Instance parentScope
// File with: module top; counter u_cnt(...); endmodule
const { instances } = scanInstances(...);
assert(instances[0].parentScope[0] === 'top');  // Currently: []

// 3. Interface instance detection
// File with: my_interface if_inst();
const inst = instances.find(i => i.instanceName === 'if_inst');
assert(inst.instanceKind === 'interface');  // Currently: 'module'

// 4. Multi-signal declaration
// wire [7:0] a, b, c;
const signals = declarations.filter(d => d.kind === 'signal');
assert(signals.length >= 3);  // Currently: 1

// 5. Guard tracking for defines
// `ifdef DEBUG \n `define LOG(x) ... \n `endif
const def = directives.find(d => d.kind === 'define' && d.data.name === 'LOG');
assert(def.guard?.condition === 'DEBUG');  // Currently: undefined
```

