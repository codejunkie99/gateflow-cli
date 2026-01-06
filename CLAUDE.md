# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GateFlow CLI is an AI-powered SystemVerilog development assistant. It provides natural-language interaction for code understanding, generation, linting, and automated fix loops using Verilator.

**Important**: The `cli/` folder contains only build output (`dist/`) and dependencies (`node_modules/`). All source code is in the parent directory under `src/`.

## Build & Development Commands

```bash
# From repo root (cursor-for-vhdl/)
npm run build          # Compile TypeScript to cli/dist/
npm run dev            # Run in dev mode with tsx
npm run lint           # Type-check without emitting
npm test               # Run tests with Vitest
npm run test:unit      # Run tests once (no watch)

# Run the CLI directly
node cli/dist/index.js doctor
node cli/dist/index.js chat "list all modules"

# Link for global usage (from repo root)
npm link
gateflow doctor
```

## Environment Setup

Required:
- `ANTHROPIC_API_KEY` - Required for AI features

Optional:
- `VERILATOR_PATH` - Path to Verilator binary (defaults to `verilator` in PATH)
- On Windows with WSL: `VERILATOR_PATH=/usr/bin/verilator`

Environment is loaded from `.env` in multiple locations (repo root, parent dirs).

## Architecture

### Entry Flow
```
src/index.ts → src/cli/main.ts → src/cli/commands.ts
```

### Multi-Agent System

The core is `GateFlowAgent` (`src/agent/core.ts`) which uses an `Orchestrator` for complex requests:

| Agent | Purpose |
|-------|---------|
| `understanding` | Code analysis, dependency tracing |
| `codegen` | New SystemVerilog generation |
| `testbench` | Verification code generation |
| `debug` | Failure diagnosis |
| `refactoring` | Code modification |

Simple requests go directly to `streamText()`. Complex requests trigger the Orchestrator which creates an `ExecutionPlan` and coordinates worker agents.

### Key Directories

```
src/
├── agent/              # AI agent system
│   ├── orchestrator/   # Multi-agent coordination
│   ├── workers/        # Specialized agents (agentFactory.ts)
│   ├── prompts/        # PromptBuilder & presets
│   ├── reasoning/      # ThinkingChain visibility
│   ├── core.ts         # GateFlowAgent main class
│   └── tools.ts        # Tool definitions
├── approval/           # Policy engine & approval flow
├── cli/                # CLI commands & entry point
├── events/             # EventBus pub/sub system
├── fileops/            # File operations (read/write/edit)
├── indexer/            # SystemVerilog project indexing
├── verification/       # Verilator integration & fix-loop
├── ui/                 # Terminal renderer
└── types/              # Shared TypeScript types & Zod schemas
```

### Event System

All UI output goes through `EventBus` (`src/events/bus.ts`). Key event types:
- `token`, `token_done` - Streaming output
- `tool_call`, `tool_result` - Tool execution
- `diff_preview`, `approval_request` - User approval flow
- `agent_start`, `agent_complete` - Multi-agent lifecycle

### Tool System

Tools defined in `src/agent/tools.ts` using Vercel AI SDK's `tool()`:
- `read_file`, `write_file`, `edit_lines`, `search_replace`
- `list_files`, `search_code`, `find_all_sv_files`
- `find_module`, `get_dependencies`
- `lint_file`, `run_simulation`

### Approval Flow

Write operations require user approval unless `--yes` flag:
1. `PolicyEngine` checks tool permissions
2. `DiffPreviewEvent` shows proposed changes
3. User responds: `Y` (once), `A` (all), `N` (reject), `S` (skip)

## CLI Commands

- `gateflow chat [query...]` - Interactive REPL or single query
- `gateflow scan` - Index project
- `gateflow lint [files...]` - Run Verilator lint
- `gateflow fix <file>` - Iterative lint-fix loop
- `gateflow watch [patterns...]` - Watch files for changes
- `gateflow gen <module|testbench|package> <name>` - Generate code
- `gateflow doctor` - Environment check

Global flags: `-y` (auto-approve), `-n` (dry-run), `--json`, `-v` (verbose)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Lint failed |
| 2 | User rejected change |
| 3 | Tool error |
| 4 | Config error |
| 5 | Network error |
| 6 | Timeout |

## Adding New Components

### New Tool
1. Add schema in `src/agent/tools.ts`
2. Add executor in `createToolExecutors()`
3. Add policy rules in `src/approval/types.ts`

### New Worker Agent
1. Create `src/agent/workers/MyAgent.ts`
2. Register in `src/agent/core.ts` `initializeOrchestrator()`
3. Add to `AgentRoutingSchema` enum in `src/types/agent-shared.ts`

### New Event Type
1. Define in `src/events/types.ts`
2. Add to `UiEvent` union
3. Handle in `src/ui/renderer.ts`

## Configuration

Project config via `.gaterc.json`:
```json
{
  "ux": { "showThinking": true, "streamTokens": true },
  "llm": { "model": "claude-sonnet-4-20250514", "maxTokens": 8192 }
}
```

## Tech Stack

- TypeScript (ES2022, NodeNext modules)
- Vercel AI SDK 6 (`ai`, `@ai-sdk/anthropic`)
- Commander (CLI parsing)
- Zod (schema validation)
- Vitest (testing)
- Chalk (terminal colors)
