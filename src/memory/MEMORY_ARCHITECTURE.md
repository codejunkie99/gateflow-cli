# Memory Module Architecture

> Persistent project context and learned knowledge for GateFlow AI agent

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Component Details](#component-details)
4. [Data Flow](#data-flow)
5. [Storage & Persistence](#storage--persistence)
6. [Search & Retrieval](#search--retrieval)
7. [Knowledge Learning](#knowledge-learning)
8. [Token Budget Management](#token-budget-management)
9. [Integration Points](#integration-points)
10. [Type Reference](#type-reference)

---

## Overview

The Memory Module provides persistent, cross-session memory for the GateFlow AI agent. It consists of two primary subsystems:

| Subsystem | Purpose | Storage |
|-----------|---------|---------|
| **MemoryManager** | Project context, approvals, conversation history | `{projectId}.json` |
| **KnowledgeStore** | Learned patterns, fixes, code preferences | `{projectId}-knowledge.json` |

Both are unified through **MemoryService**, which provides coordinated initialization, token-budgeted context injection, and lifecycle management.

### Key Capabilities

- **Persistent Learning**: Extracts patterns from lint sessions, code generation, and user corrections
- **BM25 Search**: O(k) retrieval via inverted index (not O(n) linear scan)
- **Token Budgeting**: HDL-aware token estimation with 10% safety margin
- **Tiered Storage**: Hot/warm/cold memory optimization for large knowledge bases
- **File Locking**: Cross-process safety with stale lock detection

---

## System Architecture

```
                              ┌─────────────────────────────────────────────┐
                              │           MemoryService (Facade)             │
                              │                                              │
                              │  - Coordinated init/shutdown                 │
                              │  - Token budget: 40% memory / 60% knowledge  │
                              │  - getContextForAI(query?) → ContextInjection│
                              └──────────────────┬──────────────────────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
                    ▼                            │                            ▼
┌───────────────────────────────────┐            │         ┌───────────────────────────────────┐
│         MemoryManager             │            │         │         KnowledgeStore            │
│                                   │            │         │                                   │
│  Project Context:                 │            │         │  Learned Patterns:                │
│  - projectSummary                 │            │         │  - code_pattern                   │
│  - recentFiles[]                  │            │         │  - lint_fix                       │
│  - moduleNotes{}                  │            │         │  - style_preference               │
│                                   │            │         │  - module_info                    │
│  Session History:                 │            │         │  - dependency                     │
│  - ConversationSummary[]          │            │         │                                   │
│                                   │            │         │  Search Engine:                   │
│  Approvals:                       │            │         │  - Inverted index                 │
│  - ApprovalGrant[]                │            │         │  - BM25 scoring                   │
│                                   │            │         │  - Scope matching                 │
│  Archive System:                  │            │         │                                   │
│  - archiveConversation()          │            │         │  Learning Hooks:                  │
│  - queryArchivedHistory()         │            │         │  - extractFromLintSession()      │
│  - triggerSummarization()         │            │         │  - extractFromCodeGen()          │
│                                   │            │         │  - learnFromCorrection()         │
└───────────────────────────────────┘            │         └───────────────────────────────────┘
                    │                            │                            │
                    │                            ▼                            │
                    │         ┌──────────────────────────────────┐            │
                    │         │     TieredKnowledgeStore         │◄───────────┘
                    │         │                                  │
                    │         │  Hot Tier:  Top 100 items (full) │
                    │         │  Warm Tier: Recent (metadata)    │
                    │         │  Cold Tier: Old (ID only)        │
                    │         │                                  │
                    │         │  - Automatic promotion/demotion  │
                    │         │  - Lazy loading from warm/cold   │
                    │         │  - Memory usage optimization     │
                    │         └──────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           Token Estimator                                      │
│                                                                                │
│   detectContentType(text) → 'code' | 'text' | 'mixed'                         │
│   estimateTokens(text) → { tokens, breakdown }                                │
│   truncateToFit(text, budget) → truncated                                     │
│                                                                                │
│   HDL-aware: SV/VHDL patterns, symbol density adjustment, 10% safety margin   │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### MemoryService (`MemoryService.ts`)

**Purpose**: Unified facade for memory and knowledge management

```typescript
class MemoryService {
    constructor(projectRoot: string, bus: EventBus, config?: MemoryServiceConfig)

    // Lifecycle
    async initialize(): Promise<void>
    async save(): Promise<void>
    async shutdown(): Promise<void>

    // Context retrieval
    getContextForAI(query?: KnowledgeQuery): ContextInjection
    getContextString(query?: KnowledgeQuery): string

    // Accessors
    get memory(): MemoryManager
    get knowledge(): KnowledgeStore
    getProjectMemory(): ProjectMemory | null
    getProjectId(): string
}
```

**Token Budget Allocation**:
```
Total Budget: 2000 tokens (configurable)
├── Memory:    40% = 800 tokens
└── Knowledge: 60% = 1200 tokens

Dynamic reallocation: if memory uses < 800, knowledge gets the remainder
```

---

### MemoryManager (`manager.ts`)

**Purpose**: Project context, approvals, and conversation history

```typescript
class MemoryManager {
    constructor(projectRoot: string, bus: EventBus, config?: Partial<MemoryConfig>)

    // Persistence
    async load(): Promise<ProjectMemory>
    async save(): Promise<void>
    async flush(): Promise<void>

    // Context operations
    addConversation(summary: ConversationSummary): void
    addRecentFile(filePath: string): void
    addModuleNote(moduleName: string, note: string): void
    updateContext(updates: Partial<ProjectMemory['context']>): void

    // Approvals
    getApprovals(): ApprovalGrant[]
    addApproval(approval: ApprovalGrant): void
    clearSessionApprovals(): void

    // History archiving
    async archiveConversation(sessionId, messages, summary): Promise<ChatHistoryFile>
    async triggerSummarization(sessionId, messages, options?): Promise<SummarizationResult>
    async queryArchivedHistory(sessionId, query): Promise<RelevantMessage[]>

    // Context for AI
    getContextForAI(): string
}
```

**Stored Data** (`{projectId}.json`):
```typescript
interface ProjectMemory {
    version: number
    projectId: string
    projectPath: string
    approvals: ApprovalGrant[]
    context: {
        projectSummary?: string
        recentFiles: string[]        // Max 20
        moduleNotes: Record<string, string>
    }
    history: ConversationSummary[]   // Max 50, LIFO
    preferences: {
        autoApprove: boolean
        lintOnSave: boolean
        theme?: string
    }
    created: number
    lastAccess: number
}
```

---

### KnowledgeStore (`KnowledgeStore.ts`)

**Purpose**: Learned patterns with BM25-based retrieval

```typescript
class KnowledgeStore {
    constructor(projectRoot: string, bus: EventBus, config?: Partial<KnowledgeStoreConfig>)

    // Persistence
    async load(): Promise<KnowledgeIndex>
    async save(): Promise<void>
    async flush(): Promise<void>

    // CRUD
    addKnowledge(item: KnowledgeItemInput): KnowledgeItem
    removeKnowledge(id: string): boolean
    markUsed(id: string): void

    // Search
    search(query: KnowledgeQuery): KnowledgeSearchResult[]
    getContextKnowledge(filePath?, moduleName?, task?, maxTokens?): string

    // Learning hooks
    extractFromLintSession(sessionId, errors, fixes): KnowledgeItem[]
    extractFromCodeGen(sessionId, code, metadata): KnowledgeItem | null
    learnFromCorrection(original, corrected, metadata): KnowledgeItem

    // Accessors
    getByType(type: KnowledgeType): KnowledgeItem[]
    getItems(): KnowledgeItem[]
    getItemById(id: string): KnowledgeItem | undefined
    getStats(): KnowledgeIndex['stats'] | null
}
```

**In-Memory Indices** (rebuilt on load):
```
itemById:         Map<id, KnowledgeItem>       // O(1) ID lookup
itemByFingerprint: Map<fingerprint, item>      // Deduplication
invertedIndex:    Map<term, Set<id>>           // BM25 candidate selection
docLengths:       Map<id, wordCount>           // BM25 scoring
termDocFreq:      Map<term, docCount>          // IDF calculation
avgDocLength:     number                       // BM25 normalization
```

---

### TieredKnowledgeStore (`tiered-store.ts`)

**Purpose**: Memory optimization via hot/warm/cold tiering

```typescript
class TieredKnowledgeStore {
    constructor(config?: Partial<TieredStoreConfig>)

    initialize(items: KnowledgeItem[], lookupFn: (id) => KnowledgeItem | undefined): void

    getItem(id: string): KnowledgeItem | undefined  // Auto-promotes on access
    addItem(item: KnowledgeItem): void              // Starts in hot tier
    removeItem(id: string): void
    markAccessed(id: string): void

    rebalance(): void
    getStats(): TieredStoreStats

    isHot(id: string): boolean
    getHotItems(): KnowledgeItem[]
    getTier(id: string): 'hot' | 'warm' | 'cold' | undefined
}
```

**Tier Assignment Logic**:
```
Relevance Score =
    confidence × 20
  + min(useCount × 5, 50)
  - daysSinceAccess (max 30)
  + (if user_provided: +30)

Hot Tier:   Top 100 by score (full item in memory, ~2KB each)
Warm Tier:  Accessed < 30 days, not hot (metadata only, ~100B)
Cold Tier:  Accessed > 30 days (ID only, ~50B)
```

**Promotion Rules**:
- Cold → Warm: on any access
- Warm → Hot: after 3+ accesses
- Hot → Warm: when new items added and hot tier full (demote lowest score)

---

### Token Estimator (`token-estimator.ts`)

**Purpose**: HDL-aware token estimation for budget enforcement

```typescript
function detectContentType(text: string): 'code' | 'text' | 'mixed'
function estimateTokens(text: string, config?): TokenEstimate
function estimateTokensSimple(text: string): number
function fitsInBudget(text: string, budget: number): boolean
function truncateToFit(text: string, budget: number): string
```

**Estimation Algorithm**:
```
1. Detect content type (HDL patterns → 'code', natural language → 'text')

2. Calculate base estimates:
   - Word-based: wordCount × 1.3
   - Char-based: charCount / 4

3. Choose base by content type:
   - code:  max(wordBased, charBased × 0.8)
   - mixed: (wordBased + charBased) / 2
   - text:  max(wordBased, charBased)

4. Add symbol adjustment: charCount × symbolRatio × 0.05

5. Apply 10% safety margin
```

**HDL Patterns Detected**:
- SystemVerilog: `always_ff`, `always_comb`, `module`, `interface`, `[7:0]`, etc.
- VHDL: `architecture`, `entity`, `process`, `std_logic_vector`, `:=`, etc.
- Common: `clk`, `reset`, `state`, `next_state`, etc.

---

### Extractors (`extractors/`)

**Purpose**: Convert indexer output to KnowledgeStore items

```
extractors/
├── index.ts              # Module exports
├── types.ts              # ExtractionOptions, ExtractionResult
├── indexer-extractor.ts  # Main orchestrator: extractFromIndex()
├── module-extractor.ts   # extractModuleInfo() - module/interface/package
├── dependency-extractor.ts # extractDependencies() - file relationships
└── hierarchy-extractor.ts  # extractHierarchy() - instantiation tree
```

**Usage**:
```typescript
import { extractFromIndex, createExtractionOptions } from './memory/extractors/index.js';

const options = createExtractionOptions({
    projectId: store.getProjectId(),
    sessionId: crypto.randomUUID(),
    extractModules: true,
    extractDependencies: true,
    extractHierarchy: true
});

const result = await extractFromIndex(resolvedProject, store, options);
// result.counts: { modules, interfaces, packages, dependencies, hierarchy }
```

---

## Data Flow

### Initialization Flow

```
┌──────────────────┐
│  CLI Startup     │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  MemoryService.initialize()                                   │
│                                                               │
│  1. Acquire AsyncMutex (intra-process safety)                │
│  2. Load in parallel:                                         │
│     ├── MemoryManager.load()  → {projectId}.json             │
│     └── KnowledgeStore.load() → {projectId}-knowledge.json   │
│  3. Wire TieredKnowledgeStore to KnowledgeStore              │
│  4. Set initialized = true                                    │
└──────────────────────────────────────────────────────────────┘
```

### Context Injection Flow

```
┌──────────────────┐
│  Agent Step      │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  MemoryService.getContextForAI(query)                        │
│                                                               │
│  Budget: 2000 tokens                                          │
│  ├── Memory budget:    800 (40%)                             │
│  └── Knowledge budget: 1200 (60%)                            │
│                                                               │
│  1. memoryContext = MemoryManager.getContextForAI()          │
│  2. memoryTokens = estimateTokens(memoryContext)             │
│  3. if memoryTokens < 800:                                   │
│        knowledgeBudget += (800 - memoryTokens)               │
│  4. knowledgeContext = KnowledgeStore.getContextKnowledge(   │
│        filePath, moduleName, query, knowledgeBudget          │
│     )                                                         │
│  5. Return { memoryContext, knowledgeContext, totalTokens }  │
└──────────────────────────────────────────────────────────────┘
```

### Knowledge Search Flow

```
┌──────────────────┐
│  search(query)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  1. Candidate Selection (O(k) via inverted index)            │
│     - Tokenize query terms                                   │
│     - For each term: look up invertedIndex.get(term)         │
│     - Union all posting lists → candidate IDs                │
│     - Fetch items from itemById                              │
│                                                               │
│  2. Apply Filters                                            │
│     - types?: filter by KnowledgeType                        │
│     - tags?: filter by tag match                             │
│     - minConfidence?: filter by confidence threshold         │
│                                                               │
│  3. Score with BM25                                          │
│     For each candidate:                                       │
│     - BM25 score = Σ IDF(term) × TF_norm(term, doc)          │
│     - Normalize to 0-1 range: min(score/10, 1)               │
│     - Blend: score × 0.7 + confidence × 0.3                  │
│                                                               │
│  4. Apply Scope Multiplier                                   │
│     - global: 1.0                                            │
│     - project mismatch: 0 (excluded)                         │
│     - file pattern missing (relaxed): 0.5                    │
│     - file pattern mismatch (relaxed): 0.3                   │
│     - module mismatch (relaxed): 0.3                         │
│                                                               │
│  5. Sort by relevance, return top N                          │
└──────────────────────────────────────────────────────────────┘
```

---

## Storage & Persistence

### File Locations

```
~/.gateflow/
├── {projectId}.json              # MemoryManager data
├── {projectId}-knowledge.json    # KnowledgeStore data
├── {projectId}.lock              # MemoryManager lock file
├── {projectId}-knowledge.lock    # KnowledgeStore lock file
└── archives/
    └── {projectId}/
        └── {sessionId}-{timestamp}.json  # Archived conversations
```

**Project ID**: 12-character MD5 hash of `path.resolve(projectRoot)`

### Atomic Write Pattern

```typescript
async save(): Promise<void> {
    // 1. Acquire inter-process lock
    const acquired = await this.acquireLock();
    if (!acquired) throw new Error('Failed to acquire lock');

    try {
        // 2. Write to temp file
        const tempPath = `${this.path}.${Date.now()}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2));

        // 3. Atomic rename (prevents corruption on crash)
        await fs.rename(tempPath, this.path);

        this.dirty = false;
    } finally {
        // 4. Release lock
        await this.releaseLock();
    }
}
```

### File Locking

**Lock File Format**:
```json
{ "pid": 12345, "time": 1704067200000 }
```

**Stale Lock Detection**:
1. Time-based: Lock > 5 minutes old
2. Process check:
   - **Windows**: `tasklist /FI "PID eq {pid}"` (cached 1 second)
   - **Unix**: `process.kill(pid, 0)` signal test

### Debounced Saves

Mutations set `dirty = true` and call `scheduleSave()`:
- 5-second debounce timer
- Multiple mutations within 5 seconds → single write
- `flush()` cancels timer and saves immediately (for process exit)

---

## Search & Retrieval

### BM25 Algorithm

**Parameters**: k1 = 1.2, b = 0.75

**Formula**:
```
score(D, Q) = Σ IDF(qi) × (f(qi, D) × (k1 + 1)) / (f(qi, D) + k1 × (1 - b + b × |D|/avgDL))

Where:
  IDF(qi) = log(1 + (N - n(qi) + 0.5) / (n(qi) + 0.5))
  f(qi, D) = term frequency of qi in document D
  |D| = document length (word count)
  avgDL = average document length
  N = total documents
  n(qi) = documents containing term qi
```

**Confidence Blending**:
```
finalScore = normalizedBM25 × 0.7 + item.confidence × 0.3
```

### Scope Matching

| Scope Type | Strict Mode | Relaxed Mode |
|------------|-------------|--------------|
| Global | 1.0 | 1.0 |
| Project mismatch | 0 (excluded) | 0 (excluded) |
| File pattern missing | 0 (excluded) | 0.5 |
| File pattern mismatch | 0 (excluded) | 0.3 |
| Module missing | 0 (excluded) | 0.5 |
| Module mismatch | 0 (excluded) | 0.3 |

Use `relaxedScope: true` in query for broader results with score penalties.

---

## Knowledge Learning

### Extraction Points

| Source | Method | Confidence | Trigger |
|--------|--------|------------|---------|
| Lint Session | `extractFromLintSession()` | 0.5-0.9 | Error patterns (2+ occurrences) |
| Code Generation | `extractFromCodeGen()` | 0.7 | FSM, testbench, module patterns |
| User Corrections | `learnFromCorrection()` | 0.95 | Before/after code diffs |
| Indexer | `extractFromIndex()` | 0.9 | Module declarations, dependencies |

### Pattern Detection

**Lint Errors** → Normalized message patterns:
```typescript
normalizeErrorMessage(message):
  - Replace numbers → 'N'
  - Replace quoted identifiers → "'ID'"
  - Replace line numbers → ':N'
  - Normalize whitespace
```

**Code Changes** → Diff analysis:
- Always block type: `always @` → `always_ff/always_comb`
- Reset handling: Added `if (!rst)`
- Naming conventions: snake_case ↔ camelCase
- Formatting/whitespace only

**Generated Code** → Pattern extraction:
- FSM: State count, state names
- Testbench: DUT instantiation, VCD dumps, UVM style
- Module: Sequential/combinational, interfaces

### Deduplication

**Fingerprint** = SHA-256 hash of:
```
{type}|{normalized_title}|{scope_parts}
```

Duplicate detection: Check `itemByFingerprint` map before adding.
Updates merge confidence, tags, keywords (or replace if content changed).

---

## Token Budget Management

### Budget Allocation

```typescript
const contextTokenBudget = 2000;  // Configurable

// Split: 40% memory, 60% knowledge
const memoryBudget = 800;
const knowledgeBudget = 1200;

// Dynamic reallocation
if (actualMemoryTokens < memoryBudget) {
    adjustedKnowledgeBudget = knowledgeBudget + (memoryBudget - actualMemoryTokens);
}
```

### Content-Aware Estimation

```typescript
// Example for HDL code
const text = "always_ff @(posedge clk) begin\n  state <= next_state;\nend";

estimateTokens(text):
  contentType: 'code'
  wordBased:   10 words × 1.3 = 13
  charBased:   65 chars / 4 = 16
  base:        max(13, 16 × 0.8) = 13
  symbolAdj:   65 × 0.15 × 0.05 = 0.5 ≈ 1
  adjusted:    13 + 1 = 14
  safety:      14 × 0.1 = 1.4 ≈ 2
  total:       14 + 2 = 16 tokens
```

### Truncation

When content exceeds budget:
1. Binary search for truncation point
2. Find clean break (newline or space)
3. Append `\n... [truncated]`

---

## Integration Points

### GateFlowAgent

```typescript
// In agent step
const ctx = memoryService.getContextForAI({
    filePath: currentFile,
    moduleName: currentModule,
    query: taskDescription
});

// Inject into prompt
systemPrompt += `\n\n${ctx.memoryContext}\n\n${ctx.knowledgeContext}`;
```

### FixLoop

```typescript
// After successful fix
knowledgeStore.addKnowledge({
    type: 'lint_fix',
    title: `Fix for: ${errorSignature}`,
    content: `Error: ${error}\n\nFix: ${fix}`,
    tags: ['fix-loop', errorCategory],
    scope: { global: false, projectIds: [projectId] },
    source: { method: 'extracted', tool: 'fix-loop' },
    confidence: 0.8
});
```

### WatchManager

```typescript
// On file change callback
watcher.on('change', (file) => {
    // Update knowledge store if relevant
    memoryService.knowledge.markUsed(relatedItemId);
});
```

### Indexer

```typescript
// After indexing completes
const result = await extractFromIndex(resolvedProject, knowledgeStore, {
    projectId: store.getProjectId(),
    sessionId: crypto.randomUUID()
});
```

---

## Type Reference

### KnowledgeItem

```typescript
interface KnowledgeItem {
    id: string;                    // UUID
    fingerprint: string;           // 16-char SHA-256 prefix
    type: KnowledgeType;
    title: string;
    content: string;
    tags: string[];
    keywords: string[];
    scope: KnowledgeScope;
    source: KnowledgeSource;
    confidence: number;            // 0.0-1.0
    useCount: number;
    lastAccessed: number;          // Timestamp
    created: number;
    updated: number;
}

type KnowledgeType =
    | 'code_pattern'      // Coding styles, module structures
    | 'lint_fix'          // Error patterns with fixes
    | 'test_pattern'      // Testing approaches
    | 'module_info'       // Module declarations
    | 'dependency'        // File/module dependencies
    | 'style_preference'  // User preferences
    | 'workflow'          // Tool sequences
    | 'debug_solution'    // Troubleshooting
    | 'tool_usage'        // Tool invocations
    | 'project_context';  // High-level project facts

interface KnowledgeScope {
    global: boolean;
    projectIds?: string[];
    filePatterns?: string[];       // Glob patterns
    modules?: string[];
}

interface KnowledgeSource {
    method: 'extracted' | 'inferred' | 'user_provided' | 'tool_result';
    sessionId?: string;
    filePath?: string;
    tool?: string;
}
```

### KnowledgeQuery

```typescript
interface KnowledgeQuery {
    query?: string;                // Text search
    types?: KnowledgeType[];
    tags?: string[];
    filePath?: string;             // For scope matching
    moduleName?: string;           // For scope matching
    maxResults?: number;           // Default: 10
    minConfidence?: number;
    relaxedScope?: boolean;        // Allow cross-scope with penalty
}
```

### ProjectMemory

```typescript
interface ProjectMemory {
    version: number;
    projectId: string;
    projectPath: string;
    approvals: ApprovalGrant[];
    context: {
        projectSummary?: string;
        recentFiles: string[];
        moduleNotes: Record<string, string>;
    };
    history: ConversationSummary[];
    preferences: {
        autoApprove: boolean;
        lintOnSave: boolean;
        theme?: string;
    };
    created: number;
    lastAccess: number;
}

interface ConversationSummary {
    id: string;
    timestamp: number;
    summary: string;
    filesModified: string[];
    exitCode: number;
}
```

### Configuration

```typescript
interface MemoryServiceConfig {
    memory?: Partial<MemoryConfig>;
    knowledge?: Partial<KnowledgeStoreConfig>;
    contextTokenBudget?: number;   // Default: 2000
    tiering?: Partial<TieredStoreConfig>;
}

interface MemoryConfig {
    memoryDir: string;             // Default: ~/.gateflow
    maxHistory: number;            // Default: 50
    lockTimeout: number;           // Default: 5000ms
    archiveThreshold: number;      // Default: 10
    keepRecentMessages: number;    // Default: 4
}

interface KnowledgeStoreConfig {
    knowledgeDir: string;          // Default: ~/.gateflow
    maxItems: number;              // Default: 500
    minExtractionConfidence: number; // Default: 0.6
    maxUnusedAge: number;          // Default: 30 days
}

interface TieredStoreConfig {
    hotSize: number;               // Default: 100
    warmThreshold: number;         // Default: 3 accesses
    coldAgeDays: number;           // Default: 30
    enabled: boolean;              // Default: true
}
```

---

## File Index

| File | Lines | Purpose |
|------|-------|---------|
| `index.ts` | 22 | Module exports |
| `MemoryService.ts` | 222 | Unified facade |
| `KnowledgeStore.ts` | 1534 | Pattern storage + BM25 search |
| `manager.ts` | 1017 | Project context + archiving |
| `tiered-store.ts` | 424 | Hot/warm/cold tiering |
| `token-estimator.ts` | 285 | HDL-aware token estimation |
| `knowledge-types.ts` | 342 | Type definitions |
| `utils.ts` | ~20 | Re-exports |
| `extractors/index.ts` | 57 | Extractor exports |
| `extractors/types.ts` | 146 | Extraction types |
| `extractors/indexer-extractor.ts` | ~200 | Main orchestrator |
| `extractors/module-extractor.ts` | ~150 | Module info extraction |
| `extractors/dependency-extractor.ts` | ~100 | Dependency extraction |
| `extractors/hierarchy-extractor.ts` | ~100 | Hierarchy extraction |

---

*Generated from source analysis on 2026-01-14*
