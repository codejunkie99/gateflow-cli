<div align="center">

# GateFlow CLI

**AI-Powered SystemVerilog Development Environment**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Powered by Claude](https://img.shields.io/badge/Powered%20by-Claude%20AI-orange)](https://www.anthropic.com/)

</div>

---

GateFlow CLI is a production-grade command-line interface that integrates AI-powered natural language processing into SystemVerilog development workflows. It enables developers to query codebases conversationally, automatically resolve lint errors, generate testbenches, and analyze waveforms directly from the terminal.

## Table of Contents

- [Features](#features)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Safety and Reliability](#safety-and-reliability)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Multi-Agent AI System

- **Specialized Worker Agents** — Five purpose-built agents for understanding, code generation, testbench creation, debugging, and refactoring
- **Intelligent Orchestration** — Automatic complexity detection with dynamic task routing
- **Execution Planning** — Multi-step task decomposition with dependency resolution
- **Transparent Reasoning** — Real-time visibility into agent decision-making processes

### Development Tools

- **Natural Language Queries** — Query your codebase using plain English
- **Automated Lint Resolution** — Iterative Verilator-based error detection and AI-assisted fixes
- **Code Generation** — Generate synthesizable SystemVerilog modules, testbenches, and packages
- **Project Indexing** — Fast module discovery, dependency analysis, and compilation order resolution

### Waveform Analysis

- **Terminal Viewer** — VCD waveform visualization in the terminal
- **Web Viewer** — Browser-based waveform explorer with full interactivity
- **MCP Integration** — Model Context Protocol server for programmatic waveform data access

### Safety Features

- **Diff Preview System** — Visual diff for all file modifications before application
- **Policy Engine** — Fine-grained approval controls for file operations
- **Dry-Run Mode** — Preview changes without modifying files
- **Standardized Exit Codes** — CI/CD-compatible error codes for automation pipelines

---

## System Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18.0.0 | Required |
| npm | >= 8.0.0 | Required |
| Anthropic API Key | — | [Obtain key](https://console.anthropic.com/) |
| Verilator | >= 5.0 | Optional, required for linting |

### Platform Support

- **Linux** — Full support
- **macOS** — Full support
- **Windows** — Full support (WSL recommended for Verilator)

---

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/gateflow/gateflow-cli.git
cd gateflow-cli/cli

# Install dependencies
npm install

# Build the project
npm run build

# Configure API key
export ANTHROPIC_API_KEY=<your-api-key>

# Verify installation
gateflow doctor
```

### Verify Installation

```bash
gateflow doctor
```

This command validates your environment, checking for required dependencies and proper configuration.

---

## Usage

### Interactive Mode

```bash
gateflow chat
```

Launches an interactive session for multi-turn conversations with the AI agents.

### Single Query

```bash
gateflow "list all modules in my project"
```

Executes a one-off query and returns the result.

### Command Reference

| Command | Description | Example |
|---------|-------------|---------|
| `gateflow chat` | Start interactive session | `gateflow chat` |
| `gateflow <query>` | Execute single query | `gateflow "explain this module"` |
| `gateflow scan` | Index SystemVerilog files | `gateflow scan` |
| `gateflow lint [files]` | Run Verilator lint | `gateflow lint src/*.sv` |
| `gateflow fix <file>` | Auto-fix lint errors | `gateflow fix src/alu.sv` |
| `gateflow gen <type> <name>` | Generate code artifacts | `gateflow gen testbench uart_rx` |
| `gateflow wave <vcd>` | View waveforms (terminal) | `gateflow wave sim/out.vcd` |
| `gateflow wave-web <vcd>` | View waveforms (browser) | `gateflow wave-web sim/out.vcd` |
| `gateflow doctor` | Validate environment | `gateflow doctor` |

### Global Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Auto-approve all changes |
| `-n, --dry-run` | Preview changes without applying |
| `--json` | Output in JSON format |
| `-v, --verbose` | Enable verbose logging |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key (required) | — |
| `VERILATOR_PATH` | Path to Verilator binary | `verilator` |

### Project Configuration

Create a `.gaterc.json` file in your project root:

```json
{
  "llm": {
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 8192,
    "temperature": 0.7
  },
  "tools": {
    "safeMode": true,
    "autoApprove": false
  },
  "ux": {
    "showThinking": true,
    "streamTokens": true
  },
  "project": {
    "includePaths": ["src/", "rtl/"],
    "excludePaths": ["build/", "sim/"]
  }
}
```

### Windows with WSL

For Windows users running Verilator through WSL:

```powershell
# PowerShell
$env:VERILATOR_PATH = "/usr/bin/verilator"
```

Or configure in `.gaterc.json`:

```json
{
  "tools": {
    "verilatorPath": "/usr/bin/verilator"
  }
}
```

---

## Architecture

GateFlow CLI implements a multi-agent architecture designed for complex hardware design tasks.

```
┌─────────────────────────────────────────────────────────┐
│                      User Query                         │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│               Complexity Detection                       │
│         Determines routing strategy for query           │
└─────────────────────────────────────────────────────────┘
                            │
           ┌────────────────┴────────────────┐
           ▼                                 ▼
    Simple Request                    Complex Request
           │                                 │
           ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────────┐
│    Direct Routing   │         │    Planning Agent       │
│    Single Agent     │         │    Execution Plan       │
└─────────────────────┘         └─────────────────────────┘
           │                                 │
           ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────────┐
│   Worker Execution  │         │  Sequential Execution   │
└─────────────────────┘         └─────────────────────────┘
```

### Core Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Agent System | `src/agent/` | Multi-agent orchestration |
| Event Bus | `src/events/` | Decoupled pub/sub messaging |
| Policy Engine | `src/approval/` | Safety checks and approvals |
| Project Indexer | `src/indexer/` | Module discovery and analysis |
| File Operations | `src/fileops/` | Policy-aware file manipulation |
| Verification | `src/verification/` | Verilator integration |

### Specialized Agents

| Agent | Responsibility | Available Tools |
|-------|----------------|-----------------|
| Understanding | Code analysis and comprehension | `read_file`, `find_module`, `search_code`, `get_dependencies` |
| Code Generation | Module and package creation | `write_file`, `lint_file`, `find_module` |
| Testbench | Verification code generation | `write_file`, `read_file`, `run_simulation` |
| Debug | Simulation failure diagnosis | `read_file`, `lint_file`, `run_simulation` |
| Refactoring | Targeted code modifications | `edit_lines`, `search_replace`, `lint_file` |

For detailed architecture documentation:

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Multi-Agent System](./docs/AGENTS.md)
- [Multi-Language Support](./docs/MULTI_LANGUAGE_ARCHITECTURE.md)

---

## Safety and Reliability

### Diff Preview

All file modifications display a colorized diff before application:

```
[DIFF PREVIEW] src/counter.sv
─────────────────────────────────────────────
-  logic [7:0] count;
+  logic [15:0] count;
─────────────────────────────────────────────
Apply this change? [Y/n/a/s]
```

### Approval Options

| Key | Action |
|-----|--------|
| `Y` | Apply change |
| `N` | Reject change |
| `A` | Approve all remaining |
| `S` | Skip and continue |

### Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | Lint failure |
| 2 | User rejected change |
| 3 | Tool error |
| 4 | Configuration error |
| 5 | Network error |
| 6 | Timeout |
| 7 | Watch error |

---

## Development

### Build Commands

```bash
npm run build          # Compile TypeScript
npm run dev            # Development mode with tsx
npm run lint           # Type-check with tsc
npm test               # Run unit tests
npm run test:unit      # Run tests in CI mode
```

### Project Structure

```
cli/
├── src/
│   ├── agent/              # Multi-agent system
│   │   ├── orchestrator/   # Agent coordination
│   │   ├── workers/        # Specialized agents
│   │   ├── prompts/        # Prompt engineering
│   │   └── reasoning/      # Thinking chain
│   ├── approval/           # Policy engine
│   ├── cli/                # CLI commands
│   ├── config/             # Configuration management
│   ├── events/             # Event bus system
│   ├── fileops/            # File operations
│   ├── indexer/            # Project indexing
│   ├── ui/                 # Terminal UI renderer
│   ├── verification/       # Verilator integration
│   └── waveform/           # VCD parsing and viewing
├── docs/                   # Documentation
└── scripts/                # Build scripts
```

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Specific file
npm test ThinkingChain.test.ts
```

---

## Contributing

Contributions are welcome. Please follow these guidelines:

### Reporting Issues

1. Search existing issues before creating a new one
2. Include reproduction steps, expected behavior, and actual behavior
3. Attach logs using the `--verbose` flag
4. Specify your environment (OS, Node.js version, etc.)

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/description`
3. Write clear, atomic commits
4. Add tests for new functionality
5. Ensure `npm run lint` and `npm test` pass
6. Submit a pull request with a clear description

### Code Standards

- Follow TypeScript best practices
- Use Zod for runtime validation
- Document public APIs with JSDoc
- Maintain single responsibility for agents
- Use the event bus for cross-component communication

---

## Roadmap

| Feature | Status |
|---------|--------|
| Multi-Language Support (VHDL, Verilog) | Planned |
| Plugin System | Planned |
| Cloud Indexing | Planned |
| Formal Verification Integration | Planned |
| Coverage Analysis | Planned |
| Web Interface | Planned |

---

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

---

## Acknowledgments

- [Anthropic](https://www.anthropic.com/) — Claude AI
- [Verilator](https://www.veripool.org/verilator/) — SystemVerilog simulation and linting
- [Verible](https://github.com/chipsalliance/verible) — SystemVerilog parsing
- [Slang](https://github.com/MikePopoloski/slang) — SystemVerilog compiler frontend

---

## Support

- **Documentation**: [`docs/`](./docs/)
- **Issues**: [GitHub Issues](https://github.com/gateflow/gateflow-cli/issues)
- **Discussions**: [GitHub Discussions](https://github.com/gateflow/gateflow-cli/discussions)
