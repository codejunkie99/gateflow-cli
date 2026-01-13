# Memory System Design for GateFlow AI Agent

> **Purpose**: Comprehensive analysis of what the agent can LEARN from this codebase, with concrete memory taxonomy, schema, extraction points, and update rules.
>
> **Date**: 2026-01-13
> **Companion Document**: `KNOWLEDGE_STORE_ARCHITECTURE.md` (detailed KnowledgeStore internals)

---

## Table of Contents

1. [Executive Summary](#a-executive-summary)
2. [Sources of Truth Inventory](#1-sources-of-truth-inventory)
3. [Memory Candidate Register](#b-memory-candidate-register)
4. [Proposed Memory Schema](#c-proposed-memory-schema)
5. [Extraction Plan](#d-extraction-plan)
6. [Integration Points (Dataflow)](#e-integration-points-dataflow)
7. [Failure Modes](#f-failure-modes)
8. [Implementation Priority](#g-implementation-priority)

---

## A) Executive Summary

### Top Memory Opportunities

1. **Critical Gap**: Indexer produces rich structural data (`ResolvedProject` with declarations, references, hierarchy) but **none flows into KnowledgeStore** - data discarded after each indexing run (`src/indexer/sv-indexer.ts:1-300`)

2. **Strong Foundation Exists**: KnowledgeStore has production-ready BM25 search, inverted index, tiered storage, and extraction hooks for lint/codegen - but `module_info`, `dependency`, `project_context` types declared but **never populated** (`src/memory/KnowledgeStore.ts:44-54`)

3. **Top Memory Opportunity**: Bridge indexer→memory with `extractFromIndex(ResolvedProject)` method to persist module metadata, port signatures, hierarchy, and dependencies - enables cross-session codebase understanding

4. **High-Value Behavioral Data**: FixLoop tracks error signatures and fix attempts in-memory (`src/verification/fix-loop.ts:50-51`) but **doesn't persist** across sessions - loses troubleshooting patterns

### Top Risks

5. **Known Bug Risk**: Content updates bypass index rebuild (`KnowledgeStore.ts:350-360`) - causes stale search results and duplicate retrieval

6. **Scope Mismatch Risk**: Scoped knowledge items use fail-closed matching - items scoped to modules/files become invisible when query lacks context (`KnowledgeStore.ts:551-578`)

7. **File Watcher Integration Missing**: `WatchManager` triggers re-indexing but doesn't update knowledge store - structural changes don't refresh memory (`src/watch/watcher.ts:267-269`)

8. **Token Budget System Works**: MemoryService properly splits budget (40% memory, 60% knowledge) with token estimation for HDL code (`src/memory/MemoryService.ts:108-133`, `src/memory/token-estimator.ts:55-62`)

---

## 1) Sources of Truth Inventory

### 1.1 Indexing/Parsing Components

| Component | File | Responsibility | Outputs | Inputs |
|-----------|------|----------------|---------|--------|
| **SVIndexer** | `src/indexer/sv-indexer.ts:1-300` | Main entry point, orchestrates parsing | `ResolvedProject` | File paths, .f filelists |
| **SlangBackend** | `src/indexer/slang/slang-backend.ts` | Primary semantic analysis (subprocess) | Declarations, references, instances | SV source files |
| **VeriblAdapter** | `src/indexer/verible/verible-adapter.ts` | Secondary directive parser (CST) | Preprocessor directives | SV source files |
| **ProjectResolver** | `src/indexer/resolver/project-resolver.ts:1-200` | Cross-file resolution | Resolved references, hierarchy | Per-file parse results |
| **DeclarationIndex** | `src/indexer/resolver/declaration-index.ts:1-150` | O(1) declaration lookup | Declaration by name | All declarations |
| **FilelistParser** | `src/indexer/recipe/filelist-parser.ts` | Parses .f filelist files | Recipe (file list + includes) | .f files |

### 1.2 Persistence Components

| Component | File | Storage Location | What It Persists |
|-----------|------|------------------|------------------|
| **KnowledgeStore** | `src/memory/KnowledgeStore.ts:1-1258` | `~/.gateflow/{projectId}-knowledge.json` | Learned patterns (500 items max) |
| **MemoryManager** | `src/memory/manager.ts:1-400` | `~/.gateflow/{projectId}-memory.json` | Approvals, context, history |
| **ProjectIndexCache** | `src/indexer/cache/project-index-cache.ts` | `~/.gateflow/index-cache/{hash}.json` | Cached ResolvedProject |
| **FileResultCache** | `src/indexer/cache/file-result-cache.ts` | In-memory | Per-file parse results |

### 1.3 Retrieval/Ranking Components

| Component | File | Algorithm | Complexity |
|-----------|------|-----------|------------|
| **KnowledgeStore.search()** | `KnowledgeStore.ts:428-475` | BM25 + inverted index | O(k) where k = matching docs |
| **TieredKnowledgeStore** | `src/memory/tiered-store.ts:1-424` | Hot/warm/cold tier management | O(1) hot lookup |
| **Token Estimator** | `src/memory/token-estimator.ts:1-285` | HDL-aware token counting | O(n) string length |

### 1.4 File Watching / Incremental Updates

| Component | File | Triggers | Actions |
|-----------|------|----------|---------|
| **WatchManager** | `src/watch/watcher.ts:1-370` | File add/change/unlink | lint, index, compile |
| **Chokidar** | External dependency | FSWatcher events | Debounced (300ms) |

**Gap Identified**: WatchManager calls `indexer.updateFile()` but does NOT update KnowledgeStore.

### 1.5 Agent Loop / Context Building

| Component | File | Role | Memory Integration |
|-----------|------|------|-------------------|
| **GateFlowAgent** | `src/agent/core.ts:103-782` | Main agent loop | ✅ Calls MemoryService.getContextForAI() |
| **MemoryService** | `src/memory/MemoryService.ts:1-205` | Unified facade | ✅ Token-budgeted context |
| **Orchestrator** | `src/agent/orchestrator/Orchestrator.ts:1-400` | Multi-agent coordination | ⚠️ Uses agent's memory |
| **FixLoop** | `src/verification/fix-loop.ts:1-452` | Iterative lint→fix | ❌ In-memory only |

---

## B) Memory Candidate Register

### Legend
- **Category**: `D` = Deterministic code facts, `L` = Learned preference, `O` = Operational log, `W` = Workflow, `I` = Project intent
- **Confidence**: Default confidence level (0.0-1.0)
- **TTL**: Time-to-live (Never = invalidate on change, N days = expire after)

| # | Candidate Name | Cat | Evidence (path:lines) | Extraction Hook | Key | Scope | Update Trigger | Conf | TTL | Value |
|---|---------------|-----|----------------------|-----------------|-----|-------|----------------|------|-----|-------|
| 1 | `module_info` | D | `types/declaration.ts:54-98` DeclarationKind | `SVIndexer.indexProject()` → extract from `ResolvedProject.declarations.filter(d => d.kind === 'module')` | `decl.id` | module | on index | 1.0 | Never | Module lookup, port info, code generation |
| 2 | `port_signature` | D | `types/declaration.ts:446-454` PortData | Extract from declarations where `kind === 'port'`, group by parent | `parentId + port.name` | module | on index | 1.0 | Never | Instantiation completion, testbench gen |
| 3 | `dependency_edge` | D | `types/result.ts:398-437` FileDependency | `ResolvedProject.dependencies[]` | `fromFile + toFile + reason` | project | on index | 1.0 | Never | Compile order, change propagation |
| 4 | `hierarchy_node` | D | `types/result.ts:340-364` HierarchyNode | `ResolvedProject.hierarchy[]` recursive | `moduleId + instanceName` | project | on index | 1.0 | Never | Navigation, module relationships |
| 5 | `parameter_info` | D | `types/declaration.ts:457-463` ParameterData | Extract `kind === 'parameter'` | `parentId + param.name` | module | on index | 1.0 | Never | Parameterized instantiation |
| 6 | `typedef_info` | D | `types/declaration.ts:407-411` TypedefData | Extract `kind === 'typedef'` | `decl.id` | pkg/module | on index | 1.0 | Never | Type lookup, auto-import |
| 7 | `lint_fix_pattern` | L | `KnowledgeStore.ts:666-759` extractFromLintSession() | ✅ Already implemented | `error_signature_hash` | project/file | on fix success | 0.5-0.9 | 30d | Avoid repeated errors |
| 8 | `code_pattern` | L | `KnowledgeStore.ts:769-803` extractFromCodeGen() | ✅ Already implemented | `type + pattern_hash` | project/module | on codegen | 0.7 | 30d | Consistent generated code |
| 9 | `style_preference` | L | `KnowledgeStore.ts:813-848` learnFromCorrection() | ✅ Already implemented | `correction_fingerprint` | project/file | on user edit | 0.95 | Never | Match user's style |
| 10 | `error_signature` | O | `fix-loop.ts:263-269` getErrorSignature() | Capture from FixLoop.attemptMemory | `code + file + normalized_msg` | project | on fix session end | 0.6-0.9 | 7d | Thrashing detection |
| 11 | `fix_attempt_history` | O | `fix-loop.ts:274-294` recordAttempt() | Extract from FixLoop.currentSession | `error_sig + fix_hash` | project | on fix loop complete | varies | 7d | Avoid repeating failed fixes |
| 12 | `tool_approval_grant` | O | `manager.ts` approval storage | ✅ Already persisted | `tool + path_pattern` | project | on user approval | 1.0 | Session | Reduce approval fatigue |
| 13 | `project_context_summary` | I | `manager.ts` context storage | ✅ Already persisted | `project_id` | project | on significant change | 0.8 | Refresh | Context for AI |
| 14 | `compile_context` | W | `recipe/filelist-parser.ts` Recipe | Extract from parsed .f filelist | `filelist_path_hash` | project | on filelist change | 1.0 | Refresh | Correct include paths |
| 15 | `include_path_set` | W | `types/directive.ts` IncludeData | Extract from `directives.filter(d => d.kind === 'include')` | `project_id` | project | on index | 1.0 | Refresh | Resolve includes |
| 16 | `macro_definition` | D | `resolver/macro-index.ts` MacroIndex | Extract from MacroIndex | `macro_name + defining_file` | project/file | on index | 1.0 | Refresh | Conditional compilation |
| 17 | `testbench_dut_mapping` | L | Infer from `analyzeGeneratedCode()` | Extract when testbench generated | `tb_module + dut_module` | project | on tb creation | 0.8 | Never | Associate TBs with DUTs |
| 18 | `naming_convention` | L | `KnowledgeStore.ts:982-995` detectNamingStyle() | Aggregate from corrections | `project_id` | project | on corrections | 0.7-0.95 | Never | Consistent naming |
| 19 | `reset_pattern` | L | `KnowledgeStore.ts:937-942` analyzeDiff() | Extract from reset-related corrections | `project_id` | project | on corrections | 0.8 | Never | Correct reset style |
| 20 | `clock_domain_info` | D | Infer from `always_ff` sensitivity | Parse from AlwaysBlockData.sensitivity | `module_id + clock_name` | module | on index | 0.9 | Refresh | CDC awareness |
| 21 | `interface_modport_usage` | D | `types/declaration.ts:486-490` ModportData | Extract from modport declarations | `interface_id + modport_name` | module | on index | 1.0 | Refresh | Correct interface use |
| 22 | `assertion_pattern` | L | Extract from `kinds = ['sequence', 'property']` | From declarations | `assertion_type + hash` | project | on index/correction | 0.7 | 30d | Consistent assertions |
| 23 | `simulation_tool_config` | W | Not currently extracted | Parse verilator output | `tool + flags_hash` | project | on tool run | 0.9 | Refresh | Correct tool invocation |
| 24 | `file_purpose_annotation` | I | Not currently extracted | Infer from path patterns + content | `file_path_pattern` | file | on first index | 0.6 | Never | AI context |
| 25 | `common_import_set` | L | Infer from `ReferenceKind = 'import'` | Aggregate imports across files | `project_id` | project | on index | 0.8 | Refresh | Auto-import suggestions |
| 26 | `signal_naming_pattern` | L | Extract from SignalData names | Pattern analysis on signals | `project_id` | project | on index/correction | 0.7 | Never | Consistent signal naming |
| 27 | `fsm_state_encoding` | L | `KnowledgeStore.ts:1006-1015` FSM detection | Extract from enum in FSMs | `module_id` | module | on index | 0.8 | Refresh | Consistent FSM style |
| 28 | `conversation_summary` | O | `manager.ts` triggerSummarization() | ✅ Already implemented | `session_id` | session | on context archiving | 0.9 | 30d | Long conversation continuity |
| 29 | `user_preference` | L | `manager.ts` UserPreferences | ✅ Already persisted | `preference_key` | project | on explicit set | 1.0 | Never | Honor user settings |
| 30 | `recent_file_context` | O | `manager.ts` RecentFileInfo | ✅ Already tracked | `file_path` | session | on file access | 0.8 | Session | Focus on active files |

---

## C) Proposed Memory Schema

### Namespace Structure

```
memory/
├── facts/           # Deterministic, from indexer
│   ├── modules/     # module_info, port_signature, parameter_info
│   ├── types/       # typedef_info, struct_info, enum_info
│   ├── hierarchy/   # hierarchy_node, dependency_edge
│   └── workflow/    # compile_context, include_paths, macros
├── learned/         # Inferred/user-provided
│   ├── patterns/    # code_pattern, lint_fix_pattern
│   ├── preferences/ # style_preference, naming_convention
│   └── mappings/    # testbench_dut_mapping
├── logs/            # Volatile operational data
│   ├── errors/      # error_signature, fix_attempt_history
│   ├── approvals/   # tool_approval_grant
│   └── sessions/    # conversation_summary, recent_files
└── intent/          # Project-level understanding
    ├── context/     # project_context_summary
    └── annotations/ # file_purpose_annotation
```

### Core Schema (TypeScript)

```typescript
// Base memory item - all items extend this
interface MemoryItem {
  // Identity
  id: string;                    // UUID
  fingerprint: string;           // Content-based dedup hash

  // Classification
  namespace: 'facts' | 'learned' | 'logs' | 'intent';
  type: MemoryItemType;          // Specific type within namespace

  // Scope (where this applies)
  scope: {
    global: boolean;             // Applies everywhere
    projectIds?: string[];       // Specific projects
    compileContexts?: string[];  // Specific .f file contexts (NEW)
    filePatterns?: string[];     // Glob patterns
    modules?: string[];          // Module names
  };

  // Provenance (where it came from)
  source: {
    origin: 'indexer' | 'user' | 'tool' | 'heuristic';
    sourceId?: string;           // e.g., declaration ID, session ID
    filePath?: string;
    tool?: string;
    timestamp: number;
  };

  // Quality
  confidence: number;            // 0.0 - 1.0
  version: number;               // Increment on update

  // Lifecycle
  created: number;
  updated: number;
  lastAccessed: number;
  useCount: number;
  ttl?: number;                  // Milliseconds, undefined = never expire

  // Content (type-specific)
  title: string;
  content: string;               // Human-readable summary
  data: Record<string, unknown>; // Structured data for programmatic use

  // Retrieval
  keywords: string[];            // For BM25 search
  tags: string[];                // For filtering
}

// Type-specific extensions
interface ModuleInfoItem extends MemoryItem {
  namespace: 'facts';
  type: 'module_info';
  data: {
    declarationId: string;
    name: string;
    filePath: string;
    line: number;
    kind: 'module' | 'interface' | 'package';
    parameters: Array<{ name: string; type?: string; default?: string }>;
    portCount: number;
    isTop: boolean;              // Has no instantiators
  };
}

interface DependencyEdgeItem extends MemoryItem {
  namespace: 'facts';
  type: 'dependency_edge';
  data: {
    fromFile: string;
    toFile: string;
    reason: 'instantiates' | 'imports' | 'includes' | 'extends';
    entityName: string;
    conditional?: string;        // ifdef guard
  };
}

interface LintFixPatternItem extends MemoryItem {
  namespace: 'learned';
  type: 'lint_fix_pattern';
  data: {
    errorCode: string;
    normalizedMessage: string;
    suggestedFix?: string;
    occurrences: number;
    successRate: number;
  };
}
```

### Example JSON Records

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "fingerprint": "a1b2c3d4e5f6g7h8",
  "namespace": "facts",
  "type": "module_info",
  "scope": {
    "global": false,
    "projectIds": ["abc123def456"],
    "modules": ["counter"]
  },
  "source": {
    "origin": "indexer",
    "sourceId": "decl:xyz789",
    "filePath": "/project/rtl/counter.sv",
    "timestamp": 1704067200000
  },
  "confidence": 1.0,
  "version": 1,
  "created": 1704067200000,
  "updated": 1704067200000,
  "lastAccessed": 1704067200000,
  "useCount": 0,
  "title": "Module: counter",
  "content": "8-bit counter with enable and reset. Ports: clk, rst_n, en, count[7:0]",
  "data": {
    "declarationId": "decl:xyz789",
    "name": "counter",
    "filePath": "/project/rtl/counter.sv",
    "line": 5,
    "kind": "module",
    "parameters": [{"name": "WIDTH", "type": "int", "default": "8"}],
    "portCount": 4,
    "isTop": false
  },
  "keywords": ["counter", "8-bit", "sequential", "enable", "reset"],
  "tags": ["module", "rtl", "sequential"]
}
```

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "fingerprint": "b2c3d4e5f6g7h8i9",
  "namespace": "learned",
  "type": "lint_fix_pattern",
  "scope": {
    "global": false,
    "projectIds": ["abc123def456"],
    "filePatterns": ["**/rtl/**/*.sv"]
  },
  "source": {
    "origin": "tool",
    "tool": "verilator",
    "timestamp": 1704153600000
  },
  "confidence": 0.85,
  "version": 3,
  "created": 1704067200000,
  "updated": 1704153600000,
  "lastAccessed": 1704153600000,
  "useCount": 12,
  "ttl": 2592000000,
  "title": "Lint pattern: Signal ID is not driven",
  "content": "Error: Signal 'ID' is not driven. Fix: Check signal assignment or mark as input.",
  "data": {
    "errorCode": "UNDRIVEN",
    "normalizedMessage": "Signal 'ID' is not driven",
    "suggestedFix": "Ensure signal has a driver or change to input port",
    "occurrences": 15,
    "successRate": 0.8
  },
  "keywords": ["undriven", "signal", "lint", "verilator"],
  "tags": ["lint", "error-pattern", "signal"]
}
```

### Schema Alignment with Existing Types

The existing `KnowledgeItem` interface (`KnowledgeStore.ts:27-42`) already supports most of the proposed schema:

```typescript
// EXISTING - maps directly to proposed schema
interface KnowledgeItem {
  id: string;              // ✅ Stable identity
  fingerprint: string;     // ✅ Deduplication
  type: KnowledgeType;     // ✅ Includes module_info, dependency (unused)
  title: string;           // ✅ Human-readable
  content: string;         // ✅ Main content
  tags: string[];          // ✅ Filtering
  keywords: string[];      // ✅ BM25 search
  scope: KnowledgeScope;   // ✅ Project/file/module scoping
  source: KnowledgeSource; // ✅ Provenance tracking
  confidence: number;      // ✅ Quality signal
  useCount: number;        // ✅ Usage tracking
  lastAccessed: number;    // ✅ Recency
  created: number;         // ✅ Lifecycle
  updated: number;         // ✅ Versioning
}
```

**Gap**: No `namespace` field. Add via tag convention: `tags: ['namespace:facts', ...]`

---

## D) Extraction Plan

### D1. Indexer → Memory Bridge (NEW - Highest Priority)

**Location**: Create `src/memory/extractors/indexer-extractor.ts`

```typescript
import type { ResolvedProject, Declaration, FileDependency, HierarchyNode } from '../../indexer/types/index.js';
import type { KnowledgeStore, KnowledgeItem } from '../KnowledgeStore.js';

interface ExtractedCount {
  modules: number;
  dependencies: number;
  hierarchy: number;
  types: number;
}

/**
 * Extract knowledge from indexer output
 * Should be called after SVIndexer.indexProject() completes
 */
export async function extractFromIndex(
  project: ResolvedProject,
  knowledgeStore: KnowledgeStore,
  projectId: string,
  sessionId: string
): Promise<ExtractedCount> {
  const counts: ExtractedCount = { modules: 0, dependencies: 0, hierarchy: 0, types: 0 };

  // 1. Extract module_info from declarations
  for (const decl of project.declarations) {
    if (['module', 'interface', 'package'].includes(decl.kind)) {
      knowledgeStore.addKnowledge({
        type: 'module_info',
        title: `${decl.kind}: ${decl.name}`,
        content: formatModuleSummary(decl, project),
        tags: [decl.kind, 'structure', `namespace:facts`],
        keywords: extractModuleKeywords(decl, project),
        scope: {
          global: false,
          projectIds: [projectId],
          modules: [decl.name]
        },
        source: {
          method: 'extracted',
          sessionId,
          filePath: decl.location.file,
          tool: 'indexer'
        },
        confidence: 1.0  // Deterministic from parser
      });
      counts.modules++;
    }
  }

  // 2. Extract dependency_edge from dependencies
  for (const dep of project.dependencies) {
    knowledgeStore.addKnowledge({
      type: 'dependency',
      title: `${dep.reason}: ${dep.entityName}`,
      content: `${dep.fromFile} ${dep.reason} ${dep.entityName} from ${dep.toFile}`,
      tags: ['dependency', dep.reason, 'namespace:facts'],
      keywords: [dep.entityName, basename(dep.fromFile), basename(dep.toFile)],
      scope: {
        global: false,
        projectIds: [projectId]
      },
      source: {
        method: 'extracted',
        sessionId,
        tool: 'indexer'
      },
      confidence: 1.0
    });
    counts.dependencies++;
  }

  // 3. Extract hierarchy (flattened)
  for (const node of flattenHierarchy(project.hierarchy)) {
    knowledgeStore.addKnowledge({
      type: 'project_context',
      title: `Hierarchy: ${node.instanceName} (${node.moduleName})`,
      content: `Instance ${node.instanceName} of module ${node.moduleName} at ${node.file}:${node.line}`,
      tags: ['hierarchy', 'structure', 'namespace:facts'],
      keywords: [node.instanceName, node.moduleName],
      scope: {
        global: false,
        projectIds: [projectId],
        modules: [node.moduleName]
      },
      source: {
        method: 'extracted',
        sessionId,
        tool: 'indexer'
      },
      confidence: 1.0
    });
    counts.hierarchy++;
  }

  return counts;
}

function formatModuleSummary(decl: Declaration, project: ResolvedProject): string {
  const ports = project.declarations.filter(
    d => d.kind === 'port' && d.parentId === decl.id
  );
  const portList = ports.map(p => {
    const data = p.data as { direction: string; portType: string; width?: string };
    return `${data.direction} ${data.portType}${data.width || ''} ${p.name}`;
  }).join(', ');

  return `${decl.kind} ${decl.name} at ${decl.location.file}:${decl.location.line}\nPorts: ${portList || 'none'}`;
}

function extractModuleKeywords(decl: Declaration, project: ResolvedProject): string[] {
  const keywords = [decl.name.toLowerCase()];

  // Add port names
  const ports = project.declarations.filter(
    d => d.kind === 'port' && d.parentId === decl.id
  );
  for (const port of ports) {
    keywords.push(port.name.toLowerCase());
  }

  // Add parameter names
  if (decl.data.kind === 'module' && decl.data.params) {
    for (const param of decl.data.params) {
      keywords.push(param.name.toLowerCase());
    }
  }

  return keywords;
}

function flattenHierarchy(nodes: HierarchyNode[]): HierarchyNode[] {
  const result: HierarchyNode[] = [];
  function walk(node: HierarchyNode) {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of nodes) {
    walk(root);
  }
  return result;
}

function basename(filepath: string): string {
  return filepath.split(/[/\\]/).pop() || filepath;
}
```

**Integration Point**: `src/indexer/sv-indexer.ts` after `resolve()`

```typescript
// In SVIndexer.indexProject():
const resolved = await this.resolver.resolve(results);

// NEW: Feed into knowledge store
if (this.knowledgeStore) {
  const { extractFromIndex } = await import('../memory/extractors/indexer-extractor.js');
  await extractFromIndex(resolved, this.knowledgeStore, this.projectId, sessionId);
}

return resolved;
```

### D2. FixLoop → Memory Bridge (ENHANCE)

**Current State**: `FixLoop.attemptMemory` is in-memory Map, lost on restart

**Enhancement Location**: `src/verification/fix-loop.ts`

```typescript
// Add new method after getStats():
async persistAttemptMemory(knowledgeStore: KnowledgeStore): Promise<number> {
  let persisted = 0;

  for (const [signature, attempts] of this.attemptMemory) {
    const successful = attempts.filter(a => a.success);
    const total = attempts.length;

    if (total >= 2) {  // Only persist patterns seen multiple times
      knowledgeStore.addKnowledge({
        type: 'lint_fix',
        title: `Fix pattern: ${signature.slice(0, 50)}`,
        content: successful.length > 0
          ? `Error: ${signature}\n\nSuccessful fix:\n${successful[0].fix}`
          : `Error: ${signature}\n\nAttempted ${total} times without success`,
        tags: ['lint', 'fix-attempt', 'namespace:logs'],
        keywords: this.extractKeywordsFromSignature(signature),
        scope: {
          global: false,
          projectIds: [knowledgeStore.getProjectId()]
        },
        source: {
          method: 'tool_result',
          tool: 'fix-loop'
        },
        confidence: successful.length / total  // Success rate as confidence
      });
      persisted++;
    }
  }

  return persisted;
}

private extractKeywordsFromSignature(sig: string): string[] {
  // Extract meaningful terms from error signature
  const keywords: string[] = [];
  const matches = sig.match(/\b(unused|undriven|undeclared|width|type|signal|port|module)\b/gi);
  if (matches) {
    keywords.push(...matches.map(m => m.toLowerCase()));
  }
  return [...new Set(keywords)];
}
```

### D3. WatchManager → Memory Update (NEW)

**Location**: `src/watch/watcher.ts:261-294`

```typescript
// Add callback property
private onKnowledgeUpdate?: (filepath: string, result: FileUnderstanderResult) => Promise<void>;

// Add setter method
setKnowledgeUpdateCallback(
  callback: (filepath: string, result: FileUnderstanderResult) => Promise<void>
): void {
  this.onKnowledgeUpdate = callback;
}

// Modify runAction() for 'index' action:
case 'index':
  for (const [filepath, change] of files) {
    const result = await this.indexer.updateFile(filepath, change.type);

    // NEW: Trigger knowledge extraction for changed modules
    if (this.onKnowledgeUpdate && change.type !== 'unlink' && result) {
      await this.onKnowledgeUpdate(filepath, result);
    }
  }
  break;
```

### D4. Agent Context Injection (EXISTING - verify working)

**Location**: `src/agent/core.ts:417-442`

```typescript
// Already implemented correctly:
if (this.memoryService) {
  const contextInjection = this.memoryService.getContextForAI({
    query: userMessage
  });

  if (contextInjection.totalTokens > 0) {
    const contextBlock = this.memoryService.getContextString({
      query: userMessage
    });

    if (contextBlock.trim()) {
      systemPrompt = `${bundle.instructions}

<project_context>
${contextBlock}
</project_context>`;
    }
  }
}
```

---

## E) Integration Points (Dataflow)

### Write Path

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              WRITE PATH                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌─────────────────┐    ┌─────────────────────────┐     │
│  │ SVIndexer    │───▶│ ResolvedProject │───▶│ extractFromIndex()      │     │
│  │ indexProject │    │ (declarations,  │    │ [NEW - NOT IMPLEMENTED] │     │
│  │              │    │  dependencies,  │    └───────────┬─────────────┘     │
│  │ sv-indexer.ts│    │  hierarchy)     │                │                   │
│  │ :1-300       │    │ result.ts:220   │                ▼                   │
│  └──────────────┘    └─────────────────┘    ┌─────────────────────────┐     │
│                                             │ KnowledgeStore          │     │
│  ┌──────────────┐    ┌─────────────────┐    │ .addKnowledge()         │     │
│  │ FixLoop.run()│───▶│ attemptMemory   │───▶│ KnowledgeStore.ts:343   │◀────┤
│  │ fix-loop.ts  │    │ (Map in-memory) │    └───────────┬─────────────┘     │
│  │ :75-213      │    │ fix-loop.ts:50  │                │                   │
│  └──────────────┘    └─────────────────┘                │                   │
│         │                    │                          │                   │
│         │ [MISSING BRIDGE]   │                          ▼                   │
│         ▼                    ▼              ┌─────────────────────────┐     │
│  ┌──────────────┐    ┌─────────────────┐    │ ~/.gateflow/            │     │
│  │ WatchManager │───▶│ indexer.update  │    │  {projectId}-knowledge  │     │
│  │ watcher.ts   │    │ File()          │    │  .json                  │     │
│  │ :267-269     │    │ [NO MEMORY UPD] │    │                         │     │
│  └──────────────┘    └─────────────────┘    └─────────────────────────┘     │
│                                                         ▲                   │
│  ┌──────────────┐    ┌─────────────────┐                │                   │
│  │ User         │───▶│ learnFrom       │────────────────┘                   │
│  │ Correction   │    │ Correction()    │                                    │
│  │              │    │ KS.ts:813-848   │                                    │
│  └──────────────┘    └─────────────────┘                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Read Path

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              READ PATH                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌─────────────────┐    ┌─────────────────────────┐     │
│  │ GateFlowAgent│───▶│ MemoryService   │───▶│ KnowledgeStore.search() │     │
│  │ .run()       │    │ .getContextFor  │    │ BM25 + inverted index   │     │
│  │ core.ts:417  │    │ AI()            │    │ KS.ts:428-475           │     │
│  └──────────────┘    │ MS.ts:108-133   │    └───────────┬─────────────┘     │
│                      └─────────────────┘                │                   │
│                              │                          │                   │
│                              ▼                          ▼                   │
│                      ┌─────────────────┐    ┌─────────────────────────┐     │
│                      │ Token Budget    │    │ Scope Matching          │     │
│                      │ (40% mem, 60%   │    │ matchesScope()          │     │
│                      │  knowledge)     │    │ KS.ts:551-578           │     │
│                      │ MS.ts:110-111   │    └───────────┬─────────────┘     │
│                      └────────┬────────┘                │                   │
│                               │                         │                   │
│                               ▼                         ▼                   │
│                      ┌─────────────────────────────────────────────┐        │
│                      │           System Prompt Injection           │        │
│                      │           <project_context>...</>           │        │
│                      │           core.ts:429-434                   │        │
│                      └─────────────────────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Function-Level Dataflow

| Step | Function | File:Line | Input | Output |
|------|----------|-----------|-------|--------|
| 1 | `SVIndexer.indexProject()` | `sv-indexer.ts:50-150` | filelist path | `ResolvedProject` |
| 2 | `extractFromIndex()` | NEW | `ResolvedProject` | `KnowledgeItem[]` |
| 3 | `KnowledgeStore.addKnowledge()` | `KnowledgeStore.ts:343-383` | Item data | `KnowledgeItem` |
| 4 | `KnowledgeStore.save()` | `KnowledgeStore.ts:183-202` | dirty index | JSON file |
| 5 | `MemoryService.getContextForAI()` | `MemoryService.ts:108-133` | query | `ContextInjection` |
| 6 | `KnowledgeStore.search()` | `KnowledgeStore.ts:428-475` | `KnowledgeQuery` | `SearchResult[]` |
| 7 | `GateFlowAgent.run()` | `core.ts:285-667` | user message | response |

---

## F) Failure Modes

### F1. Content Update Without Index Rebuild

**Evidence**: `KnowledgeStore.ts:350-360`
```typescript
if (existing) {
  existing.content = item.content;  // Content changes
  existing.confidence = Math.max(existing.confidence, item.confidence);
  // ... BUT no call to removeFromIndices() + addToIndices()
  return existing;
}
```

**Consequence**: Inverted index contains stale terms. Search for new keywords fails; old keywords still match.

**Minimal Fix**:
```typescript
if (existing) {
  this.removeFromIndices(existing);  // ADD
  existing.content = item.content;
  existing.tags = [...new Set([...existing.tags, ...item.tags])];
  // ...
  this.addToIndices(existing);       // ADD
  return existing;
}
```

**Suggested Test**: Unit test that updates item content, then searches for new terms.

---

### F2. avgDocLength Not Updated on Remove

**Evidence**: `KnowledgeStore.ts:302-329` - `removeFromIndices()` deletes from indices but doesn't recalculate `avgDocLength`

**Consequence**: BM25 scoring uses stale average, causing slight relevance drift over time as items are pruned.

**Minimal Fix**:
```typescript
private removeFromIndices(item: KnowledgeItem): void {
  // ... existing code ...

  // Recalculate avgDocLength
  const n = this.index!.items.length;
  if (n > 0) {
    let totalLength = 0;
    for (const len of this.docLengths.values()) totalLength += len;
    this.avgDocLength = totalLength / n;
  } else {
    this.avgDocLength = 0;
  }
}
```

---

### F3. Scope Mismatch Hides Items

**Evidence**: `KnowledgeStore.ts:559-576`
```typescript
if (scope.modules?.length) {
  if (!query.moduleName || !scope.modules.includes(query.moduleName)) {
    return false;  // HIDDEN if no moduleName in query
  }
}
```

**Consequence**: Knowledge scoped to specific modules becomes invisible when agent queries without module context (e.g., general questions).

**Minimal Fix**: Add "relaxed scope" mode or apply penalty instead of exclusion:
```typescript
private matchesScope(scope: KnowledgeScope, query: KnowledgeQuery): boolean | number {
  if (scope.global) return true;

  if (scope.modules?.length) {
    if (!query.moduleName) {
      // Relaxed: still include but with penalty
      return 0.5;  // 50% score penalty
    }
    if (!scope.modules.includes(query.moduleName)) {
      return false;
    }
  }
  // ...
  return true;
}
```

---

### F4. File Watcher Doesn't Update Memory

**Evidence**: `watcher.ts:267-269` - calls `indexer.updateFile()` but no memory update

**Consequence**: When user edits a module, its `module_info` in knowledge store becomes stale. Agent gives outdated port lists.

**Minimal Fix**: Add memory update callback (see D3 above).

---

### F5. FixLoop Memory Lost on Restart

**Evidence**: `fix-loop.ts:50-51`
```typescript
private attemptMemory: Map<string, FixAttempt[]> = new Map();
private currentSession: FixAttempt[] = [];
// In-memory only, no persistence
```

**Consequence**: Thrashing detection resets between sessions. Same failed fix may be attempted repeatedly across restarts.

**Minimal Fix**: Add `persistAttemptMemory()` method (see D2 above).

---

### F6. Windows Lock Check Performance

**Evidence**: `KnowledgeStore.ts:1202-1208`
```typescript
if (process.platform === 'win32') {
  const { spawnSync } = await import('child_process');
  const result = spawnSync('tasklist', ['/FI', `PID eq ${lock.pid}`, '/NH'], {
    // ~200ms per call
  });
}
```

**Consequence**: Each lock staleness check takes 200ms on Windows. Multiple concurrent saves cause noticeable delays.

**Minimal Fix**: Cache result for 1 second:
```typescript
private lockCheckCache?: { time: number; result: boolean };

private async isLockStale(): Promise<boolean> {
  if (this.lockCheckCache && Date.now() - this.lockCheckCache.time < 1000) {
    return this.lockCheckCache.result;
  }
  // ... do check ...
  this.lockCheckCache = { time: Date.now(), result };
  return result;
}
```

---

### F7. Missing Compile-Context Separation

**Evidence**: KnowledgeStore has `scope.projectIds` but no `scope.compileContexts`

**Consequence**: When same file is used in multiple .f filelists with different defines, knowledge doesn't distinguish. Item extracted with `+define+FPGA` may be retrieved for ASIC context.

**Minimal Fix**: Add `compileContextId` to KnowledgeScope:
```typescript
interface KnowledgeScope {
  global: boolean;
  projectIds?: string[];
  compileContexts?: string[];  // NEW: e.g., ["filelist_fpga.f", "filelist_asic.f"]
  filePatterns?: string[];
  modules?: string[];
}
```

---

## G) Implementation Priority

| Priority | Item | Effort | Impact | File(s) | Status |
|----------|------|--------|--------|---------|--------|
| **P0** | Fix content update index rebuild bug | 1 hour | Correctness | `KnowledgeStore.ts:427-444` | ✅ **DONE** |
| **P0** | Create `extractFromIndex()` bridge | 4 hours | Enables structural memory | `extractors/indexer-extractor.ts` | ✅ **DONE** |
| **P1** | Integrate extraction into SVIndexer | 2 hours | Activates extraction | `sv-indexer-adapter.ts:185-186` | ✅ **DONE** |
| **P1** | Add WatchManager → memory callback | 2 hours | Keeps memory fresh | `watcher.ts:204-206, 314-336` | ✅ **DONE** |
| **P2** | Persist FixLoop attempt memory | 3 hours | Cross-session learning | `fix-loop.ts:237-251` | ✅ **DONE** (auto-persist) |
| **P2** | Add compile-context to scope | 3 hours | Multi-config support | `KnowledgeStore.ts` | ❌ Not started |
| **P3** | Fix avgDocLength on remove | 30 min | BM25 accuracy | `KnowledgeStore.ts:393-404` | ✅ **DONE** |
| **P3** | Cache Windows lock check | 30 min | Performance | `KnowledgeStore.ts:1196-1216` | ❌ Not started |
| **P3** | Relax scope matching | 2 hours | Better retrieval | `KnowledgeStore.ts:661-724` | ✅ **DONE** |
| **P3** | Integrate TieredKnowledgeStore | 2 hours | Memory optimization | `MemoryService.ts:67-91` | ✅ **DONE**

---

## Summary: What's Built vs. What's Missing

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| BM25 search engine | ✅ Complete | `KnowledgeStore.ts:428-508` | Production-ready |
| Inverted index | ✅ Complete | `KnowledgeStore.ts:134-140, 225-337` | O(k) candidate selection |
| Tiered storage | ✅ Complete | `tiered-store.ts` + `MemoryService.ts:67-91` | **Wired via config** |
| Token budgeting | ✅ Complete | `MemoryService.ts:108-133` | HDL-aware |
| Lint extraction | ✅ Complete | `KnowledgeStore.ts:666-759` | Called from FixLoop |
| Codegen extraction | ⚠️ Partial | `KnowledgeStore.ts:769-803` | Pattern detection basic |
| User correction learning | ✅ Complete | `KnowledgeStore.ts:813-848` | High confidence (0.95) |
| **Indexer extraction** | ✅ Complete | `extractors/indexer-extractor.ts` | Called via SVIndexerAdapter |
| **FixLoop persistence** | ✅ Complete | `fix-loop.ts:237-251` | Auto-persist on run() |
| **File watch → memory** | ✅ Complete | `watcher.ts:204-206, 314-336` | Callback mechanism |
| Compile-context scoping | ❌ None | - | Multi-config confusion |

---

*Document generated: 2026-01-13*
*Last updated: 2026-01-13 (updated Implementation Priority table and Summary with completed items)*
*For agents: This document describes the memory system design for GateFlow CLI. Most P0-P2 items are now complete.*
