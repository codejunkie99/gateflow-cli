# GateFlow CLI

AI-powered CLI assistant for SystemVerilog development combining LLM-driven code generation with robust HDL tooling.

## Rules for AI Assistants

**IMPORTANT**: When working on this codebase, AI models MUST:

1. **Consult [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) before making changes** - It contains comprehensive architecture documentation, module dependencies, and gotchas that prevent common mistakes.

2. **Check the relevant module section** in CODEBASE_MAP.md before modifying any file to understand:
   - File purpose and responsibilities
   - Dependencies and dependents
   - Design patterns used
   - Known gotchas and non-obvious behavior

3. **Review the Navigation Guide** section when adding new features to know which files need to be touched.

4. **Check the Gotchas section** before implementing to avoid known pitfalls (e.g., Planning Agent is NOT a worker, structural knowledge requires live indexer).

5. **Update CODEBASE_MAP.md** when making significant architectural changes or adding new modules.

## Codebase Overview

GateFlow is a TypeScript CLI tool that uses Anthropic's Claude API with Vercel AI SDK 6 to provide intelligent SystemVerilog assistance. It features a two-parser indexer (Slang + Verible), memory/knowledge persistence, and comprehensive tool support for linting, simulation, and waveform viewing.

**Stack**: TypeScript, Vercel AI SDK 6, Vitest, Commander.js, blessed (TUI)

**Structure**:
- `src/agent/` - AI agent system (orchestrator, workers, 40+ tools)
- `src/indexer/` - SystemVerilog indexer (Slang + Verible backends)
- `src/memory/` - Knowledge store + conversation persistence
- `src/context/` - Dynamic context discovery (Cursor patterns)
- `src/verification/` - Verilator integration + auto-fix loops
- `src/waveform/` - VCD viewer (terminal, web, MCP)

**For detailed architecture and module documentation, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).** This file includes:
- Complete system overview with architecture diagrams
- Detailed module guide with file purposes and dependencies
- Data flow diagrams and navigation guides
- Comprehensive gotchas and migration notes

## Quick Start

```bash
npm install
npm run build
./dist/index.js chat "explain counter.sv"
```

## Key Commands

- `chat [query...]` - Interactive REPL or single query
- `scan` - Build project index from .f file
- `lint [files...]` - Run Verilator lint
- `fix <file>` - AI-powered lint auto-fix
- `watch` - Watch for changes, auto-lint
- `gen <type> <name>` - Generate module/testbench/package
- `wave <vcd-file>` - Open waveform viewer

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for AI features
- `VERILATOR_PATH` - Optional (uses PATH if not set)
- `SLANG_PATH`, `VERIBLE_PATH` - Auto-downloaded if missing

## Architecture Highlights

### Two-Parser Indexer
- **Slang (Layer B)**: Full SV 2017 semantic analysis
- **Verible (Layer A)**: Fast CST parsing, preprocessor directives
- Results merged for accurate resolution + directive tracking
- See [CODEBASE_MAP.md § Indexer](docs/CODEBASE_MAP.md#systemverilog-indexer-srcindexer) for full module details

### Memory System (Option C Architecture)
- **KnowledgeService**: Unified queries combining structural + learned knowledge
- **StructuralProvider**: Queries live indexer for modules/ports/hierarchy (not persisted)
- **KnowledgeStore**: Learned patterns only (lint_fix, code_pattern, style_preference)
- **Context-aware scoping**: defineContextId prevents mixing build contexts
- **AsyncMutex with timeout**: Prevents deadlocks in concurrent operations
- See [CODEBASE_MAP.md § Memory System](docs/CODEBASE_MAP.md#memory-system-srcmemory---updated) for architecture details

### Agent System
- **GateFlowAgent**: Main agent with tool approval workflow
- **Orchestrator**: Multi-agent coordination for complex tasks (v3 with resilience layer)
- **5 Worker Agents**: Understanding, CodeGen, Testbench, Debug, Refactoring
- See [CODEBASE_MAP.md § Agent System](docs/CODEBASE_MAP.md#agent-system-srcagent) for orchestration details

## Testing

```bash
npm test                    # Run all tests
npm test -- sv-indexer      # Run indexer tests only
npm test -- memory          # Run memory tests only
```

Test fixtures in `src/__tests__/fixtures/sv/` cover all SV language features.

## Common Gotchas

1. **Planning Agent**: 'planning' is NOT a worker - handled by Orchestrator
2. **Windows API Key**: Set ANTHROPIC_API_KEY before creating client
3. **Verible Required**: Indexer fails without Verible installed
4. **Auto-Approve**: .sv files auto-approved for write operations
5. **Structural Knowledge Not Persisted**: Must have live indexer for module queries
6. **indexer-extractor.ts is No-Op**: Returns empty counts (kept for API compat)
7. **File Lock Timeout**: Effective = configured + 3s (Windows tasklist buffer)

**For comprehensive gotchas, recent changes, and migration notes, see [CODEBASE_MAP.md § Gotchas](docs/CODEBASE_MAP.md#gotchas).**

## Documentation Hierarchy

This file (CLAUDE.md) provides **quick reference** guidance. For **comprehensive documentation**, refer to:

| Need | Document | Purpose |
|------|----------|---------|
| Quick start, key ideas | **CLAUDE.md** (this file) | High-level overview for onboarding |
| Architecture diagrams, module details | **[docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md)** | Deep dives into every module |
| Specific file purposes, dependencies | CODEBASE_MAP.md § Module Guide | Find what each file does |
| Data flows, sequences | CODEBASE_MAP.md § Data Flow | Understand request lifecycles |
| Navigation guides | CODEBASE_MAP.md § Navigation Guide | "How do I add X?" |
| Migration & gotchas | CODEBASE_MAP.md § Gotchas | Non-obvious behavior, breaking changes |
