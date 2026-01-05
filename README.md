## GateFlow CLI

GateFlow is a **natural-language CLI assistant for SystemVerilog**. You can ask it to read/understand a codebase, edit `.sv` files with an approval gate, and run **Verilator lint** (including an iterative “lint → fix → re-lint” loop).

This repo also contains an Electron IDE; this README is **only for the CLI**.

## What it does in v1

- **Codebase understanding**: scans and indexes SystemVerilog projects (regex-based index for v1).
- **Code writing**: generate new modules/testbenches/packages.
- **Code editing**: line edits and search/replace with diff preview + approval policy.
- **Verification**: Verilator lint; “fix loop” can apply edits and re-run lint until clean (or until it detects thrashing).
- **TUI/UX**: streaming output, blue “GateFlow” branding, no emojis, approval prompts.

Deferred (intentionally): waveform visualization and full LSP-grade semantic understanding.

## Install & run (from source)

From the repo root:

```bash
cd cli
npm install
npm run build
```

Run via Node:

```bash
node dist/index.js doctor
node dist/index.js "lint src/src/counter.sv"
```

Optional: install as a shell command (local dev):

```bash
cd cli
npm link
gateflow doctor
```

## Configuration

### Required environment variables

- **`ANTHROPIC_API_KEY`**: required for AI features (chat/fix/generate).

GateFlow loads `.env` from multiple locations so you can keep the key at the repo root. Typical setup:

```env
ANTHROPIC_API_KEY=your_key_here
```

### Verilator configuration

GateFlow uses Verilator for linting. It will try:

- **`VERILATOR_PATH`** if set
- otherwise **`verilator`** from your PATH

#### Windows + WSL (recommended)

If Verilator is installed in WSL (example path `/usr/bin/verilator`), set this in PowerShell before running:

```powershell
$env:VERILATOR_PATH="/usr/bin/verilator"
node dist/index.js doctor
```

GateFlow detects Unix-style paths on Windows and runs Verilator via `wsl ...`.

## CLI usage

GateFlow is “chat-first”: the default command is `chat`, so you can run:

```bash
gateflow "list all modules"
```

or start an interactive session:

```bash
gateflow chat
```

### Global flags

- **`-y, --yes`**: auto-approve all changes (non-interactive fixes/edits)
- **`-n, --dry-run`**: show diffs but do not apply changes
- **`--json`**: machine-readable output (where supported)
- **`-v, --verbose`**: more logs/events
- **`-C, --cwd <path>`**: set working directory (used for project root detection)

## Commands

### `gateflow chat [query...]`

Interactive REPL (or run a single query).

Inside the REPL:

- **`exit` / `quit`**: leave
- **`/clear`**: clear session history
- **`/stats`**: show session + index stats

### `gateflow scan`

Scan and index the project (SystemVerilog-focused). In `--json` mode, prints the exported index.

### `gateflow lint [files...]`

Run Verilator lint.

- If you pass files, it lints those.
- If you pass none, it scans the project and lints discovered “module/testbench” files.

Example:

```bash
gateflow lint src/src/counter.sv
gateflow lint
```

### `gateflow fix <file>`

Run an iterative lint-fix loop on a single file:

- lint file
- ask the model to propose edits
- show a diff preview
- require approval unless `--yes`
- re-lint and repeat up to a limit
- detects “thrashing” and stops if the same errors keep reappearing

Example:

```bash
gateflow fix src/src/counter.sv
gateflow --yes fix src/src/counter.sv
gateflow --dry-run fix src/src/counter.sv
```

### `gateflow watch [patterns...]`

Watch files and re-run lint on changes (Ctrl+C to stop). If you pass patterns, they’re used; otherwise it uses its defaults.

### `gateflow gen <type> <name>`

Generate new SystemVerilog code using natural language prompts:

- `module`
- `testbench`
- `package`

Examples:

```bash
gateflow gen module uart_rx
gateflow gen testbench counter
gateflow gen package common
```

### `gateflow doctor`

Print environment checks:

- Verilator installed (and path/version)
- `ANTHROPIC_API_KEY` present
- project root exists
- SystemVerilog file count
- git repo present (for patch application when enabled)

### `gateflow version`

Print CLI version.

## File scanning rules (important)

GateFlow focuses on SystemVerilog sources and ignores dependency/build outputs.

- **Included extensions**: `.sv`, `.svh`, `.v`, `.vh`
- **Excluded directories by default**: `node_modules/`, `dist/`, `dist-electron/`, `obj_dir/`, `.git/`, `target/`

Paths you provide are treated as **relative to the detected project root**, unless you pass an absolute path.

## Safety, diffs, approvals

GateFlow tries hard to be safe by default:

- Most write operations show a **unified diff preview**.
- If approval is required, the CLI will prompt:
  - **`Y`**: approve once
  - **`A`**: approve all (for this session)
  - **`N`**: reject
  - **`S`**: skip
- Use **`--yes`** for non-interactive runs (CI / scripts).
- Use **`--dry-run`** to see the proposed patch without applying it.

## JSON output (automation)

Use `--json` for scripting.

- **`scan --json`**: prints the project index export
- **`lint --json`**: prints an array like:
  - `{ file, errors, warnings }`
- **`fix --json`**: prints a `FixLoopResult` containing:
  - `success`, `initialErrors`, `finalErrors`, `attemptCount`, `fixedCount`, `thrashingDetected`, `duration`

## Exit codes

GateFlow uses stable exit codes for automation:

- **0**: success
- **1**: lint failed
- **2**: user rejected a proposed change
- **3**: tool error (I/O, patch apply, etc.)
- **4**: config error (missing API key, missing Verilator, etc.)
- **5**: network error
- **6**: timeout
- **7**: watch error

## Troubleshooting

### “ANTHROPIC_API_KEY not set”

- Put `ANTHROPIC_API_KEY=...` in a `.env` file at the repo root, or export it in your shell.
- Run `gateflow doctor` to confirm it’s being picked up.

### “Verilator not found”

- Ensure `verilator` is in PATH, or set `VERILATOR_PATH`.
- On Windows with WSL Verilator:
  - `VERILATOR_PATH=/usr/bin/verilator`

### “It’s scanning node_modules / dist”

- File scanning uses `glob` with built-in ignore patterns. If you see a case it misses, open an issue with the exact directory layout and command you ran.

### “The prompt hangs / approval input doesn’t work”

- If you’re in `chat` mode and it’s waiting for approval, type `y`, `n`, `a`, or `s` and press Enter.
- For non-interactive runs, add `--yes`.

## Development

Build:

```bash
cd cli
npm run build
```

Run in dev (TypeScript):

```bash
cd cli
npm run dev
```

## Multi-Agent Architecture

GateFlow uses a sophisticated multi-agent system that automatically coordinates specialized agents for complex tasks.

### Specialized Agents

| Agent | Role | Use Cases |
|-------|------|-----------|
| **Understanding** | Reads and analyzes code | "What does this module do?", dependency tracing |
| **CodeGen** | Creates new SystemVerilog | "Create a UART module", spec-to-RTL |
| **Testbench** | Generates verification code | "Write a testbench for counter", stimulus generation |
| **Debug** | Diagnoses failures | "Why does simulation hang?", root cause analysis |
| **Refactoring** | Modifies existing code | "Rename signal", "Add parameter" |

### Orchestrator

The Orchestrator automatically routes requests:

1. **Complexity Detection** - Analyzes if request needs multiple agents
2. **Intelligent Routing** - Uses AI to select the best agent for simple tasks
3. **Plan Generation** - Creates execution plans for complex multi-step tasks
4. **Dependency Ordering** - Executes tasks in correct order

### Thinking Visibility

All agent reasoning is visible during execution:

- Step-by-step progress updates
- Tool calls and their results
- Agent transitions for multi-agent tasks
- Confidence indicators

### Configuration Options

Create a `.gaterc.json` file in your project root:

```json
{
  "ux": {
    "showThinking": true,
    "showThinkingConfidence": false,
    "showToolCalls": true,
    "streamTokens": true,
    "maxHistory": 50
  },
  "llm": {
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 8192,
    "temperature": 0
  }
}
```

## Architecture notes

If you want to extend GateFlow (new tools, new renderers, stricter policies), see:

- `cli/docs/ARCHITECTURE.md`
- `cli/src/agent/README.md` - Agent system overview
- `cli/src/indexer/README.md` - Project indexing
- `cli/src/verification/README.md` - Verilator integration


