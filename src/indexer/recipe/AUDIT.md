# Security & Logic Audit: Recipe Module

**Date:** January 9, 2026  
**Auditor:** Code Review  
**Severity Scale:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | ℹ️ Info

---

## Executive Summary

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 Critical | 1 | Infinite recursion on circular nested filelists |
| 🟠 High | 1 | Quoted paths not handled (includes quotes in path) |
| 🟡 Medium | 3 | Duplicate files, recipe ID ignores nested content, console.warn |
| 🟢 Low | 2 | Windows env vars, non-SV files silently ignored |
| ℹ️ Info | 1 | Design note |

---

## File: `filelist-parser.ts`

### 🔴 CRITICAL: No Cycle Detection for Nested Filelists

**Location:** Lines 228-244 (`parseLine` - nested filelist handling)

**Problem:**
If `a.f` includes `b.f` and `b.f` includes `a.f`, the parser will recurse infinitely until stack overflow:

```typescript
if (options.recursive !== false) {
  try {
    const nestedRecipe = await this.parse(nestedPath, {
      ...options,
      basePath: path.dirname(nestedPath),
    });
    // NO CHECK if nestedPath was already parsed!
```

**Impact:** Stack overflow crash on circular filelist references (common in legacy projects).

**Fix:**
```typescript
export class FilelistParser {
  private parsedFilelists: Set<string> = new Set();  // Add this

  async parse(filelistPath: string, options: ParseFilelistOptions = {}): Promise<Recipe> {
    const absolutePath = path.resolve(filelistPath);
    
    // Check for cycle
    if (this.parsedFilelists.has(absolutePath)) {
      console.warn(`Circular filelist reference detected: ${absolutePath}`);
      return this.createEmptyRecipe(absolutePath);
    }
    this.parsedFilelists.add(absolutePath);
    
    // ... rest of parsing
  }
}
```

**Alternative:** Pass a `visited: Set<string>` through options.

---

### 🟠 HIGH: Quoted Paths Include Quotes in Result

**Location:** Lines 206, 223, 249, 259 (all regex matches)

**Problem:**
Paths with quotes are captured INCLUDING the quotes:

```typescript
// +incdir+"/path/with spaces"
const incdirMatch = line.match(/^\+incdir\+(.+)$/);
// Captures: "/path/with spaces" (with quotes!)

// -f "/path/to file.f"  
const nestedMatch = line.match(/^-[fF]\s+(.+)$/);
// Captures: "/path/to file.f" (with quotes!)
```

**Impact:** File resolution fails because paths include literal quote characters.

**Fix:**
```typescript
private stripQuotes(str: string): string {
  // Remove surrounding quotes if present
  const trimmed = str.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Usage:
const incPath = this.resolvePath(this.stripQuotes(incdirMatch[1]), basePath);
```

---

### 🟡 MEDIUM: Duplicate Files Not Deduplicated

**Location:** Lines 262, 275, 328

**Problem:**
Files can be added multiple times:

```typescript
// In parseLine:
recipe.files.push(filePath);  // No check for duplicates

// In mergeRecipe:
parent.files.push(...child.files);  // No deduplication
```

If `common.sv` appears in both `base.f` and `tb.f`, it will be in `recipe.files` twice.

**Impact:**
- Compilation warnings about duplicate files
- Wasted processing time indexing same file twice

**Fix:**
```typescript
// In parseLine:
if (!recipe.files.includes(filePath)) {
  recipe.files.push(filePath);
}

// Or use a Set internally and convert to array at end
```

---

### 🟡 MEDIUM: Recipe ID Ignores Nested Filelist Content

**Location:** Line 176

**Problem:**
```typescript
recipe.id = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
```

The ID is computed from top-level content only. If a nested filelist changes, the parent recipe's ID stays the same.

**Impact:**
- Cache invalidation may not trigger when nested filelists change
- Recipe comparison may incorrectly report "same" when nested content differs

**Fix:**
```typescript
// After merging all nested recipes, recompute ID:
private finalizeRecipeId(recipe: Recipe): void {
  const fullContent = [
    recipe.sourceFile,
    ...recipe.nestedFilelists,
    ...recipe.files,
    JSON.stringify(recipe.defines),
  ].join('\n');
  
  recipe.id = crypto.createHash('sha256')
    .update(fullContent)
    .digest('hex')
    .slice(0, 16);
}
```

---

### 🟡 MEDIUM: `console.warn` in Library Code

**Location:** Lines 240-242

**Problem:**
```typescript
console.warn(
  `Warning: Failed to parse nested filelist ${nestedPath}: ${error}`
);
```

**Impact:**
- No way to suppress warnings
- No way to capture warnings programmatically
- Pollutes stdout in CI/CD environments

**Fix:**
```typescript
// Option 1: Add errors to recipe
interface Recipe {
  // ... existing fields
  warnings: string[];  // Add this
}

// Option 2: Accept logger in options
interface ParseFilelistOptions {
  // ... existing fields
  onWarning?: (message: string) => void;
}
```

---

### 🟢 LOW: Windows-Style Environment Variables Not Supported

**Location:** Lines 297-302 (`expandEnvVars`)

**Problem:**
```typescript
// Handles: $VAR and ${VAR}
// Missing: %VAR% (Windows style)
return inputPath.replace(/\$\{?(\w+)\}?/g, (match, varName) => {
```

**Impact:** Windows filelists using `%VAR%` syntax won't expand.

**Note:** Most SV tools use Unix-style even on Windows, so this may be acceptable.

**Fix (if needed):**
```typescript
private expandEnvVars(inputPath: string): string {
  // Unix style: $VAR and ${VAR}
  let result = inputPath.replace(/\$\{?(\w+)\}?/g, (match, varName) => {
    return process.env[varName] || match;
  });
  
  // Windows style: %VAR%
  result = result.replace(/%(\w+)%/g, (match, varName) => {
    return process.env[varName] || match;
  });
  
  return result;
}
```

---

### 🟢 LOW: Non-SV Files Silently Ignored

**Location:** Lines 272-276

**Problem:**
```typescript
// Assume anything else is a file path
if (this.looksLikeSvFile(line)) {
  const filePath = this.resolvePath(line, basePath);
  recipe.files.push(filePath);
}
// If not SV file, silently ignored!
```

**Impact:** Files like `config.dat`, `memory.hex` in filelists are silently dropped.

**Note:** This may be intentional to avoid garbage. Consider adding a warning.

---

### ℹ️ INFO: +define Regex Limitations

**Location:** Line 216

```typescript
const defineMatch = line.match(/^\+define\+(\w+)(?:=(.*))?$/);
```

**Observations:**
- Macro names: Only `\w+` (letters, numbers, underscore) - correct for SV
- Macro values: `.*` captures everything including quotes - this is correct
- Complex values like `+define+MSG="hello world"` work correctly

**Status:** No issue - this is correct behavior.

---

## File: `index.ts`

### ✅ Clean

All exports correctly match their source definitions.

---

## Verified Correct ✅

| Component | Status | Notes |
|-----------|--------|-------|
| `+incdir+` parsing | ⚠️ | Quotes not stripped |
| `+define+` parsing | ✅ | Handles all valid cases |
| `-f`/`-F` parsing | ⚠️ | Quotes not stripped |
| `-y` parsing | ⚠️ | Quotes not stripped |
| `-v` parsing | ⚠️ | Quotes not stripped |
| `expandEnvVars()` | ⚠️ | Unix only, no Windows |
| `resolvePath()` | ✅ | Correct path resolution |
| `mergeRecipe()` | ⚠️ | No file deduplication |
| `looksLikeSvFile()` | ✅ | Correct extensions |
| `getCompileOrder()` | ✅ | Returns copy correctly |
| `resolveInclude()` | ✅ | Correct search order |
| `hasMacro()` | ✅ | Correct check |
| `getMacroValue()` | ✅ | Correct retrieval |

---

## Test Cases to Add

```typescript
// 1. Circular filelist detection
// a.f contains: -f b.f
// b.f contains: -f a.f
const recipe = await parseFilelist('a.f');
// Should NOT stack overflow!

// 2. Quoted paths
const recipe = await parseFilelist('test.f');
// test.f contains: +incdir+"/path/with spaces"
assert(!recipe.includePaths[0].includes('"'));

// 3. Duplicate file handling
// main.f contains same file twice
const recipe = await parseFilelist('main.f');
const unique = new Set(recipe.files);
assert(unique.size === recipe.files.length);  // Currently FAILS

// 4. Windows env vars (if supported)
process.env.MY_PATH = '/some/path';
// filelist contains: +incdir+%MY_PATH%
// Currently: NOT expanded

// 5. Recipe ID changes when nested content changes
const recipe1 = await parseFilelist('main.f');
// Modify nested.f
const recipe2 = await parseFilelist('main.f');
assert(recipe1.id !== recipe2.id);  // Currently FAILS

// 6. Error collection instead of console.warn
const recipe = await parseFilelist('with_missing_nested.f');
assert(recipe.warnings.length > 0);  // Needs implementation
```

---

## Recommended Priority

1. **🔴 Add cycle detection** - Prevents crash on circular filelists
2. **🟠 Strip quotes from paths** - Fixes path resolution failures
3. **🟡 Deduplicate files** - Prevents duplicate processing
4. **🟡 Fix recipe ID to include nested content** - Correct cache invalidation
5. **🟡 Replace console.warn** - Better error handling

