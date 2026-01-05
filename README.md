# GateFlow CLI

GateFlow is a **natural-language CLI assistant for SystemVerilog**. It can read and summarize hardware projects, generate new modules or testbenches, run Verilator lint, and apply approved edits with safety rails.

## Features
- **Codebase understanding**: scan and index SystemVerilog projects.
- **Code generation**: create new modules, testbenches, or packages from natural language prompts.
- **Safe editing**: preview diffs and require approval before writing changes (supports `--dry-run` and `--yes`).
- **Verification**: run Verilator lint, including an iterative "lint → fix → re-lint" loop for single files.
- **Developer experience**: streaming output, verbose logging, and project-root detection.

## Requirements
- Node.js **18+**
- `npm`
- Optional: **Verilator** installed and available on your PATH (or referenced via `VERILATOR_PATH`).

## Installation
```bash
npm install
npm run build
```

You can run the compiled binary directly or link it locally for the `gateflow` command:
```bash
node dist/index.js doctor
npm link
gateflow doctor
```

## Quick start
Run the chat-first CLI:
```bash
npx gateflow "list all modules"
```
Or start an interactive REPL:
```bash
npx gateflow chat
```

## Commands
| Command | Purpose | Examples |
| --- | --- | --- |
| `gateflow chat [query...]` | Run a single query or start the interactive REPL. | `gateflow "list all modules"` |
| `gateflow scan` | Scan and index the project (SystemVerilog focused). | `gateflow scan --json` |
| `gateflow lint [files...]` | Run Verilator lint. Lints discovered sources when no files are provided. | `gateflow lint src/counter.sv` |
| `gateflow fix <file>` | Iterative lint-fix loop with diff previews and approvals. | `gateflow --yes fix src/counter.sv` |
| `gateflow watch [patterns...]` | Watch files and re-run lint on change. | `gateflow watch src/**/*.sv` |
| `gateflow gen <type> <name>` | Generate new SystemVerilog code. Types: `module`, `testbench`, `package`. | `gateflow gen module uart_rx` |
| `gateflow doctor` | Environment checks (Verilator, API key, project root, git). | `gateflow doctor` |
| `gateflow version` | Print CLI version. | `gateflow version` |

### Global flags
- `-y, --yes`: auto-approve all changes (non-interactive).
- `-n, --dry-run`: show diffs but do not apply changes.
- `--json`: machine-readable output where supported.
- `-v, --verbose`: more logs/events.
- `-C, --cwd <path>`: set working directory (used for project root detection).

## Configuration
### Environment variables
- `ANTHROPIC_API_KEY`: required for AI-powered features (chat/fix/generate).

GateFlow reads `.env` files starting at the repo root. Example:
```env
ANTHROPIC_API_KEY=your_key_here
```

### Verilator
GateFlow uses Verilator for linting. It will try `VERILATOR_PATH` first, then fall back to `verilator` on your PATH.

Windows + WSL example:
```powershell
$env:VERILATOR_PATH="/usr/bin/verilator"
node dist/index.js doctor
```

## File scanning rules
GateFlow focuses on SystemVerilog sources and ignores common build outputs.
- Included extensions: `.sv`, `.svh`, `.v`, `.vh`
- Excluded directories: `node_modules/`, `dist/`, `dist-electron/`, `obj_dir/`, `.git/`, `target/`

Paths you provide are treated as **relative to the detected project root** unless you pass an absolute path.

## Development
- Type-check: `npm run lint`
- Test: `npm test`
- Watch mode for development: `npm run dev`
- Build: `npm run build`

Additional architectural notes live in [`docs/`](docs/), including details on the multi-agent system.
