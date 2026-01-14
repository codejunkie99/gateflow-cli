# Memory System Bug Report

> Generated: January 15, 2026  
> Scope: `src/memory/knowledge-store/` directory

---

## Critical Bugs

### 🔴 Bug #1: Search Index Not Updated After Stale Pruning

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/KnowledgeStore.ts` |
| **Lines** | 375-381 |
| **Function** | `pruneStaleItems()` |

**Code:**
```typescript
private pruneStaleItems(): void {
    if (!this.index) return;

    const { items, pruned } = pruneStaleItems(this.index.items, this.config.maxUnusedAge);
    if (pruned) {
        this.index.items = items;  // Index not updated!
        this.markDirty();
    }
}
```

**Simple Explanation:**  
When we delete old unused items, we remove them from our list but forget to tell the search engine. The search engine still thinks those deleted items exist and may return them in search results.

---

### 🔴 Bug #2: avgDocLength Corruption on Item Update

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/KnowledgeStore.ts` |
| **Lines** | 252-254 |
| **Function** | `addKnowledge()` |

**Code:**
```typescript
if (contentChanged) {
    this.indexManager.add(existing, this.index.items.length);
}
```

**Simple Explanation:**  
When updating an existing item, we tell the search index the wrong count. The math formula for average document length gets wrong numbers, and over time search results become less accurate.

---

### 🔴 Bug #3: pruneStaleItems Function Lacks Index Access

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/pruning.ts` |
| **Lines** | 40-52 |
| **Function** | `pruneStaleItems()` |

**Code:**
```typescript
export function pruneStaleItems(
    items: KnowledgeItem[],
    maxUnusedAge: number
): { items: KnowledgeItem[]; pruned: boolean } {
    // Only filters array, no index access
    return { items: prunedItems, pruned: prunedItems.length < before };
}
```

**Simple Explanation:**  
This helper function only filters the items array. It has no way to remove items from the search index because it doesn't receive the index manager as a parameter. This is the root cause of Bug #1.

---

## Medium Severity Bugs

### 🟡 Bug #4: destroy() Loses Unsaved Data

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/KnowledgeStore.ts` |
| **Lines** | 212-217 |
| **Function** | `destroy()` |

**Code:**
```typescript
destroy(): void {
    if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
    }
}
```

**Simple Explanation:**  
When shutting down, we cancel any pending save without actually saving first. If you made changes in the last 5 seconds before shutdown, they are lost forever.

---

### 🟡 Bug #5: Aggressive Pruning on Small Stores

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/pruning.ts` |
| **Lines** | 73-74 |
| **Function** | `pruneLowestScoring()` |

**Code:**
```typescript
const removeCount = Math.ceil(index.items.length * 0.1);
```

**Simple Explanation:**  
With only 1-9 items, we still delete at least 1 item (10%). If you have 1 item and need space, you lose your only item. Small knowledge stores get emptied too quickly.

---

### 🟡 Bug #6: Hardcoded `.sv` Extension in File Patterns

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/analysis-utils.ts` |
| **Lines** | 84-86 |
| **Function** | `inferFilePatterns()` |

**Code:**
```typescript
if (commonDir && commonDir !== '.') {
    return [`${commonDir}/**/*.sv`];
}
```

**Simple Explanation:**  
When guessing file patterns from a set of files, we always assume `.sv` (SystemVerilog) extension. If you're working with VHDL files (`.vhd`, `.vhdl`), the pattern is wrong and knowledge won't match correctly.

---

### 🟡 Bug #7: No Input Validation in addKnowledge

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/KnowledgeStore.ts` |
| **Lines** | 221-278 |
| **Function** | `addKnowledge()` |

**Simple Explanation:**  
We accept any input without checking if it makes sense. Empty titles, negative confidence values, or malformed scope objects all get stored. Bad data can corrupt the knowledge base.

---

## Low Severity Issues

### 🟢 Issue #8: No clearGlobalKnowledgeStore Function

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/factory.ts` |
| **Lines** | Entire file |

**Simple Explanation:**  
Once you set the global store, you cannot clear it - only replace it. This makes testing harder because stores leak between tests.

---

### 🟢 Issue #9: PID String Match Could False-Positive

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/lock-manager.ts` |
| **Lines** | 167-173 |
| **Function** | `getStaleInfo()` |

**Code:**
```typescript
const isAlive = result.stdout.includes(lock.pid.toString());
```

**Simple Explanation:**  
We check if a process is alive by searching for its PID number in text. But searching for "123" would also match "1234" or "12345". Unlikely to cause real problems but not robust.

---

### 🟢 Issue #10: Redundant scheduleSave Calls

| Property | Value |
|----------|-------|
| **File** | `src/memory/knowledge-store/extraction.ts` |
| **Lines** | 162-165, 173-174 |
| **Function** | `extractFromLintSession()` |

**Simple Explanation:**  
We call `scheduleSave()` after extraction, but `addKnowledge()` already schedules a save internally. It works fine but wastes a tiny bit of CPU resetting the debounce timer.

---

## Summary

| Severity | Count | Files Affected |
|----------|-------|----------------|
| 🔴 Critical | 3 | KnowledgeStore.ts, pruning.ts |
| 🟡 Medium | 4 | KnowledgeStore.ts, pruning.ts, analysis-utils.ts |
| 🟢 Low | 3 | factory.ts, lock-manager.ts, extraction.ts |

---

## Recommended Fix Priority

1. **Bug #1 + #3**: Fix `pruneStaleItems()` to rebuild index after pruning
2. **Bug #2**: Add `update()` method to `KnowledgeIndexManager` 
3. **Bug #4**: Make `destroy()` async and call `flush()` first
4. **Bug #5**: Add minimum threshold before pruning small stores
5. **Bug #6**: Detect file extension instead of hardcoding `.sv`
