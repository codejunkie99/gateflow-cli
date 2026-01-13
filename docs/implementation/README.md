# Memory System Implementation Guide

> **Purpose**: Detailed implementation guide for bridging the Indexer→Memory gap and fixing KnowledgeStore bugs.
>
> **Based on**: `KNOWLEDGE_STORE_ARCHITECTURE.md`, `MEMORY_SYSTEM_DESIGN.md`

---

## Quick Start

1. Start with **Phase 1** bug fixes (critical for correctness)
2. Implement **Phase 2** for the main indexer→memory bridge
3. Add **Phase 3-5** incrementally for full integration

---

## Module Index

### Phase 1: Bug Fixes (Critical - Do First)

| Module | File | Description | Effort |
|--------|------|-------------|--------|
| [1.1](./phase-1/1.1-content-update-bug.md) | `KnowledgeStore.ts:350-360` | Fix indices not rebuilt on content update | 30 min |
| [1.2](./phase-1/1.2-avgdoclength-bug.md) | `KnowledgeStore.ts:302-329` | Fix avgDocLength not updated on remove | 20 min |
| [1.3](./phase-1/1.3-corruption-handling.md) | `KnowledgeStore.ts:165-181` | Fix silent data corruption handling | 25 min |
| [1.4](./phase-1/1.4-windows-lock-cache.md) | `KnowledgeStore.ts:1196-1216` | Cache Windows lock check result | 20 min |

**Total Phase 1**: ~2 hours

---

### Phase 2: Indexer→Memory Bridge (Highest Impact)

| Module | File | Description | Effort |
|--------|------|-------------|--------|
| [2.1](./phase-2/2.1-extractor-types.md) | NEW: `extractors/types.ts` | Type definitions for extraction | 10 min |
| [2.2](./phase-2/2.2-module-extractor.md) | NEW: `extractors/module-extractor.ts` | Extract module/interface/package info | 45 min |
| [2.3](./phase-2/2.3-dependency-extractor.md) | NEW: `extractors/dependency-extractor.ts` | Extract file dependencies | 30 min |
| [2.4](./phase-2/2.4-hierarchy-extractor.md) | NEW: `extractors/hierarchy-extractor.ts` | Extract hierarchy nodes | 30 min |
| [2.5](./phase-2/2.5-main-orchestrator.md) | NEW: `extractors/indexer-extractor.ts` | Main extraction orchestrator | 25 min |
| [2.6](./phase-2/2.6-index-file.md) | NEW: `extractors/index.ts` | Barrel export file | 5 min |
| [2.7](./phase-2/2.7-integration.md) | `sv-indexer-adapter.ts` | Integrate extraction call | 30 min |

**Total Phase 2**: ~3 hours

---

### Phase 3: WatchManager Integration

| Module | File | Description | Effort |
|--------|------|-------------|--------|
| [3.1](./phase-3/3.1-knowledge-callback.md) | `watcher.ts` | Add knowledge update callback | 30 min |
| [3.2](./phase-3/3.2-watch-command-wiring.md) | `commands.ts` | Wire up in watch command | 20 min |

**Total Phase 3**: ~1 hour

---

### Phase 4: FixLoop Memory Persistence

| Module | File | Description | Effort |
|--------|------|-------------|--------|
| [4.1](./phase-4/4.1-persistence-methods.md) | `fix-loop.ts` | Add persistence methods | 40 min |
| [4.2](./phase-4/4.2-command-integration.md) | `commands.ts` | Wire up in fix command | 15 min |

**Total Phase 4**: ~1 hour

---

### Phase 5: Scope Matching Improvements

| Module | File | Description | Effort |
|--------|------|-------------|--------|
| [5.1](./phase-5/5.1-relaxed-scope.md) | `KnowledgeStore.ts` | Relaxed scope matching mode | 45 min |

**Total Phase 5**: ~45 min

---

## Total Implementation Effort

| Phase | Hours | Priority |
|-------|-------|----------|
| Phase 1: Bug Fixes | 2 | P0 - Critical |
| Phase 2: Indexer Bridge | 3 | P0 - Critical |
| Phase 3: WatchManager | 1 | P1 - Important |
| Phase 4: FixLoop | 1 | P1 - Important |
| Phase 5: Scope | 0.75 | P2 - Nice to have |
| **Total** | **~8 hours** | |

---

## File Structure After Implementation

```
src/memory/
├── extractors/              ← NEW DIRECTORY
│   ├── index.ts            ← Module 2.6
│   ├── types.ts            ← Module 2.1
│   ├── module-extractor.ts ← Module 2.2
│   ├── dependency-extractor.ts ← Module 2.3
│   ├── hierarchy-extractor.ts  ← Module 2.4
│   └── indexer-extractor.ts    ← Module 2.5
├── KnowledgeStore.ts       ← Modules 1.1-1.4, 5.1
├── MemoryService.ts
├── manager.ts
├── tiered-store.ts
├── token-estimator.ts
└── utils.ts

src/indexer/
├── sv-indexer-adapter.ts   ← Module 2.7
└── ...

src/verification/
├── fix-loop.ts             ← Modules 4.1
└── ...

src/watch/
├── watcher.ts              ← Module 3.1
└── ...

src/cli/
├── commands.ts             ← Modules 3.2, 4.2
└── ...
```

---

## Dependency Graph

```
Phase 1 (Bug Fixes)
├── Module 1.1 ──┐
├── Module 1.2 ──┼── No dependencies, do in any order
├── Module 1.3 ──┤
└── Module 1.4 ──┘

Phase 2 (Indexer Bridge)
├── Module 2.1 (types)
│   └── Module 2.2 (module-extractor)
│   └── Module 2.3 (dependency-extractor)
│   └── Module 2.4 (hierarchy-extractor)
│       └── Module 2.5 (orchestrator)
│           └── Module 2.6 (index)
│               └── Module 2.7 (integration)

Phase 3 (WatchManager)
├── Module 3.1 (callback)
│   └── Module 3.2 (wiring) ── Depends on Phase 2

Phase 4 (FixLoop)
├── Module 4.1 (persistence)
│   └── Module 4.2 (wiring) ── Depends on Phase 1 (for store correctness)

Phase 5 (Scope)
└── Module 5.1 ── Can be done anytime after Phase 1
```

---

## Verification Checklist (End-to-End)

### After Phase 1 (Bug Fixes)
- [ ] Unit tests pass for content update
- [ ] Unit tests pass for avgDocLength
- [ ] Unit tests pass for corruption handling
- [ ] Windows lock performance improved (manual test)

### After Phase 2 (Indexer Bridge)
- [ ] `gateflow index project.f` extracts knowledge
- [ ] Knowledge file contains `module_info` items
- [ ] Knowledge file contains `dependency` items
- [ ] `tool_result` event emitted for extraction

### After Phase 3 (WatchManager)
- [ ] `gateflow watch src/` updates knowledge on file change
- [ ] Status event shows "Updating knowledge for..."

### After Phase 4 (FixLoop)
- [ ] `gateflow fix file.sv` persists fix patterns
- [ ] Knowledge file contains `lint_fix` items
- [ ] Second fix run shows "Loaded N historical patterns"

### After Phase 5 (Scope)
- [ ] Search with `relaxedScope: true` includes more items
- [ ] Penalized items have lower scores
- [ ] Match reason shows "Scope penalty"

---

## Common Issues and Solutions

### Issue: "Cannot find module '../memory/extractors/index.js'"

**Cause**: TypeScript not compiled after adding new files.

**Solution**:
```bash
npm run build
```

### Issue: Knowledge file not created

**Cause**: KnowledgeStore not initialized or project root incorrect.

**Solution**: Check that MemoryService is created and `load()` called:
```typescript
const store = createKnowledgeStore(projectRoot, bus);
await store.load();
setGlobalKnowledgeStore(store);
```

### Issue: Extraction not running

**Cause**: `getKnowledgeStore()` returns null.

**Solution**: Ensure `setGlobalKnowledgeStore()` called during initialization.

### Issue: Windows tasklist still slow

**Cause**: Lock cache not working properly.

**Solution**: Verify `lockCheckCache` field added and cache duration is 1 second.

---

## Quick Reference: Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `extractFromIndex()` | `extractors/indexer-extractor.ts` | Main extraction entry point |
| `createExtractionOptions()` | `extractors/indexer-extractor.ts` | Create options with defaults |
| `formatExtractionSummary()` | `extractors/indexer-extractor.ts` | Human-readable result |
| `getKnowledgeStore()` | `KnowledgeStore.ts` | Get global store instance |
| `setGlobalKnowledgeStore()` | `KnowledgeStore.ts` | Set global store instance |
| `persistAttemptMemory()` | `fix-loop.ts` | Persist fix patterns |
| `setKnowledgeUpdateCallback()` | `watcher.ts` | Register update callback |

---

*Last updated: 2026-01-13*
