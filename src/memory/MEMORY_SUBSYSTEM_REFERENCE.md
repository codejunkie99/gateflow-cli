# Memory Subsystem Reference

This document describes the internal code flow of each file in `src/memory/`.

---

## Root Level Files

### `index.ts`
Re-exports from submodules. Entry point for external consumers.

```
External Import
     │
     ▼
index.ts ──► Re-exports from:
              ├── KnowledgeStore.ts
              ├── MemoryService.ts
              ├── tiered-store.ts
              ├── store/manager.ts
              └── extractors/
```

---

### `knowledge-types.ts`
Pure type definitions. No runtime code.

**Exports:**
- `KnowledgeItem` - Single knowledge entry
- `KnowledgeType` - Category enum (code_pattern, lint_fix, module_info, etc.)
- `KnowledgeScope` - Where knowledge applies (global, project, file patterns)
- `KnowledgeSource` - Origin tracking (extracted, inferred, user_provided)
- `KnowledgeQuery` - Search parameters
- `KnowledgeSearchResult` - Search result with relevance score
- `KnowledgeStoreConfig` - Store configuration
- `KnowledgeIndex` - Persisted index schema

---

### `KnowledgeStore.ts`
Main knowledge persistence with BM25 search.

**Constants:**
- `BM25_K1 = 1.2` - Term frequency saturation
- `BM25_B = 0.75` - Document length normalization
- `DEFAULT_KNOWLEDGE_STORE_CONFIG` - Default settings

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         KnowledgeStore                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  constructor(projectRoot, bus, config)                              │
│       │                                                             │
│       ▼                                                             │
│  Sets up paths, initializes empty indices                           │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────┐                                                        │
│  │ load()  │◄─────────────── Called on first use                    │
│  └────┬────┘                                                        │
│       │                                                             │
│       ├── Read JSON from disk (knowledgePath)                       │
│       ├── migrate() if version mismatch                             │
│       ├── rebuildAllIndices()                                       │
│       │      ├── clearAllIndices()                                  │
│       │      └── addToIndices(item) for each item                   │
│       │             ├── itemById.set()                              │
│       │             ├── itemByFingerprint.set()                     │
│       │             ├── Update invertedIndex (term → item IDs)      │
│       │             └── Update termDocFreq, docLengths              │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    READY STATE                                │   │
│  │  In-memory indices populated, ready for queries              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────┐     ┌───────────────┐     ┌────────────────┐       │
│  │  search()   │     │ addKnowledge()│     │removeKnowledge()│      │
│  └──────┬──────┘     └───────┬───────┘     └───────┬────────┘       │
│         │                    │                     │                │
│         ▼                    ▼                     ▼                │
│  tokenizeQuery()      computeFingerprint()   removeFromIndices()    │
│         │                    │                     │                │
│         ▼                    ▼                     │                │
│  For each term:        Check duplicate             │                │
│  └─► invertedIndex     (fingerprint match)         │                │
│      .get(term)              │                     │                │
│         │                    ▼                     │                │
│         ▼              addToIndices()              │                │
│  Collect candidate           │                     │                │
│  item IDs                    ▼                     │                │
│         │              scheduleSave()◄─────────────┘                │
│         ▼                    │                                      │
│  scoreBM25() for             │                                      │
│  each candidate              │                                      │
│         │                    ▼                                      │
│         ▼              ┌──────────┐                                 │
│  matchesScopeWithScore │  save()  │ (debounced, 5s)                 │
│         │              └────┬─────┘                                 │
│         ▼                   │                                       │
│  Sort by relevance          ├── acquireLock()                       │
│         │                   ├── Write JSON atomically               │
│         ▼                   └── releaseLock()                       │
│  Return top N results                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Methods:**
- `search(query)` → BM25 scoring with scope matching
- `addKnowledge(item)` → Deduplicates via fingerprint, auto-saves
- `getContextKnowledge(filePath, module)` → Context-aware retrieval
- `extractFromLintSession()` → Learn from lint errors
- `learnFromCorrection()` → Learn from user corrections
- `extractFromCodeGen()` → Learn from generated code patterns

---

### `MemoryService.ts`
Facade combining KnowledgeStore + MemoryManager + TieredStore.

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MemoryService                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  constructor(projectRoot, bus, config)                              │
│       │                                                             │
│       ▼                                                             │
│  Stores config, does NOT initialize subsystems yet                  │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────┐                                                   │
│  │ initialize() │◄─────────── Must be called before use             │
│  └──────┬───────┘                                                   │
│         │                                                           │
│         ├── initMutex.withLock() (prevents double init)             │
│         │                                                           │
│         ├── Create KnowledgeStore ──► knowledgeStore.load()         │
│         │                                                           │
│         ├── Create MemoryManager ──► memoryManager.load()           │
│         │                                                           │
│         └── Create TieredKnowledgeStore                             │
│                    │                                                │
│                    ▼                                                │
│              tieredStore.initialize(items, lookupFn)                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    READY STATE                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Accessor Methods (delegate to subsystems):                         │
│                                                                     │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐       │
│  │  knowledge()   │   │   memory()     │   │   tiering()    │       │
│  │  Returns       │   │   Returns      │   │   Returns      │       │
│  │  KnowledgeStore│   │  MemoryManager │   │  TieredStore   │       │
│  └────────────────┘   └────────────────┘   └────────────────┘       │
│                                                                     │
│  ┌─────────────────────┐                                            │
│  │  getContextForAI()  │ ◄─── Main entry for AI context injection   │
│  └──────────┬──────────┘                                            │
│             │                                                       │
│             ├── knowledgeStore.getContextKnowledge()                │
│             ├── memoryManager.getContextForAI()                     │
│             └── truncateToTokenBudget()                             │
│                        │                                            │
│                        ▼                                            │
│                 Returns ContextInjection {                          │
│                     knowledgeContext: string,                       │
│                     memoryContext: string,                          │
│                     totalTokens: number                             │
│                 }                                                   │
│                                                                     │
│  ┌────────────┐                                                     │
│  │ shutdown() │                                                     │
│  └─────┬──────┘                                                     │
│        │                                                            │
│        ├── knowledgeStore.flush()                                   │
│        └── memoryManager.flush()                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `tiered-store.ts`
Hot/warm/cold tiering for memory optimization.

**Constants:**
- `DEFAULT_TIERED_CONFIG.hotSize = 100` - Max hot items
- `DEFAULT_TIERED_CONFIG.warmThreshold = 3` - Accesses to promote
- `DEFAULT_TIERED_CONFIG.coldAgeDays = 30` - Days before cold
- `BYTES_PER_CHAR = 2` - Size estimation

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                      TieredKnowledgeStore                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  constructor(config)                                                │
│       │                                                             │
│       ▼                                                             │
│  Merge with DEFAULT_TIERED_CONFIG                                   │
│       │                                                             │
│       ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ initialize(items, lookupFn)                                  │   │
│  └──────────┬───────────────────────────────────────────────────┘   │
│             │                                                       │
│             ├── Store lookupFn for lazy loading                     │
│             │                                                       │
│             └── For each item:                                      │
│                    │                                                │
│                    ▼                                                │
│              calculateRelevanceScore(item)                          │
│                    │                                                │
│                    ├── Score based on:                              │
│                    │   - useCount                                   │
│                    │   - recency (lastAccessed)                     │
│                    │   - confidence                                 │
│                    │                                                │
│                    ▼                                                │
│              Classify into tier:                                    │
│              ┌─────────────────────────────────────────────┐        │
│              │  if (age > coldAgeDays) → COLD              │        │
│              │  else if (score in top hotSize) → HOT       │        │
│              │  else → WARM                                │        │
│              └─────────────────────────────────────────────┘        │
│                    │                                                │
│                    ▼                                                │
│              createMetadata(item, tier)                             │
│              metadata.set(id, meta)                                 │
│                    │                                                │
│                    ▼                                                │
│              if (tier === 'hot'):                                   │
│                  hotItems.set(id, item)  ◄── Full item in memory    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    READY STATE                                │   │
│  │  hotItems: Map<id, KnowledgeItem>  (full items)              │   │
│  │  metadata: Map<id, ItemMetadata>   (all items tracked)       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌───────────────┐                                                  │
│  │  getItem(id)  │                                                  │
│  └───────┬───────┘                                                  │
│          │                                                          │
│          ├── if hotItems.has(id):                                   │
│          │      return hotItems.get(id)                             │
│          │                                                          │
│          └── else (warm/cold):                                      │
│                 │                                                   │
│                 ▼                                                   │
│           itemLookup(id)  ◄── Lazy load from KnowledgeStore         │
│                 │                                                   │
│                 ▼                                                   │
│           markAccessed(id)                                          │
│                 │                                                   │
│                 ├── metadata.accessCount++                          │
│                 │                                                   │
│                 └── if accessCount >= warmThreshold:                │
│                        promoteToHot(id) ──► rebalance()             │
│                                                                     │
│  ┌───────────────┐                                                  │
│  │  rebalance()  │◄─────────── Called after promotion               │
│  └───────┬───────┘                                                  │
│          │                                                          │
│          └── if hotItems.size > hotSize:                            │
│                 demoteColdest()                                     │
│                    │                                                │
│                    ├── Find lowest score in hot tier                │
│                    ├── Remove from hotItems                         │
│                    └── Update metadata.tier = 'warm'                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `file-lock.ts`
Cross-process file locking for safe concurrent access.

**Constants:**
- `STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000` (5 minutes)
- `LOCK_RETRY_INTERVAL_MS = 100`
- `TASKLIST_TIMEOUT_MS = 5000`

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FileLockManager                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  constructor(lockPath, config)                                      │
│       │                                                             │
│       ▼                                                             │
│  Store lockPath, merge config                                       │
│                                                                     │
│  ┌────────────────┐                                                 │
│  │   acquire()    │                                                 │
│  └───────┬────────┘                                                 │
│          │                                                          │
│          ▼                                                          │
│    ┌─────────────────────────────────────────┐                      │
│    │            Retry Loop                   │                      │
│    │  (until timeout or lock acquired)       │                      │
│    └─────────────────────┬───────────────────┘                      │
│                          │                                          │
│                          ▼                                          │
│                    Try fs.writeFile(                                │
│                      lockPath,                                      │
│                      JSON.stringify({pid, time}),                   │
│                      { flag: 'wx' }  ◄── Exclusive create           │
│                    )                                                │
│                          │                                          │
│              ┌───────────┴───────────┐                              │
│              │                       │                              │
│         SUCCESS                   EEXIST                            │
│              │                       │                              │
│              ▼                       ▼                              │
│       lockAcquired=true        getStaleInfo()                       │
│       return true                    │                              │
│                                      ▼                              │
│                               Read existing lock                    │
│                               Parse {pid, time}                     │
│                                      │                              │
│                                      ▼                              │
│                               isProcessAlive(pid)?                  │
│                                      │                              │
│                          ┌───────────┴───────────┐                  │
│                          │                       │                  │
│                       ALIVE                    DEAD                 │
│                          │                       │                  │
│                          ▼                       ▼                  │
│                   Is lock stale?         tryAcquireFromStale()      │
│                   (time > threshold)            │                   │
│                          │                      │                   │
│                          ▼                      ▼                   │
│                   sleep(RETRY_INTERVAL)   Delete old lock           │
│                   continue loop           Create new lock           │
│                                                                     │
│  ┌────────────────┐                                                 │
│  │   release()    │                                                 │
│  └───────┬────────┘                                                 │
│          │                                                          │
│          ├── if !lockAcquired: return                               │
│          │                                                          │
│          ├── fs.unlink(lockPath)                                    │
│          │                                                          │
│          └── lockAcquired = false                                   │
│                                                                     │
│  ┌────────────────────────┐                                         │
│  │ isProcessAlive(pid)    │                                         │
│  └───────────┬────────────┘                                         │
│              │                                                      │
│              ├── Windows: isProcessAliveWindows()                   │
│              │     └── tasklist /FI "PID eq {pid}"                  │
│              │                                                      │
│              └── Unix: isProcessAliveUnix()                         │
│                    └── process.kill(pid, 0)                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `token-estimator.ts`
Token estimation with HDL code awareness.

**Constants:**
- `DEFAULT_TOKEN_CONFIG` - Estimation parameters
- `HDL_CODE_PATTERNS` - Regex to detect VHDL/Verilog
- `SYMBOL_PATTERN` - Special characters pattern

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Token Estimator                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐                                            │
│  │  estimateTokens()   │◄─────────── Main entry point               │
│  └──────────┬──────────┘                                            │
│             │                                                       │
│             ▼                                                       │
│       detectContentType(text)                                       │
│             │                                                       │
│             ├── Match against HDL_CODE_PATTERNS                     │
│             │      (entity, module, always, process, etc.)          │
│             │                                                       │
│             └── Returns: 'hdl_code' | 'code' | 'text'               │
│                        │                                            │
│                        ▼                                            │
│             ┌─────────────────────────────────────┐                 │
│             │   Calculate base estimates          │                 │
│             ├─────────────────────────────────────┤                 │
│             │  charBased = text.length / 4        │                 │
│             │  wordBased = wordCount * 1.3        │                 │
│             └─────────────────────────────────────┘                 │
│                        │                                            │
│                        ▼                                            │
│             ┌─────────────────────────────────────┐                 │
│             │   Apply content-type multiplier     │                 │
│             ├─────────────────────────────────────┤                 │
│             │  hdl_code: codeMultiplier (1.5)     │                 │
│             │  code: codeMultiplier (1.5)         │                 │
│             │  text: textMultiplier (1.0)         │                 │
│             └─────────────────────────────────────┘                 │
│                        │                                            │
│                        ▼                                            │
│             ┌─────────────────────────────────────┐                 │
│             │   Apply symbol penalty              │                 │
│             ├─────────────────────────────────────┤                 │
│             │  countSymbols() * symbolPenalty     │                 │
│             │  (brackets, operators cost extra)   │                 │
│             └─────────────────────────────────────┘                 │
│                        │                                            │
│                        ▼                                            │
│             ┌─────────────────────────────────────┐                 │
│             │   Add safety margin                 │                 │
│             ├─────────────────────────────────────┤                 │
│             │  total * (1 + safetyMargin)         │                 │
│             │  Default: 10% buffer                │                 │
│             └─────────────────────────────────────┘                 │
│                        │                                            │
│                        ▼                                            │
│             Return TokenEstimate {                                  │
│                 tokens: number,                                     │
│                 breakdown: TokenBreakdown                           │
│             }                                                       │
│                                                                     │
│  Helper Functions:                                                  │
│  ┌─────────────────────┐                                            │
│  │ fitsInBudget()      │ tokens <= budget                           │
│  ├─────────────────────┤                                            │
│  │ truncateToFit()     │ Binary search for max content              │
│  ├─────────────────────┤                                            │
│  │ estimateTokensTotal │ Sum estimates for array of texts           │
│  └─────────────────────┘                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `utils.ts`
Simple re-export of `estimateTokens` from token-estimator.

---

## store/ Subdirectory

### `store/memory.types.ts`
Type definitions for conversation memory system.

**Exports:**
- `MemoryConfig` - Manager configuration
- `ProjectMemory` - Full project memory state
- `ConversationSummary` - Archived conversation metadata
- `ChatHistoryFile` - Archive file reference
- `RelevantMessage` - Search result from archives (role: user|assistant|tool)
- `ArchivedSession` - Session listing
- `SummarizationResult` - Context summarization output
- `Message` - Chat message with optional toolCalls

---

### `store/manager.ts`
Project memory persistence with delegation to ArchiveManager.

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MemoryManager                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  constructor(projectRoot, bus, config)                              │
│       │                                                             │
│       ├── Generate projectId from path hash                         │
│       ├── Set up paths (memoryPath, lockPath)                       │
│       └── Create ArchiveManager instance                            │
│                                                                     │
│  ┌─────────────┐                                                    │
│  │   load()    │                                                    │
│  └──────┬──────┘                                                    │
│         │                                                           │
│         ├── ioMutex.withLock()                                      │
│         ├── mkdir(memoryDir)                                        │
│         ├── Read JSON from memoryPath                               │
│         ├── migrate() if needed                                     │
│         └── Return ProjectMemory                                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    READY STATE                                │   │
│  │  this.memory: ProjectMemory                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  CRUD Operations (all trigger scheduleSave):                        │
│  ┌─────────────────────┐  ┌─────────────────────┐                   │
│  │ addConversation()   │  │ updateContext()     │                   │
│  │ addApproval()       │  │ addModuleNote()     │                   │
│  │ clearSessionApprovals│ │ addRecentFile()     │                   │
│  └─────────────────────┘  └─────────────────────┘                   │
│         │                        │                                  │
│         └────────────┬───────────┘                                  │
│                      ▼                                              │
│               scheduleSave()                                        │
│                      │                                              │
│                      ├── Set dirty = true                           │
│                      ├── Clear existing timeout                     │
│                      └── Set new timeout (5000ms)                   │
│                             │                                       │
│                             ▼                                       │
│                      ┌──────────┐                                   │
│                      │  save()  │                                   │
│                      └────┬─────┘                                   │
│                           │                                         │
│                           ├── ioMutex.withLock()                    │
│                           ├── Write JSON atomically                 │
│                           └── dirty = false                         │
│                                                                     │
│  Archive Delegation (to ArchiveManager):                            │
│  ┌───────────────────────────┐                                      │
│  │ archiveConversation()     │──► archiveManager.archiveConversation│
│  │ triggerSummarization()    │──► archiveManager.triggerSummarize   │
│  │ queryArchivedHistory()    │──► archiveManager.queryArchived      │
│  │ getArchivedTurn()         │──► archiveManager.getArchivedTurn    │
│  │ listArchivedSessions()    │──► archiveManager.listArchived       │
│  │ cleanupArchives()         │──► archiveManager.cleanupArchives    │
│  └───────────────────────────┘                                      │
│                                                                     │
│  ┌─────────────────────┐                                            │
│  │ getContextForAI()   │◄─────────── Returns formatted context      │
│  └──────────┬──────────┘                                            │
│             │                                                       │
│             ├── Format recent conversations                         │
│             ├── Format module notes                                 │
│             ├── Format recent files                                 │
│             └── Return context string                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `store/conversation-archive.ts`
Conversation archiving with BM25-like search.

**Constants:**
- `MAX_QUERY_RESULTS = 20` - Max search results
- `DEFAULT_ARCHIVE_MAX_AGE_MS = 7 days` - Cleanup threshold
- `TOPIC_MIN_LENGTH = 10`, `TOPIC_MAX_LENGTH = 100` - Topic extraction
- `MAX_TOPICS_IN_SUMMARY = 3` - Summary limit
- `MAX_EXCERPT_LENGTH = 300`, `EXCERPT_CONTEXT_WINDOW = 100` - Excerpt sizing
- `VALID_RELEVANT_ROLES = ['user', 'assistant', 'tool']` - Searchable roles

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ArchiveManager                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  constructor(projectId, config, bus)                                │
│       │                                                             │
│       └── Set archiveDir = memoryDir/archives/{projectId}           │
│                                                                     │
│  ┌────────────────────────┐                                         │
│  │ archiveConversation()  │                                         │
│  └───────────┬────────────┘                                         │
│              │                                                      │
│              ├── archiveMutex.withLock()                            │
│              ├── Validate sessionId                                 │
│              ├── mkdir(archiveDir)                                  │
│              │                                                      │
│              ▼                                                      │
│        Expand messages:                                             │
│        ┌─────────────────────────────────────────────┐              │
│        │  For each message:                          │              │
│        │    └─► Add {index, turn, role, content}     │              │
│        │    └─► If toolCalls present:                │              │
│        │          For each toolCall with result:     │              │
│        │            └─► Add {role:'tool', toolName}  │              │
│        └─────────────────────────────────────────────┘              │
│              │                                                      │
│              ├── Write JSON to {sessionId}-{timestamp}.json         │
│              └── Return ChatHistoryFile                             │
│                                                                     │
│  ┌────────────────────────┐                                         │
│  │ triggerSummarization() │◄─────── Called when context fills up    │
│  └───────────┬────────────┘                                         │
│              │                                                      │
│              ├── Check threshold (configurable)                     │
│              ├── Split: messagesToArchive / remainingMessages       │
│              ├── generateArchiveSummary()                           │
│              ├── archiveConversation()                              │
│              └── Return SummarizationResult                         │
│                                                                     │
│  ┌────────────────────────┐                                         │
│  │ queryArchivedHistory() │◄─────── Search past conversations       │
│  └───────────┬────────────┘                                         │
│              │                                                      │
│              ├── Read all .json files in archiveDir                 │
│              │                                                      │
│              ▼                                                      │
│        For each archive file:                                       │
│        ┌─────────────────────────────────────────────┐              │
│        │  parseAndValidateArchive()                  │              │
│        │       │                                     │              │
│        │       ▼                                     │              │
│        │  For each message:                          │              │
│        │    └─► Skip if role not in VALID_ROLES      │              │
│        │    └─► calculateRelevance(content, query)   │              │
│        │           │                                 │              │
│        │           ├── Exact phrase match: +0.5      │              │
│        │           ├── Term frequency: +0.1 each     │              │
│        │           └── Position bonus: earlier=better│              │
│        │    └─► If relevance > 0:                    │              │
│        │           extractRelevantExcerpt()          │              │
│        │           Add to results with toolName      │              │
│        └─────────────────────────────────────────────┘              │
│              │                                                      │
│              ├── Sort by relevance                                  │
│              └── Return top MAX_QUERY_RESULTS                       │
│                                                                     │
│  ┌────────────────────────┐                                         │
│  │ generateArchiveSummary │                                         │
│  └───────────┬────────────┘                                         │
│              │                                                      │
│              ├── Extract topics from user messages                  │
│              │     (first sentence, length-filtered)                │
│              └── Join top 3 topics                                  │
│                                                                     │
│  ┌────────────────────────┐                                         │
│  │ cleanupArchives()      │                                         │
│  └───────────┬────────────┘                                         │
│              │                                                      │
│              └── Delete files older than maxAge                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## extractors/ Subdirectory

### `extractors/types.ts`
Type definitions for extraction system.

**Exports:**
- `ExtractableKnowledgeType` - Types that can be extracted
- `ExtractableDeclarationKind` - Declaration kinds (module, interface, package)
- `ExtractionOptions` - Configuration for extraction
- `ExtractionResult` - Result with counts and timing
- `ExtractedCount` - Breakdown by category
- `validateExtractionOptions()` - Options validator

---

### `extractors/index.ts`
Re-exports from extractor modules.

---

### `extractors/indexer-extractor.ts`
Main orchestrator for knowledge extraction from indexer output.

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                      indexer-extractor.ts                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐                                            │
│  │ extractFromIndex()  │◄─────────── Main entry point               │
│  └──────────┬──────────┘                                            │
│             │                                                       │
│             ├── Input: ResolvedProject, KnowledgeStore, Options     │
│             │                                                       │
│             ├── validateOptions()                                   │
│             │                                                       │
│             ▼                                                       │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  if (options.extractModules !== false)              │       │
│       │       │                                             │       │
│       │       ▼                                             │       │
│       │  extractModuleInfo(project, store, options)         │       │
│       │       └──► module-extractor.ts                      │       │
│       │       └──► Returns count of modules/interfaces/pkgs │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             ▼                                                       │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  if (options.extractDependencies !== false)         │       │
│       │       │                                             │       │
│       │       ▼                                             │       │
│       │  extractDependencies(project, store, options)       │       │
│       │       └──► dependency-extractor.ts                  │       │
│       │       └──► Returns count of dependency items        │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             ▼                                                       │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  if (options.extractHierarchy !== false)            │       │
│       │       │                                             │       │
│       │       ▼                                             │       │
│       │  extractHierarchy(project, store, options)          │       │
│       │       └──► hierarchy-extractor.ts                   │       │
│       │       └──► Returns count of hierarchy items         │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             ▼                                                       │
│       Return ExtractionResult {                                     │
│           success: true,                                            │
│           counts: { modules, interfaces, packages, ... },           │
│           durationMs: elapsed                                       │
│       }                                                             │
│                                                                     │
│  Helper Functions:                                                  │
│  ┌─────────────────────────┐                                        │
│  │ createExtractionOptions │ Create options with defaults           │
│  │ extractModulesOnly      │ Convenience for module-only extraction │
│  │ formatExtractionSummary │ Human-readable summary                 │
│  └─────────────────────────┘                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `extractors/module-extractor.ts`
Extracts module/interface/package information.

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                      module-extractor.ts                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐                                            │
│  │ extractModuleInfo() │                                            │
│  └──────────┬──────────┘                                            │
│             │                                                       │
│             ├── Input: ResolvedProject, KnowledgeStore, Options     │
│             │                                                       │
│             ▼                                                       │
│       For each declaration in project.declarations:                 │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  if kind not in ['module','interface','package']    │       │
│       │       └──► skip                                     │       │
│       │                                                     │       │
│       │  shouldIncludeFile(filePath, options)?              │       │
│       │       └──► Check include/exclude patterns           │       │
│       │                                                     │       │
│       │  findChildPorts(declaration)                        │       │
│       │       └──► Filter declarations for ports            │       │
│       │                                                     │       │
│       │  findChildParameters(declaration)                   │       │
│       │       └──► Filter declarations for parameters       │       │
│       │                                                     │       │
│       │  formatModuleContent(decl, ports, params)           │       │
│       │       └──► Build human-readable content string      │       │
│       │       └──► Include port directions, types           │       │
│       │       └──► Include parameter defaults               │       │
│       │                                                     │       │
│       │  buildKeywords(decl, ports, params)                 │       │
│       │       └──► Extract searchable terms                 │       │
│       │                                                     │       │
│       │  buildTags(decl)                                    │       │
│       │       └──► ['vhdl'/'verilog', kind, ...]            │       │
│       │                                                     │       │
│       │  Create KnowledgeItem:                              │       │
│       │  {                                                  │       │
│       │    type: 'module_info',                             │       │
│       │    title: "Module: {name}",                         │       │
│       │    content: formatted content,                      │       │
│       │    keywords, tags, scope, source, confidence        │       │
│       │  }                                                  │       │
│       │                                                     │       │
│       │  store.addKnowledge(item)                           │       │
│       │  count++                                            │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             └── Return count                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `extractors/hierarchy-extractor.ts`
Extracts design hierarchy information.

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                     hierarchy-extractor.ts                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐                                            │
│  │ extractHierarchy()  │                                            │
│  └──────────┬──────────┘                                            │
│             │                                                       │
│             ├── Input: ResolvedProject, KnowledgeStore, Options     │
│             │                                                       │
│             ▼                                                       │
│       For each hierarchy root in project.hierarchy:                 │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  flattenHierarchy(root)                             │       │
│       │       │                                             │       │
│       │       ▼                                             │       │
│       │  Recursive walk():                                  │       │
│       │    └─► Collect FlatNode { depth, parentModule }     │       │
│       │    └─► Track parent instance path                   │       │
│       │                                                     │       │
│       │  getMaxDepth(root)                                  │       │
│       │       └──► Calculate hierarchy depth                │       │
│       │                                                     │       │
│       │  countNodes(root)                                   │       │
│       │       └──► Count total instances                    │       │
│       │                                                     │       │
│       │  formatContent(root, flatNodes, depth, count)       │       │
│       │       └──► Build hierarchy tree representation      │       │
│       │                                                     │       │
│       │  buildKeywords(root, flatNodes)                     │       │
│       │       └──► Module names, instance names             │       │
│       │                                                     │       │
│       │  Create KnowledgeItem:                              │       │
│       │  {                                                  │       │
│       │    type: 'module_info',                             │       │
│       │    title: "Hierarchy: {root}",                      │       │
│       │    content: tree representation                     │       │
│       │  }                                                  │       │
│       │                                                     │       │
│       │  store.addKnowledge(item)                           │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             ▼                                                       │
│       extractProjectOverview(project, store, options)               │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  Aggregate stats across all hierarchies            │       │
│       │  Create single "Project Overview" KnowledgeItem    │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             └── Return count                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### `extractors/dependency-extractor.ts`
Extracts module dependencies.

**Internal Flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    dependency-extractor.ts                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────┐                                           │
│  │ extractDependencies()│                                           │
│  └──────────┬───────────┘                                           │
│             │                                                       │
│             ├── Input: ResolvedProject, KnowledgeStore, Options     │
│             │                                                       │
│             ▼                                                       │
│       groupByReason(project.dependencies)                           │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  Group dependencies by:                             │       │
│       │    - 'instantiation': Module instantiates another   │       │
│       │    - 'package_use': Uses package                    │       │
│       │    - 'interface_use': Uses interface                │       │
│       │    - 'other': Other dependencies                    │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             ▼                                                       │
│       For each dependency group:                                    │
│       ┌─────────────────────────────────────────────────────┐       │
│       │  shouldIncludeFiles(dep.from, dep.to, options)?     │       │
│       │       └──► Check include/exclude patterns           │       │
│       │                                                     │       │
│       │  formatTitle(groupKey, deps)                        │       │
│       │       └──► "Instantiation Dependencies" etc.        │       │
│       │                                                     │       │
│       │  formatContent(deps)                                │       │
│       │       └──► List: "ModuleA → ModuleB (reason)"       │       │
│       │                                                     │       │
│       │  buildKeywords(deps)                                │       │
│       │       └──► From/to module names                     │       │
│       │                                                     │       │
│       │  Create KnowledgeItem:                              │       │
│       │  {                                                  │       │
│       │    type: 'dependency',                              │       │
│       │    title: group title,                              │       │
│       │    content: dependency list                         │       │
│       │  }                                                  │       │
│       │                                                     │       │
│       │  store.addKnowledge(item)                           │       │
│       └─────────────────────────────────────────────────────┘       │
│             │                                                       │
│             └── Return count                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Cross-Module Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     OVERALL SYSTEM FLOW                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  INITIALIZATION:                                                    │
│                                                                     │
│  Application Start                                                  │
│       │                                                             │
│       ▼                                                             │
│  MemoryService.initialize()                                         │
│       │                                                             │
│       ├──► KnowledgeStore.load()                                    │
│       │         └──► Read JSON, rebuild BM25 indices                │
│       │                                                             │
│       ├──► MemoryManager.load()                                     │
│       │         └──► Read project memory JSON                       │
│       │         └──► ArchiveManager ready                           │
│       │                                                             │
│       └──► TieredKnowledgeStore.initialize()                        │
│                 └──► Classify items into hot/warm/cold              │
│                                                                     │
│  KNOWLEDGE EXTRACTION (after indexing):                             │
│                                                                     │
│  SVIndexer.indexProject()                                           │
│       │                                                             │
│       ▼                                                             │
│  extractFromIndex(project, knowledgeStore, options)                 │
│       │                                                             │
│       ├──► extractModuleInfo() ──► KnowledgeStore.addKnowledge()    │
│       ├──► extractDependencies() ──► KnowledgeStore.addKnowledge()  │
│       └──► extractHierarchy() ──► KnowledgeStore.addKnowledge()     │
│                                                                     │
│  CONTEXT RETRIEVAL (during AI interaction):                         │
│                                                                     │
│  MemoryService.getContextForAI(filePath, moduleName)                │
│       │                                                             │
│       ├──► KnowledgeStore.getContextKnowledge()                     │
│       │         └──► BM25 search with scope matching                │
│       │         └──► TieredStore.getItem() for hot/warm access      │
│       │                                                             │
│       ├──► MemoryManager.getContextForAI()                          │
│       │         └──► Recent conversations, module notes             │
│       │                                                             │
│       └──► truncateToTokenBudget()                                  │
│                 └──► token-estimator.ts                             │
│                                                                     │
│  CONVERSATION ARCHIVING:                                            │
│                                                                     │
│  Context window filling up                                          │
│       │                                                             │
│       ▼                                                             │
│  MemoryManager.triggerSummarization()                               │
│       │                                                             │
│       ▼                                                             │
│  ArchiveManager.triggerSummarization()                              │
│       │                                                             │
│       ├──► Split messages (archive old, keep recent)                │
│       ├──► Expand toolCalls into searchable 'tool' messages         │
│       ├──► generateArchiveSummary()                                 │
│       └──► Write {sessionId}-{timestamp}.json                       │
│                                                                     │
│  ARCHIVE SEARCH:                                                    │
│                                                                     │
│  MemoryManager.queryArchivedHistory(sessionId, query)               │
│       │                                                             │
│       ▼                                                             │
│  ArchiveManager.queryArchivedHistory()                              │
│       │                                                             │
│       ├──► Read all archive JSONs                                   │
│       ├──► For each message (user/assistant/tool):                  │
│       │         calculateRelevance() with BM25-like scoring         │
│       ├──► extractRelevantExcerpt()                                 │
│       └──► Return sorted RelevantMessage[]                          │
│                                                                     │
│  SHUTDOWN:                                                          │
│                                                                     │
│  MemoryService.shutdown()                                           │
│       │                                                             │
│       ├──► KnowledgeStore.flush() ──► Immediate save                │
│       └──► MemoryManager.flush() ──► Immediate save                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File Dependency Graph

```
src/memory/
│
├── index.ts ◄──────────────── Entry point (re-exports)
│
├── knowledge-types.ts ◄────── Pure types, no dependencies
│
├── KnowledgeStore.ts
│       ├── imports: knowledge-types.ts (re-exports its types)
│       ├── imports: utils.ts (estimateTokens)
│       └── imports: ../events, ../concurrency
│
├── MemoryService.ts
│       ├── imports: KnowledgeStore.ts
│       ├── imports: store/manager.ts
│       └── imports: tiered-store.ts
│
├── tiered-store.ts
│       └── imports: KnowledgeStore.ts (KnowledgeItem type)
│
├── file-lock.ts ◄──────────── Standalone, no internal deps
│
├── token-estimator.ts ◄────── Standalone, no internal deps
│
├── utils.ts
│       └── imports: token-estimator.ts (re-exports)
│
├── store/
│       ├── memory.types.ts ◄── Pure types
│       │
│       ├── manager.ts
│       │       ├── imports: memory.types.ts
│       │       └── imports: conversation-archive.ts
│       │
│       └── conversation-archive.ts
│               └── imports: memory.types.ts
│
└── extractors/
        ├── types.ts ◄───────── Pure types
        │
        ├── index.ts ◄───────── Re-exports
        │
        ├── indexer-extractor.ts (orchestrator)
        │       ├── imports: types.ts
        │       ├── imports: module-extractor.ts
        │       ├── imports: hierarchy-extractor.ts
        │       └── imports: dependency-extractor.ts
        │
        ├── module-extractor.ts
        │       └── imports: ../KnowledgeStore.ts
        │
        ├── hierarchy-extractor.ts
        │       └── imports: ../KnowledgeStore.ts
        │
        └── dependency-extractor.ts
                └── imports: ../KnowledgeStore.ts
```
