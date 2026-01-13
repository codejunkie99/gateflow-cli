# KnowledgeStore Architecture Deep Dive

> **Purpose**: This document provides a comprehensive analysis of the KnowledgeStore system, including its architecture, algorithms, bugs, and the critical missing integration with the Indexer.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Structures](#data-structures)
4. [Query System](#query-system)
5. [BM25 Search Algorithm](#bm25-search-algorithm)
6. [Context Generation](#context-generation)
7. [Pruning Strategies](#pruning-strategies)
8. [Knowledge Extraction Helpers](#knowledge-extraction-helpers)
9. [Factory Pattern & Global Access](#factory-pattern--global-access)
10. [Dependencies](#dependencies)
11. [Critical Gap: Indexer Integration](#critical-gap-indexer-integration)
12. [Known Bugs](#known-bugs)
13. [Industry Patterns](#industry-patterns)
14. [Recommended Improvements](#recommended-improvements)

---

## Overview

The `KnowledgeStore` is a persistent knowledge base that stores learned patterns from working with a project. It uses BM25 scoring with an inverted index for O(k) candidate selection during search.

### What It Stores

| Type | Description | Extractor Exists? |
|------|-------------|-------------------|
| `lint_fix` | Solutions to lint errors | ✅ `extractFromLintSession` |
| `code_pattern` | Recurring code structures | ⚠️ Partial (`extractFromCodeGen`) |
| `style_preference` | Formatting/style choices | ✅ `learnFromCorrection` |
| `module_info` | Information about specific modules | ❌ **MISSING** |
| `dependency` | Module relationships | ❌ **MISSING** |
| `project_context` | General project information | ❌ **MISSING** |
| `test_pattern` | Testing conventions | ❌ **MISSING** |
| `workflow` | Process knowledge | ❌ **MISSING** |
| `debug_solution` | Debugging knowledge | ❌ **MISSING** |
| `tool_usage` | Tool usage patterns | ❌ **MISSING** |

### File Locations

```
~/.gateflow/
├── {projectId}-knowledge.json    # Knowledge data
└── {projectId}-knowledge.lock    # File lock for concurrent access
```

---

## Architecture

### Class Structure

```typescript
class KnowledgeStore {
    // Configuration
    private config: KnowledgeStoreConfig;
    private projectId: string;              // MD5 hash of project path (12 chars)

    // Persistence
    private index: KnowledgeIndex | null;   // The loaded data
    private knowledgePath: string;          // Path to JSON file
    private lockPath: string;               // Path to lock file
    private dirty: boolean;                 // Has data changed?

    // Concurrency
    private ioMutex: AsyncMutex;            // Intra-process safety
    private lockAcquired: boolean;          // File lock state

    // In-Memory Indices (rebuilt on load)
    private itemById: Map<string, KnowledgeItem>;
    private itemByFingerprint: Map<string, KnowledgeItem>;
    private invertedIndex: Map<string, Set<string>>;  // term → item IDs
    private docLengths: Map<string, number>;          // item ID → word count
    private termDocFreq: Map<string, number>;         // term → doc count
    private avgDocLength: number;
}
```

### Lifecycle Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        LIFECYCLE                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   load()                                                         │
│     │                                                            │
│     ├─→ Create directory if needed                              │
│     ├─→ Read JSON file (or create default)                      │
│     ├─→ Migrate schema if needed                                │
│     ├─→ Prune stale items                                       │
│     └─→ Rebuild all in-memory indices                           │
│                                                                  │
│   addKnowledge() / removeKnowledge() / markUsed()               │
│     │                                                            │
│     ├─→ Update in-memory data                                   │
│     ├─→ Update indices                                          │
│     ├─→ Set dirty = true                                        │
│     └─→ Schedule debounced save (5 seconds)                     │
│                                                                  │
│   save()                                                         │
│     │                                                            │
│     ├─→ Acquire file lock                                       │
│     ├─→ Write to temp file                                      │
│     ├─→ Atomic rename                                           │
│     ├─→ Release lock                                            │
│     └─→ Set dirty = false                                       │
│                                                                  │
│   flush()                                                        │
│     │                                                            │
│     ├─→ Cancel pending debounced save                           │
│     └─→ Save immediately if dirty                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Atomic Write Pattern

The save operation uses a crash-safe atomic write pattern:

```typescript
// 1. Write to temporary file
const tempPath = `${this.knowledgePath}.${Date.now()}.tmp`;
await fs.writeFile(tempPath, JSON.stringify(this.index, null, 2));

// 2. Atomic rename (safe on most filesystems)
await fs.rename(tempPath, this.knowledgePath);
```

**Why this matters**: If a crash occurs during write, the original file remains intact. The rename operation is atomic on most filesystems.

---

## Data Structures

### KnowledgeItem

```typescript
interface KnowledgeItem {
    id: string;              // UUID - unique identifier
    fingerprint: string;     // Hash for deduplication
    type: KnowledgeType;     // Category (lint_fix, module_info, etc.)
    title: string;           // Human-readable short description
    content: string;         // The actual knowledge content
    tags: string[];          // Categorical labels for filtering
    keywords: string[];      // Terms for search relevance
    scope: KnowledgeScope;   // Where this knowledge applies
    source: KnowledgeSource; // How this was obtained
    confidence: number;      // 0-1 reliability score
    useCount: number;        // Retrieval count
    lastAccessed: number;    // Unix timestamp
    created: number;         // Unix timestamp
    updated: number;         // Unix timestamp
}
```

### KnowledgeScope

Defines WHERE knowledge applies:

```typescript
interface KnowledgeScope {
    global: boolean;           // Applies everywhere?
    projectIds?: string[];     // Specific projects only
    filePatterns?: string[];   // Glob patterns (e.g., "src/**/*.sv")
    modules?: string[];        // Specific module names
}
```

**Scope matching uses fail-closed semantics**: If an item is scoped to specific modules and the query doesn't provide module context, the item is EXCLUDED (safe default).

### Inverted Index Structure

The inverted index maps terms to documents:

```
Term              │ Document IDs
──────────────────┼─────────────────
"reset"           │ { "item-a", "item-b", "item-c" }
"clock"           │ { "item-a", "item-d" }
"uart"            │ { "item-b" }
"fsm"             │ { "item-c", "item-d", "item-e" }
```

**Search process**:
1. Tokenize query: "reset clock" → ["reset", "clock"]
2. Lookup each term in inverted index
3. Union results: {a, b, c} ∪ {a, d} = {a, b, c, d}
4. Score each candidate with BM25
5. Sort by score, return top N

**Complexity**: O(k) where k = number of matching documents, NOT O(n) scanning all documents.

---

## Query System

### How Searches Work

The KnowledgeStore uses a query-based search system. Understanding this is critical because it's how knowledge gets retrieved.

### KnowledgeQuery Interface

```typescript
interface KnowledgeQuery {
    query?: string;          // Text search terms
    types?: KnowledgeType[]; // Filter by knowledge type
    tags?: string[];         // Filter by tags
    filePath?: string;       // Scope to specific file
    moduleName?: string;     // Scope to specific module
    maxResults?: number;     // Limit results (default: 10)
    minConfidence?: number;  // Minimum confidence threshold
}
```

**Analogy**: Like filtering a restaurant menu:
- `query` = "I want something with chicken" (text search)
- `types` = "Only show main courses" (category filter)
- `tags` = "Only show spicy dishes" (tag filter)
- `maxResults` = "Show me top 5" (limit)

### KnowledgeSearchResult Interface

```typescript
interface KnowledgeSearchResult {
    item: KnowledgeItem;  // The matched knowledge item
    relevance: number;    // Score from 0-1 (higher = better match)
    matchReason: string;  // Human-readable explanation of why it matched
}
```

### Search Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        SEARCH FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   search(query)                                                 │
│        │                                                        │
│        ▼                                                        │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ 1. CANDIDATE SELECTION (via inverted index)             │  │
│   │    - Tokenize query: "reset clock" → ["reset", "clock"] │  │
│   │    - Lookup each term in inverted index                 │  │
│   │    - Union results: {a,b,c} ∪ {a,d} = {a,b,c,d}        │  │
│   │    - If no query terms, use ALL items as candidates     │  │
│   └─────────────────────────────────────────────────────────┘  │
│        │                                                        │
│        ▼                                                        │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ 2. FILTERING                                            │  │
│   │    - Filter by types (if specified)                     │  │
│   │    - Filter by tags (if specified)                      │  │
│   │    - Filter by minConfidence (if specified)             │  │
│   │    - Filter by scope (file patterns, modules)           │  │
│   └─────────────────────────────────────────────────────────┘  │
│        │                                                        │
│        ▼                                                        │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ 3. SCORING                                              │  │
│   │    - If query terms exist: use BM25 scoring             │  │
│   │    - If no query terms: use basic scoring (recency/use) │  │
│   └─────────────────────────────────────────────────────────┘  │
│        │                                                        │
│        ▼                                                        │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ 4. RANKING & RETURN                                     │  │
│   │    - Sort by score descending                           │  │
│   │    - Return top N results (maxResults)                  │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Basic Scoring (Fallback)

When no query text is provided, `scoreBasic()` is used instead of BM25:

```typescript
private scoreBasic(item: KnowledgeItem): number {
    const daysSinceAccess = (Date.now() - item.lastAccessed) / (24 * 60 * 60 * 1000);
    const recency = Math.max(0, 0.2 - daysSinceAccess * 0.01);
    return item.confidence * 0.6 + recency + Math.min(item.useCount * 0.02, 0.2);
}
```

**Score breakdown**:
- **60%** from confidence (how reliable is this knowledge?)
- **Recency bonus**: Starts at 0.2, loses 0.01 per day since last access
- **Use count bonus**: 0.02 per use, capped at 0.2 (max 10 uses matter)

**Analogy**: Ranking your notes without a search topic:
- "How confident am I in this note?" (60%)
- "Did I look at this recently?" (up to 20%)
- "Do I use this note often?" (up to 20%)

### Match Reason Generation

The `getMatchReason()` method creates human-readable explanations:

```typescript
// Examples:
"Keywords: reset, clock"           // Matched on keywords
"Tags: lint, fsm"                  // Matched on tags
"Module: uart_tx"                  // Matched on module scope
"Keywords: reset; Module: uart_tx" // Multiple reasons
"General relevance"                // No specific reason identified
```

---

## BM25 Search Algorithm

### Overview

BM25 (Best Matching 25) is a probabilistic ranking function used by search engines like Elasticsearch.

### The Formula

```
                    IDF × TF × (k₁ + 1)
score(term) = ─────────────────────────────────────────
               TF + k₁ × (1 - b + b × (docLen / avgLen))
```

Where:
- **TF** = term frequency in document
- **IDF** = inverse document frequency (rarity of term)
- **k₁** = 1.2 (saturation parameter)
- **b** = 0.75 (length normalization)
- **docLen** = document length in tokens
- **avgLen** = average document length

### IDF Calculation

```typescript
const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
```

- If term appears in MANY documents → low IDF (common, less useful)
- If term appears in FEW documents → high IDF (rare, distinctive)

Example with N=500 documents:
- "the" in 450 docs → IDF ≈ 0.1
- "uart" in 5 docs → IDF ≈ 4.6

### Final Score Blending

```typescript
const normalized = Math.min(score / 10, 1);  // Normalize to 0-1
return normalized * 0.7 + item.confidence * 0.3;  // Blend with confidence
```

The final relevance score is:
- 70% text relevance (BM25)
- 30% confidence score

---

## Context Generation

### getContextKnowledge() - The Main AI Interface

This is THE most important method for AI integration. It generates formatted context that gets injected into AI prompts.

```typescript
getContextKnowledge(
    filePath?: string,       // What file is the user working on?
    moduleName?: string,     // What module are they in?
    taskDescription?: string, // What are they trying to do?
    maxTokens = 1000         // Token budget (≈ words × 1.3)
): string
```

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                  getContextKnowledge() FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   1. Search for relevant knowledge                              │
│      └─ search({ query: taskDescription, filePath, moduleName,  │
│                  maxResults: 20, minConfidence: 0.5 })          │
│                                                                 │
│   2. If no results → return empty string                        │
│                                                                 │
│   3. Build output with token budget:                            │
│      ┌──────────────────────────────────────────────────────┐  │
│      │  Start with "## Relevant Knowledge\n"  (10 tokens)   │  │
│      │                                                       │  │
│      │  For each result:                                     │  │
│      │    - Format: "### {title}\n{content}\n"              │  │
│      │    - Estimate tokens                                  │  │
│      │    - If (total + itemTokens) > maxTokens → STOP      │  │
│      │    - Otherwise: add to output, mark item as used     │  │
│      └──────────────────────────────────────────────────────┘  │
│                                                                 │
│   4. Return formatted markdown string                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Output Format

```markdown
## Relevant Knowledge

### Module: uart_tx
Has ports: clk, rst_n, tx_data[7:0], tx_valid, tx_ready
Uses 2-always FSM pattern with IDLE, TRANSMIT, DONE states.

### Lint pattern: unused signal
Error: signal 'ID' is declared but never used
Suggested fix: Remove the signal or connect it to logic.

### User preference: naming convention
Before: mySignal, dataIn
After: my_signal, data_in
```

### Why markUsed() Is Called

Every time an item is included in context, `markUsed(item.id)` is called. This:
1. Increments `useCount` (makes item score higher in future searches)
2. Updates `lastAccessed` timestamp (prevents item from being pruned)
3. Schedules a debounced save

**Analogy**: Like a library book. Every time you check it out, the system notes "this book is popular, don't throw it away."

---

## Pruning Strategies

The KnowledgeStore has a default limit of 500 items. When storage is full, items must be removed to make room for new knowledge.

### Strategy 1: Time-Based Pruning (pruneStaleItems)

Called automatically on `load()`.

```typescript
private pruneStaleItems(): void {
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

    this.index.items = this.index.items.filter(item => {
        const age = Date.now() - item.lastAccessed;
        // Keep if: used recently OR provided by user
        return age < maxAge || item.source.method === 'user_provided';
    });
}
```

**Rules**:
- If item hasn't been accessed in 30 days → DELETE
- **Exception**: User-provided knowledge is NEVER deleted by time

**Analogy**: Cleaning out your fridge. Throw out anything older than a month, but never throw out grandma's secret sauce.

### Strategy 2: Score-Based Pruning (pruneLowestScoring)

Called when trying to add a new item but already at `maxItems` limit.

```typescript
private pruneLowestScoring(): void {
    // 1. Score every item
    const scored = this.index.items.map(item => ({
        item,
        score: this.pruneScore(item, Date.now())
    }));

    // 2. Sort lowest to highest
    scored.sort((a, b) => a.score - b.score);

    // 3. Delete bottom 10%
    const removeCount = Math.ceil(this.index.items.length * 0.1);
    const toRemove = scored.slice(0, removeCount);

    // 4. Remove from indices and items array
    for (const { item } of toRemove) {
        this.removeFromIndices(item);
    }
    this.index.items = this.index.items.filter(i => !toRemove.includes(i));
}
```

### The Prune Score Formula

```typescript
private pruneScore(item: KnowledgeItem, now: number): number {
    let score = item.confidence * 10      // Reliable stuff survives
              + item.useCount * 2;        // Frequently used survives

    const daysSinceAccess = (now - item.lastAccessed) / (24 * 60 * 60 * 1000);
    score -= daysSinceAccess;             // Old unused stuff dies

    if (item.source.method === 'user_provided') {
        score += 20;                      // User stuff gets huge bonus
    }

    return score;
}
```

**Score components**:
| Factor | Weight | Example |
|--------|--------|---------|
| confidence | ×10 | 0.9 confidence = +9 points |
| useCount | ×2 | Used 5 times = +10 points |
| daysSinceAccess | -1/day | 30 days old = -30 points |
| user_provided | +20 flat | Always +20 if from user |

**Analogy**: Your closet is full. What do you throw out?
- Keep: Expensive clothes (high confidence)
- Keep: Clothes you wear often (high useCount)
- Throw out: Clothes you haven't worn in months (old)
- Never throw out: Gifts from family (user_provided)

### Pruning Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      PRUNING FLOW                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   load()                                                        │
│     │                                                           │
│     └──→ pruneStaleItems()                                      │
│            └── Remove items older than 30 days                  │
│                (except user_provided)                           │
│                                                                 │
│   addKnowledge() when items.length >= maxItems                  │
│     │                                                           │
│     └──→ pruneLowestScoring()                                   │
│            └── Score all items                                  │
│            └── Remove bottom 10%                                │
│            └── Now there's room for new item                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Knowledge Extraction Helpers

These private methods do the "smart" work of analyzing code and errors. They're the intelligence behind the extraction methods.

### normalizeErrorMessage() - Pattern Grouping

Makes error messages comparable by replacing specific values with placeholders.

```typescript
private normalizeErrorMessage(message: string): string {
    return message
        .replace(/\b\d+\b/g, 'N')           // Numbers → N
        .replace(/'[^']+'/g, "'ID'")        // 'foo' → 'ID'
        .replace(/"[^"]+"/g, '"ID"')        // "foo" → "ID"
        .replace(/:\s*\d+/g, ':N')          // :42 → :N
        .replace(/\s+/g, ' ')               // Normalize whitespace
        .trim();
}
```

**Example**:
```
Input:  "Signal 'my_signal' at line 42 is unused"
Output: "Signal 'ID' at line N is unused"

Input:  "Signal 'other_signal' at line 99 is unused"
Output: "Signal 'ID' at line N is unused"  // Same pattern!
```

**Why?** If you see the same normalized pattern 10 times, that's ONE learnable pattern, not 10 different errors.

### extractKeywordsFromError() - HDL-Specific Keywords

Pulls out important terms from error messages for search indexing.

```typescript
private extractKeywordsFromError(message: string): string[] {
    const keywords: string[] = [];

    // HDL keywords
    const hdlKeywords = message.match(
        /\b(module|interface|signal|wire|reg|logic|port|assign|always|process|clk|reset|rst)\b/gi
    );

    // Error type keywords
    const errorTypes = message.match(
        /\b(unused|undeclared|undriven|missing|syntax|type|width|mismatch)\b/gi
    );

    return [...new Set([...hdlKeywords, ...errorTypes])].map(k => k.toLowerCase());
}
```

**Example**:
```
Input:  "module uart_tx has unused signal clk_div"
Output: ["module", "signal", "clk", "unused"]
```

### inferFilePatterns() - Scope Detection

Guesses glob patterns from a set of files that share a problem.

```typescript
private inferFilePatterns(files: Set<string>): string[] | undefined {
    if (files.size === 0) return undefined;
    if (files.size > 5) return undefined;  // Too many = don't scope

    // Find common directory
    const dirs = [...files].map(f => path.dirname(f));
    const commonDir = this.findCommonPrefix(dirs);

    if (commonDir && commonDir !== '.') {
        return [`${commonDir}/**/*.sv`];
    }
    return undefined;
}
```

**Example**:
```
Input:  ["src/rtl/uart.sv", "src/rtl/spi.sv", "src/rtl/i2c.sv"]
Output: ["src/rtl/**/*.sv"]
```

### analyzeDiff() - Understanding Changes

Analyzes before/after code to determine what type of change was made.

```typescript
private analyzeDiff(original: string, corrected: string): {
    description: string;
    tags: string[];
    keywords: string[];
} | null
```

**Detected patterns**:

| Change Type | Detection | Tags |
|-------------|-----------|------|
| always → always_ff | `/always\s+@/` → `/always_ff/` | `always-block`, `sv2k` |
| Reset handling added | Reset pattern in corrected, not original | `reset`, `synchronous` |
| Naming convention | snake_case ↔ camelCase change | `naming`, `{style}` |
| Whitespace only | Same content after removing whitespace | `formatting`, `whitespace` |
| Comments added | `//` in corrected, not original | `documentation`, `comments` |

**Example**:
```typescript
analyzeDiff("always @(posedge clk)", "always_ff @(posedge clk)")
// Returns:
{
    description: "always to always_ff/always_comb",
    tags: ["always-block", "sv2k"],
    keywords: ["always", "always_ff", "always_comb"]
}
```

### detectNamingStyle() - Style Detection

Determines if code uses snake_case or camelCase.

```typescript
private detectNamingStyle(identifiers: string[]): string {
    let snakeCount = 0;  // Count of identifiers with underscores
    let camelCount = 0;  // Count of identifiers with CamelHumps

    for (const id of identifiers.slice(0, 20)) {
        if (id.includes('_')) snakeCount++;
        if (/[a-z][A-Z]/.test(id)) camelCount++;
    }

    if (snakeCount > camelCount * 2) return 'snake_case';
    if (camelCount > snakeCount * 2) return 'camelCase';
    return 'mixed';
}
```

### analyzeGeneratedCode() - Code Analysis

Extracts meaningful information from generated code.

**For FSMs**:
```typescript
// Finds: typedef enum { IDLE, RUNNING, DONE } state_t;
// Returns: {
//     name: "FSM with 3 states",
//     summary: "State machine with states: IDLE, RUNNING, DONE",
//     tags: ["fsm", "state-machine"],
//     keywords: ["fsm", "state", "enum", "idle", "running", "done"]
// }
```

**For Testbenches**:
```typescript
// Finds: uart_tx dut (.clk(clk), .rst(rst), ...);
// Returns: {
//     name: "Testbench for uart_tx",
//     summary: "Testbench instantiating uart_tx",
//     tags: ["testbench", "verification"],
//     keywords: ["testbench", "tb", "dut"]
// }
```

**For Modules**:
```typescript
// Finds: module uart_tx (...); always_ff @(...) ...
// Returns: {
//     name: "uart_tx",
//     summary: "Module uart_tx",
//     tags: ["sequential"],
//     keywords: ["always_ff", "sequential", "clk"]
// }
```

### detectCorrectionType() - Auto-Classification

Automatically determines what type of knowledge a user correction represents.

```typescript
private detectCorrectionType(original: string, corrected: string): KnowledgeType {
    // Pure whitespace change = style preference
    if (original.replace(/\s/g, '') === corrected.replace(/\s/g, '')) {
        return 'style_preference';
    }

    // Always block type change = code pattern
    if (/always_ff|always_comb/.test(corrected) !== /always_ff|always_comb/.test(original)) {
        return 'code_pattern';
    }

    // Reset handling change = code pattern
    if (/\b(rst|reset)\b/i.test(corrected) !== /\b(rst|reset)\b/i.test(original)) {
        return 'code_pattern';
    }

    // Default
    return 'style_preference';
}
```

### toGlobPattern() - Path to Glob

Converts a specific file path to a glob pattern for scoping.

```typescript
private toGlobPattern(filePath: string): string {
    const ext = path.extname(filePath);   // ".sv"
    const dir = path.dirname(filePath);   // "src/rtl"
    return `${dir}/**/*${ext}`;           // "src/rtl/**/*.sv"
}
```

---

## Factory Pattern & Global Access

The KnowledgeStore uses a factory pattern with global singleton access.

### Why?

Different parts of the codebase need access to the same knowledge store without passing it through every function call.

### The Pattern

```typescript
// Private global variable
let globalStore: KnowledgeStore | null = null;

// Get the current global store (might be null if not initialized)
export function getKnowledgeStore(): KnowledgeStore | null {
    return globalStore;
}

// Create a new store instance (doesn't set it as global)
export function createKnowledgeStore(
    projectRoot: string,
    bus: EventBus,
    config?: Partial<KnowledgeStoreConfig>
): KnowledgeStore {
    return new KnowledgeStore(projectRoot, bus, config);
}

// Set a store as THE global store
export function setGlobalKnowledgeStore(store: KnowledgeStore): void {
    globalStore = store;
}
```

### Usage Pattern

```typescript
// At application startup:
const store = createKnowledgeStore('/path/to/project', eventBus);
await store.load();
setGlobalKnowledgeStore(store);

// Anywhere else in the codebase:
const store = getKnowledgeStore();
if (store) {
    const results = store.search({ query: 'reset handling' });
}
```

### destroy() Method

Cleanup method called when shutting down:

```typescript
destroy(): void {
    if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
    }
}
```

**Why?** If there's a pending debounced save, cancel it. Otherwise, the timeout might fire after the application has shut down, causing errors.

**Analogy**: When leaving the house, turn off the oven timer. Don't let it beep when nobody's home.

---

## Dependencies

### External Libraries

#### picomatch

**Purpose**: Glob pattern matching for scope checks.

**Used in**: `matchesScope()` to check if a file path matches a scope pattern.

```typescript
import picomatch from 'picomatch';

// Usage:
picomatch.isMatch("src/rtl/uart.sv", "src/**/*.sv")  // true
picomatch.isMatch("test/tb.sv", "src/**/*.sv")       // false

// With options:
picomatch.isMatch(path, pattern, {
    dot: true,                              // Match dotfiles
    nocase: process.platform === 'win32'    // Case-insensitive on Windows
});
```

#### crypto (Node.js built-in)

**Purpose**: Hashing for project IDs and fingerprints.

```typescript
import * as crypto from 'crypto';

// Project ID (12-char MD5 hash of project path):
crypto.createHash('md5')
    .update('/path/to/project')
    .digest('hex')
    .slice(0, 12);  // "a1b2c3d4e5f6"

// Fingerprint (16-char SHA256 hash):
crypto.createHash('sha256')
    .update(`${type}|${title}|${scope}`)
    .digest('hex')
    .slice(0, 16);

// UUID generation:
crypto.randomUUID();  // "550e8400-e29b-41d4-a716-446655440000"
```

### Internal Dependencies

#### AsyncMutex

**Purpose**: Prevents race conditions when multiple operations try to read/write simultaneously.

**Location**: `src/concurrency/index.js`

```typescript
import { AsyncMutex } from '../concurrency/index.js';

private ioMutex = new AsyncMutex();

// Usage - ensures only one operation runs at a time:
async load(): Promise<KnowledgeIndex> {
    return this.ioMutex.withLock(async () => {
        // Only one load() can run at a time
        // Other calls wait in queue
    });
}
```

**Analogy**: A bathroom with a lock. Only one person can use it at a time; others wait outside.

#### estimateTokens

**Purpose**: Estimates how many tokens a string will use in an AI model.

**Location**: `src/memory/utils.js`

```typescript
import { estimateTokens } from './utils.js';

// Usage in getContextKnowledge():
const text = "### Module: uart_tx\nHas ports: clk, rst_n...";
const tokens = estimateTokens(text);  // Approximately words × 1.3

if (totalTokens + tokens > maxTokens) {
    break;  // Stop adding more context
}
```

#### EventBus

**Purpose**: Event system for publishing/subscribing to events.

**Location**: `src/events/index.js`

```typescript
import type { EventBus } from '../events/index.js';

constructor(
    private projectRoot: string,
    private bus: EventBus,  // Passed in but NOT CURRENTLY USED
    config?: Partial<KnowledgeStoreConfig>
) { ... }
```

**Note**: The EventBus is passed to the constructor but is not actually used in the current implementation. It's likely there for future use (e.g., emitting events when knowledge is added/removed).

---

## Critical Gap: Indexer Integration

### The Problem

The KnowledgeStore and Indexer are completely disconnected:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT STATE (BROKEN)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐                    ┌──────────────────────┐  │
│   │   INDEXER    │                    │       MEMORY         │  │
│   │              │      NO LINK       │                      │  │
│   │  SVIndexer   │ ←───────────────→  │  MemoryService       │  │
│   │              │                    │    ├─ MemoryManager  │  │
│   │  Produces:   │                    │    └─ KnowledgeStore │  │
│   │  - modules   │                    │                      │  │
│   │  - refs      │                    │  Only learns from:   │  │
│   │  - deps      │                    │  - lint sessions     │  │
│   │  - hierarchy │                    │  - code generation   │  │
│   │              │                    │  - user corrections  │  │
│   │  (DISCARDED) │                    │                      │  │
│   └──────────────┘                    └──────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Matters

1. **Types without extractors**: `module_info`, `dependency`, `project_context` have no data source
2. **Lost efficiency**: Indexer data is computed then thrown away
3. **Missing context**: AI can't access structural information
4. **No caching**: Same indexing work repeated every session

### What Should Happen

```
┌─────────────────────────────────────────────────────────────────┐
│                    CORRECT ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User opens project                                             │
│         │                                                        │
│         ▼                                                        │
│   ┌──────────────┐                                              │
│   │   INDEXER    │                                              │
│   │  SVIndexer   │                                              │
│   └──────┬───────┘                                              │
│          │                                                       │
│          │  Produces ResolvedProject:                            │
│          │  - declarations (modules, interfaces, packages)       │
│          │  - dependencies (who depends on whom)                 │
│          │  - hierarchy (instantiation tree)                     │
│          │  - references (symbol usage)                          │
│          │                                                       │
│          ▼                                                       │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │              extractFromIndex(project)                    │  │
│   │                                                           │  │
│   │   Creates knowledge items:                                │  │
│   │   - module_info: "uart_tx has ports clk, rst_n, data..."  │  │
│   │   - dependency: "cpu → alu, regfile, mem_ctrl"            │  │
│   │   - project_context: "RISC-V CPU, 50 modules, 3 levels"   │  │
│   │   - code_pattern: "Uses 2-always FSM style"               │  │
│   └──────────────────────────────────────────────────────────┘  │
│          │                                                       │
│          ▼                                                       │
│   ┌──────────────────┐                                          │
│   │  KNOWLEDGE STORE │                                          │
│   │                  │                                          │
│   │  Unified view:   │                                          │
│   │  - Structural    │  ← From indexer                          │
│   │  - Behavioral    │  ← From lint/codegen/corrections         │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Industry Precedent

This pattern is standard in modern AI-assisted development tools:

| System | Architecture |
|--------|-------------|
| [Cursor IDE](https://blog.sshh.io/p/how-cursor-ai-ide-works) | Indexes codebase → vectorstore → AI context |
| [Graphiti](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/) | Data ingestion → knowledge graph → retrieval |
| [CodeGraph](https://www.knacklabs.ai/solutions/codegraph) | Code analysis → knowledge graph → AI queries |
| [Zep](https://arxiv.org/abs/2501.13956) | Events → temporal knowledge graph → agent memory |

### Integration Timing

When should extraction happen?

```
Project Open → SVIndexer.indexProject() → extractFromIndex() → KnowledgeStore populated
       │
       └─→ File Watcher detects changes → Re-index changed file → Update knowledge
```

The extraction should be:
- **Eager on project open**: Populate knowledge immediately so AI has context from the first interaction
- **Incremental on file changes**: Only update knowledge for changed modules, not full re-extraction
- **Lazy for large projects**: For very large codebases, extract on-demand when a module is first accessed

### IndexerKnowledgeBridge Class

A dedicated bridge class to connect the two systems:

```typescript
class IndexerKnowledgeBridge {
    constructor(
        private indexer: SVIndexer,
        private knowledgeStore: KnowledgeStore
    ) {}

    async syncFromIndex(project: ResolvedProject): Promise<void> {
        // Extract and upsert module_info, dependencies, etc.
    }

    subscribeToChanges(): void {
        // Listen for indexer "file-reindexed" events
        // Update knowledge incrementally
    }
}
```

### Bidirectional Benefit

Not just indexer → memory, but memory can inform the indexer:

| Direction | Benefit |
|-----------|---------|
| Indexer → Memory | Populate `module_info`, `dependency`, `project_context` |
| Memory → Indexer | Prioritize frequently-used modules for faster indexing |
| Memory → Indexer | Use lint fix knowledge to guide error recovery |
| Memory → Indexer | Contextual knowledge improves symbol resolution |

### Proposed extractFromIndex Method

```typescript
/**
 * Extract knowledge from indexer output
 * Should be called after indexProject() completes
 */
extractFromIndex(
    project: ResolvedProject,
    sessionId: string
): KnowledgeItem[] {
    const extracted: KnowledgeItem[] = [];

    // 1. Extract module_info for each module
    for (const decl of project.declarations) {
        if (decl.kind === 'module') {
            const item = this.addKnowledge({
                type: 'module_info',
                title: `Module: ${decl.name}`,
                content: this.formatModuleInfo(decl),
                tags: ['module', 'structure'],
                keywords: [decl.name, ...this.extractPortNames(decl)],
                scope: {
                    global: false,
                    projectIds: [this.projectId],
                    modules: [decl.name]
                },
                source: { method: 'extracted', sessionId, tool: 'indexer' },
                confidence: 0.9  // High confidence - from parser
            });
            extracted.push(item);
        }
    }

    // 2. Extract dependency relationships
    for (const [file, deps] of project.dependencies) {
        const item = this.addKnowledge({
            type: 'dependency',
            title: `Dependencies: ${path.basename(file)}`,
            content: `File ${file} depends on: ${deps.join(', ')}`,
            tags: ['dependency', 'structure'],
            keywords: [path.basename(file), ...deps],
            scope: {
                global: false,
                projectIds: [this.projectId]
            },
            source: { method: 'extracted', sessionId, tool: 'indexer' },
            confidence: 0.95
        });
        extracted.push(item);
    }

    // 3. Extract project context
    const topModules = project.hierarchy.map(h => h.name);
    const item = this.addKnowledge({
        type: 'project_context',
        title: 'Project Structure',
        content: `Top modules: ${topModules.join(', ')}\n` +
                 `Total files: ${project.files.length}\n` +
                 `Total declarations: ${project.declarations.length}`,
        tags: ['project', 'overview'],
        keywords: topModules,
        scope: { global: false, projectIds: [this.projectId] },
        source: { method: 'extracted', sessionId, tool: 'indexer' },
        confidence: 0.95
    });
    extracted.push(item);

    // 4. Detect and extract patterns (naming conventions, FSM styles, etc.)
    const patterns = this.detectPatterns(project);
    for (const pattern of patterns) {
        extracted.push(this.addKnowledge(pattern));
    }

    this.scheduleSave();
    return extracted;
}
```

---

## Known Bugs

### Bug 1: Index Not Rebuilt on Content Update - ✅ FIXED

**Location**: Lines 427-444

**Status**: **FIXED** - Content changes now trigger index rebuild.

```typescript
// Current implementation (fixed):
if (existing) {
    const contentChanged = existing.content !== item.content ||
                           !this.arraysEqual(existing.tags, item.tags) ||
                           !this.arraysEqual(existing.keywords, item.keywords);

    if (contentChanged) {
        this.removeFromIndices(existing);  // Remove old tokens
    }
    existing.content = item.content;
    // ... other updates
    if (contentChanged) {
        this.addToIndices(existing);  // Add new tokens
    }
    this.dirty = true;
    return existing;
}
```

### Bug 2: avgDocLength Not Updated on Remove - ✅ FIXED

**Location**: `removeFromIndices()` method, lines 393-404

**Status**: **FIXED** - avgDocLength is now recalculated after removal.

```typescript
// Current implementation (fixed):
private removeFromIndices(item: KnowledgeItem): void {
    // ... existing removal code ...

    // Bug 1.2 fix: Recalculate avgDocLength after removal
    const n = this.docLengths.size;
    if (n > 0) {
        let totalLength = 0;
        for (const len of this.docLengths.values()) {
            totalLength += len;
        }
        this.avgDocLength = totalLength / n;
    } else {
        this.avgDocLength = 0;
    }
}
```

### Bug 3: Silent Data Loss on Corruption

**Location**: `load()` method, lines 175-178

**Problem**: If the knowledge file is corrupted (not missing, but unreadable), the error is silently swallowed and a new empty index is created.

```typescript
} catch {
    this.index = this.createDefaultIndex();  // User's data is lost!
    // No warning logged
}
```

**Fix**:
```typescript
} catch (error) {
    const isNotFound = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (!isNotFound) {
        console.warn('KnowledgeStore: Could not load existing index, starting fresh:', error);
        // Optionally: backup the corrupted file
        await fs.rename(this.knowledgePath, `${this.knowledgePath}.corrupted.${Date.now()}`);
    }
    this.index = this.createDefaultIndex();
}
```

### Bug 4: Windows Lock Check Performance

**Location**: `isLockStale()` method, lines 1204-1208

**Problem**: Uses `tasklist` command which is slow (~200ms per call). In a retry loop, this adds significant latency.

**Fix**: Cache the result for a short period:
```typescript
private lastLockCheck: { pid: number; isAlive: boolean; time: number } | null = null;

private async isProcessAlive(pid: number): Promise<boolean> {
    const now = Date.now();
    if (this.lastLockCheck?.pid === pid && now - this.lastLockCheck.time < 1000) {
        return this.lastLockCheck.isAlive;
    }
    // ... actual check ...
    this.lastLockCheck = { pid, isAlive: result, time: now };
    return result;
}
```

---

## Industry Patterns

### How Cursor Handles This

From [How Cursor AI IDE Works](https://blog.sshh.io/p/how-cursor-ai-ide-works):

> "We index the entire codebase into a vectorstore using an encoder LLM at index time to embed the files and what they do into a vector."

Key insight: **Indexing feeds directly into the memory/context system.**

### How Graphiti Handles This

From [Graphiti: Knowledge Graph Memory](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/):

> "Incrementally processes incoming data, instantly updating entities, relationships, and communities without batch recomputation."

Key insight: **Real-time data ingestion into a unified knowledge graph.**

### Memory Architecture Best Practices

From [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956):

1. **Unified view**: Combine structural data with behavioral data
2. **Temporal awareness**: Track when things were learned
3. **Hybrid retrieval**: Combine semantic search + keyword search + graph traversal
4. **No LLM at query time**: Fast retrieval without calling LLMs

---

## Recommended Improvements

### Priority 1: Indexer Integration - ✅ DONE

`extractFromIndex()` has been created in `extractors/indexer-extractor.ts` and is called via SVIndexerAdapter.

### Priority 2: Fix Known Bugs - ✅ MOSTLY DONE

1. ✅ Rebuild indices on content update (KnowledgeStore.ts:427-444)
2. ✅ Update avgDocLength on removal (KnowledgeStore.ts:393-404)
3. ❌ Log warnings on corruption (not yet implemented)
4. ❌ Cache Windows lock checks (not yet implemented)

### Priority 3: Enhanced Tokenization

Current tokenization is basic. Consider:

```typescript
private tokenize(item: KnowledgeItem): string[] {
    const text = `${item.title} ${item.content} ${item.tags.join(' ')} ${item.keywords.join(' ')}`;

    return text
        .toLowerCase()
        // Split camelCase: mySignal -> my, signal
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        // Split on non-word OR underscore
        .split(/[\W_]+/)
        .filter(t => t.length > 2)
        // Remove stop words
        .filter(t => !STOP_WORDS.has(t));
}
```

### Priority 4: Type-Based Quotas

Prevent structural data from being pruned by behavioral data:

```typescript
interface KnowledgeStoreConfig {
    // ... existing ...
    maxItemsByType?: Partial<Record<KnowledgeType, number>>;
}

// Example:
{
    maxItemsByType: {
        module_info: 200,
        dependency: 100,
        lint_fix: 100,
        code_pattern: 50,
        // ...
    }
}
```

### Priority 5: Context-Aware Scoring

Boost results based on current context:

```typescript
private scoreWithContext(
    item: KnowledgeItem,
    queryTerms: string[],
    context: { currentModule?: string; currentDeps?: string[] }
): number {
    let score = this.scoreBM25(item, queryTerms);

    // Boost if item is about current module
    if (context.currentModule && item.scope.modules?.includes(context.currentModule)) {
        score += 0.2;
    }

    // Boost if item is about a dependency
    if (context.currentDeps?.some(dep => item.scope.modules?.includes(dep))) {
        score += 0.1;
    }

    return score;
}
```

---

## Appendix: Key Files

| File | Purpose |
|------|---------|
| `src/memory/KnowledgeStore.ts` | Main knowledge store implementation |
| `src/memory/MemoryService.ts` | Facade combining MemoryManager + KnowledgeStore |
| `src/memory/manager.ts` | Project memory (approvals, history, preferences) |
| `src/indexer/sv-indexer.ts` | Main indexer (should feed into KnowledgeStore) |
| `src/indexer/types/index.ts` | Indexer type definitions |

---

## Appendix: Configuration Defaults

```typescript
const DEFAULT_KNOWLEDGE_STORE_CONFIG = {
    knowledgeDir: '~/.gateflow',
    maxItems: 500,
    minExtractionConfidence: 0.6,
    maxUnusedAge: 30 * 24 * 60 * 60 * 1000  // 30 days
};

const BM25_K1 = 1.2;  // Term frequency saturation
const BM25_B = 0.75;  // Length normalization
```

---

*Document generated: 2026-01-13*
*Last updated: 2026-01-13 (marked Bug 1 and Bug 2 as FIXED, updated Priority 1 and 2 status)*
*For agents: This document describes the KnowledgeStore architecture. The indexer integration is now complete.*
