# GateFlow CLI

AI-powered CLI assistant for SystemVerilog development combining LLM-driven code generation with robust HDL tooling.

## Quick Reference

**Stack**: TypeScript, Vercel AI SDK 6, Vitest, Commander.js, blessed (TUI)

```bash
npm install && npm run build
./dist/index.js chat "explain counter.sv"
```

## Project Structure

```
src/
├── agent/           # AI agent system
│   ├── core.ts          # GateFlowAgent - main agent with tool approval
│   ├── orchestrator/    # Multi-agent coordination (v3 resilience layer)
│   ├── workflows/       # Workflow patterns (chain, parallel, evaluator)
│   ├── loop-control.ts  # prepareStep implementations
│   ├── stop-conditions.ts # Custom stop conditions
│   ├── ui-agents.ts     # UI mode transitions (chat/planning/execution/review)
│   └── tools.ts         # 40+ tools for SV development
├── indexer/         # Two-parser SV indexer (Slang + Verible)
├── memory/          # Knowledge store + conversation persistence
├── context/         # Dynamic context discovery
├── verification/    # Verilator integration + auto-fix loops
├── waveform/        # VCD viewer (terminal, web, MCP)
└── cli/             # CLI commands and REPL
```

## Key Commands

| Command | Description |
|---------|-------------|
| `chat [query...]` | Interactive REPL or single query |
| `scan` | Build project index |
| `lint [files...]` | Run Verilator lint |
| `fix <file>` | AI-powered lint auto-fix |
| `watch` | Watch for changes, auto-lint |
| `gen <type> <name>` | Generate module/testbench/package |
| `wave <vcd-file>` | Open waveform viewer |

**REPL Commands**: `/clear`, `/stats`, `/mode [planning|execution|review|chat]`

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for AI features
- `VERILATOR_PATH` - Optional (uses PATH if not set)
- `SLANG_PATH`, `VERIBLE_PATH` - Auto-downloaded if missing

## Architecture

### Agent System
- **GateFlowAgent** (`core.ts`): Main agent with streaming, tool approval, prepareStep
- **Orchestrator**: Coordinates 5 worker agents (Understanding, CodeGen, Testbench, Debug, Refactoring)
- **Workflows**: Chain, Parallel, Evaluator-Optimizer patterns in `workflows/`
- **UI Agents**: Mode-based transitions (chat, planning, execution, review)
  - Note: UI agents don't support `dynamicModelSelector` (no `complexModel` config)

### Two-Parser Indexer
- **Slang**: Full SV 2017 semantic analysis
- **Verible**: Fast CST parsing, preprocessor directives
- Results merged for accurate symbol resolution

### Memory System
- **KnowledgeService**: Combines structural (live indexer) + learned knowledge
- **KnowledgeStore**: Persists lint_fix, code_pattern, style_preference
- **Context scoping**: defineContextId prevents mixing build contexts

## Common Gotchas

1. **Planning Agent**: 'planning' is NOT a worker - handled by Orchestrator
2. **Windows API Key**: Set ANTHROPIC_API_KEY before creating Anthropic client
3. **Verible Required**: Indexer needs Verible installed (run `setup` command)
4. **Auto-Approve**: .sv files auto-approved for write operations
5. **Structural Knowledge**: Requires live indexer (not persisted)
6. **prepareStep types**: Use `as any` cast for AI SDK compatibility

## Testing

```bash
npm test                    # Run all tests
npm test -- sv-indexer      # Indexer tests
npm test -- memory          # Memory tests
npm test -- workflows       # Workflow tests
```

## Adding New Features

### New Tool
1. Add schema in `src/agent/tools.ts`
2. Add executor in same file
3. Add to `TOOL_APPROVAL_CONFIG`
4. Add to tool specs export

### New Workflow
1. Create pattern in `src/agent/workflows/patterns.ts`
2. Add GateFlow-specific version in `gateflow-workflows.ts`
3. Register in `workflow-router.ts`

### New Stop Condition
1. Add to `src/agent/stop-conditions.ts`
2. Export from `src/agent/index.ts`
