# GateFlow CLI

A natural-language CLI for SystemVerilog development. Chat with your codebase, lint with Verilator, auto-fix errors, and view waveforms.

## Quick Start

```bash
cd cli
npm install && npm run build
node dist/cli/main.js doctor   # Check setup
```

Set your API key:
```bash
export ANTHROPIC_API_KEY=your_key_here
```

## Commands

| Command | Description |
|---------|-------------|
| `gateflow chat` | Interactive chat or run a query |
| `gateflow scan` | Index SystemVerilog files |
| `gateflow lint [files]` | Run Verilator lint |
| `gateflow fix <file>` | Auto-fix lint errors iteratively |
| `gateflow gen <type> <name>` | Generate module/testbench/package |
| `gateflow wave <vcd>` | Terminal waveform viewer |
| `gateflow wave-web <vcd>` | Browser waveform viewer |
| `gateflow doctor` | Check environment setup |

### Examples

```bash
gateflow "list all modules"           # Single query
gateflow chat                         # Interactive mode
gateflow lint src/counter.sv          # Lint specific file
gateflow fix src/counter.sv           # Fix errors automatically
gateflow gen module uart_rx           # Generate new module
gateflow wave sim/output.vcd          # View waveforms
```

## Flags

| Flag | Description |
|------|-------------|
| `-y, --yes` | Auto-approve all changes |
| `-n, --dry-run` | Preview changes without applying |
| `--json` | Machine-readable output |
| `-v, --verbose` | Verbose logging |

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Required for AI features |
| `VERILATOR_PATH` | Custom Verilator path (optional) |

### Windows + WSL

If Verilator is in WSL:
```powershell
$env:VERILATOR_PATH="/usr/bin/verilator"
```

### Project Config (`.gaterc.json`)

```json
{
  "ux": { "showThinking": true, "streamTokens": true },
  "llm": { "model": "claude-sonnet-4-20250514", "maxTokens": 8192 }
}
```

## Safety

- All edits show a **diff preview** before applying
- Approval prompts: `Y` (yes), `A` (all), `N` (no), `S` (skip)
- Use `--dry-run` to preview without changes
- Use `--yes` for CI/scripts

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Lint failed |
| 2 | User rejected change |
| 3 | Tool error |
| 4 | Config error |

## Development

```bash
npm run build    # Build
npm run dev      # Dev mode
npm test         # Run tests
```

## Docs

- `cli/docs/ARCHITECTURE.md` - System architecture
- `cli/docs/AGENTS.md` - Multi-agent system
