## GateFlow CLI Architecture (v1)

This document explains how the GateFlow CLI is structured so you can extend it safely.

## High-level flow

1. `src/cli/main.ts` parses CLI args (Commander), loads `.env`, and dispatches to a command.
2. `src/cli/commands.ts` builds a `CommandContext`:
   - detects `projectRoot`
   - creates a single `EventBus`
   - starts a renderer (unless `--json`)
   - creates `PolicyEngine`, tools, indexer, diff engine, Verilator wrapper
3. `GateFlowAgent` (Vercel AI SDK) runs a tool-calling loop:
   - streams tokens
   - calls tools through strongly-typed executors
   - emits all UX output via the event bus
4. For `fix`, a `FixLoop` orchestrates:
   - lint → propose edits → approval → re-lint
   - stops on success, attempt limits, or thrashing detection

## Modules

### Events: `src/events/*`

- **`UiEvent`**: the single renderer contract (typed union).
- **`EventBus`**: simple pub/sub for events.
- **Exit codes** live here as `ExitCodes` so commands can be scripted reliably.

Design intent: core logic should not print directly; it should emit events.

### UI Renderer: `src/ui/renderer.ts`

- Responsible for:
  - rendering status/spinners
  - showing tool calls/results
  - diff previews
  - approval prompts and input handling
- Approval input currently supports:
  - `y/yes` (approve once)
  - `a/all` (approve for session)
  - `n/no` (reject)
  - `s/skip` (reject/skip)

If you add new UI features, prefer adding a new `UiEvent` variant rather than printing from the core.

### Policy: `src/policy/*`

`PolicyEngine` enforces “hard contracts”:

- **path safety** (project root by default; blocks dangerous paths)
- **glob approval** (optional)
- **tool approvals** (read-only vs. write operations)

Tools call `policy.checkTool(...)` before performing sensitive operations.

### Tools: `src/tools/*`

These are the “capability surface” the agent can use:

- `FileTools`:
  - read/write files
  - scan project (SV-focused globbing)
  - search code
  - safe path resolution relative to `projectRoot`
- `EditTools`:
  - line edits (`edit_lines`)
  - search/replace
  - diff generation for preview

If you add a new tool:

- add implementation in `src/tools/`
- add schema + executor in `src/agent/tools.ts`
- add policy entry in `src/policy/types.ts` / overrides as needed
- emit `tool_call`, `tool_result`, and optionally `diff_preview` / `approval_request`

### Agent: `src/agent/*`

- Uses **Vercel AI SDK** (`ai`) with the **Anthropic provider** (`@ai-sdk/anthropic`).
- Runs a multi-step tool calling loop (`streamText` with `maxSteps`).
- Maintains an in-memory session (no raw file content persistence by default).

The system prompt is SV-oriented and encourages:

- file discovery via `find_all_sv_files`
- targeted edits over full rewrites
- lint after edits

### Project Index: `src/context/*`

`ProjectIndexer` builds a pragmatic regex-based index for v1:

- modules
- packages
- interfaces
- basic imports/includes (best-effort)

It’s designed to be “good enough” for navigation and prompting, not a full compiler.

### Diff/Patch: `src/diff/*`

Used to:

- generate unified diffs for previews
- apply patches safely (and optionally via git when available)

### Verification: `src/verification/*`

- `Verilator`:
  - lint
  - optional WSL execution on Windows when `VERILATOR_PATH` looks like a Unix path
  - parses errors and maps WSL paths back to Windows paths
- `FixLoop`:
  - lint/fix retry strategy
  - attempt memory + thrashing detection

### Watch mode: `src/watch/*`

`WatchManager` uses `chokidar` to watch patterns and re-run lint/index updates.

## Where to add features safely

- **New SV-aware operation** (format, include graph, module rename):
  - implement in `src/tools/`
  - register in `src/agent/tools.ts`
  - update policy rules
  - add renderer events if the UX needs it

- **More accurate parsing**:
  - extend `src/context/parser.ts`
  - keep it fast and tolerant; v1 is intentionally regex-based

- **Non-interactive automation**:
  - extend JSON outputs for commands
  - preserve exit code semantics


