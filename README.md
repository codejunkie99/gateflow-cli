<div align="center">

# GateFlow CLI

**AI-Powered SystemVerilog Development Environment**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Powered by Claude](https://img.shields.io/badge/Powered%20by-Claude%20AI-orange)](https://www.anthropic.com/)

A production-grade CLI that brings AI-powered natural language interactions to SystemVerilog development. Chat with your codebase, auto-fix lint errors, generate testbenches, and debug waveforms—all from the command line.

[Features](#-features) •
[Quick Start](#-quick-start) •
[Documentation](#-documentation) •
[Architecture](#-architecture) •
[Contributing](#-contributing)

</div>

---

## ✨ Features

### 🤖 **AI-Powered Multi-Agent System**
- **Specialized Worker Agents**: Understanding, Code Generation, Testbench, Debug, and Refactoring agents
- **Intelligent Orchestration**: Automatic complexity detection and task routing
- **Execution Planning**: Multi-step task decomposition with dependency resolution
- **Thinking Visibility**: Real-time insight into agent reasoning and decision-making

### 🔧 **Smart Development Tools**
- **Natural Language Queries**: Ask questions about your codebase in plain English
- **Auto-Fix Lint Errors**: Iterative Verilator-based error fixing with AI suggestions
- **Code Generation**: Create synthesizable SystemVerilog modules, testbenches, and packages
- **Project Indexing**: Fast module discovery, dependency analysis, and compilation order

### 📊 **Waveform Analysis**
- **Terminal Viewer**: VCD waveform visualization directly in your terminal
- **Web Viewer**: Full-featured browser-based waveform explorer
- **MCP Integration**: Model Context Protocol server for waveform data access

### 🛡️ **Production-Ready Safety**
- **Diff Preview System**: Visual diff for all file changes before applying
- **Policy Engine**: Fine-grained approval controls for file operations
- **Dry-Run Mode**: Preview changes without touching files
- **Exit Code Standards**: Standardized error codes for CI/CD integration

### 🌐 **Multi-Language Support** *(Roadmap)*
- SystemVerilog (current), Verilog, and VHDL support planned
- Cross-language project analysis and dependency resolution

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** ≥18.0.0
- **Anthropic API Key** ([Get one here](https://console.anthropic.com/))
- **Verilator** (optional, for linting)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/cursor-for-vhdl.git
cd cursor-for-vhdl/cli

# Install dependencies and build
npm install && npm run build

# Set your API key
export ANTHROPIC_API_KEY=your_key_here

# Verify installation
gateflow doctor
```

### First Run

```bash
# Interactive chat mode
gateflow chat

# Ask a question
gateflow "list all modules in my project"

# Generate a module
gateflow gen module uart_tx

# Lint and auto-fix
gateflow lint src/counter.sv
gateflow fix src/counter.sv
```

---

## 📖 Documentation

### Command Reference

| Command | Description | Example |
|---------|-------------|---------|
| `gateflow chat` | Start interactive chat session | `gateflow chat` |
| `gateflow <query>` | Run a single natural language query | `gateflow "explain this module"` |
| `gateflow scan` | Index SystemVerilog files for fast lookup | `gateflow scan` |
| `gateflow lint [files]` | Run Verilator lint on files | `gateflow lint src/*.sv` |
| `gateflow fix <file>` | Auto-fix lint errors iteratively | `gateflow fix src/alu.sv` |
| `gateflow gen <type> <name>` | Generate module/testbench/package | `gateflow gen testbench uart_rx` |
| `gateflow wave <vcd>` | View waveforms in terminal | `gateflow wave sim/out.vcd` |
| `gateflow wave-web <vcd>` | View waveforms in browser | `gateflow wave-web sim/out.vcd` |
| `gateflow doctor` | Check environment and dependencies | `gateflow doctor` |

### Global Flags

| Flag | Description |
|------|-------------|
| `-y, --yes` | Auto-approve all changes (use with caution) |
| `-n, --dry-run` | Preview changes without applying them |
| `--json` | Output in machine-readable JSON format |
| `-v, --verbose` | Enable verbose logging with agent decisions |

### Configuration

#### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | **Required** - Your Anthropic API key | - |
| `VERILATOR_PATH` | Custom Verilator binary path (WSL support) | `verilator` |

#### Project Configuration (`.gaterc.json`)

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
    "streamTokens": true,
    "showThinkingConfidence": false
  },
  "project": {
    "includePaths": ["src/", "rtl/"],
    "excludePaths": ["build/", "sim/"]
  }
}
```

#### Windows + WSL Support

If you're using Verilator in WSL from Windows:

```powershell
# PowerShell
$env:VERILATOR_PATH = "/usr/bin/verilator"

# Or in .gaterc.json
{
  "tools": {
    "verilatorPath": "/usr/bin/verilator"
  }
}
```

---

## 🏗️ Architecture

GateFlow CLI is built on a sophisticated multi-agent architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                       User Query                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Complexity Detection (AI SDK)                   │
│         "Does this need multi-agent coordination?"           │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
   Simple Request                    Complex Request
          │                                 │
          ▼                                 ▼
┌──────────────────┐           ┌─────────────────────────┐
│  AI Routing      │           │   Planning Agent        │
│  Single Agent    │           │   ExecutionPlan         │
└──────────────────┘           └─────────────────────────┘
          │                                 │
          ▼                                 ▼
┌──────────────────┐           ┌─────────────────────────┐
│  Worker Agent    │           │   Sequential Execution  │
│  Execution       │           │   (dependency order)    │
└──────────────────┘           └─────────────────────────┘
```

### Core Components

- **Agent System** (`src/agent/`): Multi-agent orchestration with 5 specialized workers
- **Event Bus** (`src/events/`): Decoupled pub/sub for UI and agent communication
- **Policy Engine** (`src/approval/`): Safety checks and approval workflows
- **Project Indexer** (`src/indexer/`): Fast module discovery and dependency analysis
- **File Operations** (`src/fileops/`): Safe, policy-aware file manipulation
- **Verification** (`src/verification/`): Verilator integration and fix loops

### Specialized Agents

| Agent | Purpose | Tools |
|-------|---------|-------|
| **Understanding** | Read and analyze existing code | `read_file`, `find_module`, `search_code`, `get_dependencies` |
| **Code Generation** | Create new synthesizable modules | `write_file`, `lint_file`, `find_module` |
| **Testbench** | Generate verification code | `write_file`, `read_file`, `run_simulation` |
| **Debug** | Diagnose simulation failures | `read_file`, `lint_file`, `run_simulation` |
| **Refactoring** | Modify existing code minimally | `edit_lines`, `search_replace`, `lint_file` |

For detailed architecture documentation, see:
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) - System architecture deep-dive
- [`docs/AGENTS.md`](./docs/AGENTS.md) - Multi-agent system details
- [`docs/MULTI_LANGUAGE_ARCHITECTURE.md`](./docs/MULTI_LANGUAGE_ARCHITECTURE.md) - Future multi-language support

---

## 🔒 Safety & Reliability

### Diff Preview System
Every file modification shows a colorized diff before applying:
```
[DIFF PREVIEW] src/counter.sv
─────────────────────────────────────────────
-  logic [7:0] count;
+  logic [15:0] count;  // Widened to 16 bits
─────────────────────────────────────────────
Apply this change? [Y/n/a/s]
```

### Approval Workflow
- `Y` - Apply this change
- `N` - Reject this change
- `A` - Approve all remaining changes
- `S` - Skip this change and continue

### Exit Codes
Standard exit codes for CI/CD integration:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Lint failed |
| 2 | User rejected change |
| 3 | Tool error |
| 4 | Configuration error |
| 5 | Network error |
| 6 | Timeout |
| 7 | Watch error |

---

## 🛠️ Development

### Build Commands

```bash
npm run build              # Compile TypeScript
npm run dev                # Development mode with tsx
npm run lint               # Type-check with tsc
npm test                   # Run unit tests (vitest)
npm run test:unit          # Run tests in CI mode
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
│   ├── cli/                # CLI commands & entry
│   ├── config/             # Configuration management
│   ├── events/             # Event bus system
│   ├── fileops/            # File operations
│   ├── indexer/            # Project indexing
│   ├── ui/                 # Terminal UI renderer
│   ├── verification/       # Verilator integration
│   └── waveform/           # VCD parsing & viewing
├── docs/                   # Architecture documentation
└── scripts/                # Build & download scripts
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test ThinkingChain.test.ts
```

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Reporting Issues
- Use the [GitHub Issues](https://github.com/your-org/cursor-for-vhdl/issues) tracker
- Include steps to reproduce, expected vs actual behavior
- Attach relevant logs (use `--verbose` flag)

### Pull Requests
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes with clear commit messages
4. Add tests for new functionality
5. Ensure `npm run lint` and `npm test` pass
6. Submit a PR with a clear description

### Development Guidelines
- Follow TypeScript best practices
- Use Zod for schema validation
- Add JSDoc comments for public APIs
- Keep agents focused on single responsibilities
- Use the event bus for cross-component communication

---

## 📚 Examples

### Example 1: Understanding a Module
```bash
$ gateflow "what does counter.sv do?"

[Understanding Agent]
Analyzing counter.sv...

The counter module (src/counter.sv:5) is a 16-bit up counter with:
- Ports: clk (input), rst_n (input), count (output [15:0])
- Synchronous active-low reset
- Increments on positive clock edge
- Instantiated in: top.sv, testbench.sv
```

### Example 2: Auto-Fixing Lint Errors
```bash
$ gateflow fix src/alu.sv

[Lint Agent]
Running Verilator on src/alu.sv...
Found 3 errors:

1. Width mismatch: 'result' expects 32 bits, got 16 bits
2. Unused signal: 'temp'
3. Missing default in case statement

[Refactoring Agent]
Proposing fixes...

[DIFF PREVIEW]
...
Apply all fixes? [Y/n/a/s] Y

✓ All fixes applied successfully
✓ Re-linting... Clean!
```

### Example 3: Generating a Testbench
```bash
$ gateflow gen testbench uart_rx

[Code Generation Agent]
Generating tb_uart_rx.sv...

✓ Created tb_uart_rx.sv
✓ Added clock generator (100MHz)
✓ Added reset logic
✓ Instantiated DUT with proper connections
✓ Added $dumpfile for waveform capture
✓ Linted: Clean

Testbench ready! Run with:
  verilator --binary tb_uart_rx.sv
  gateflow wave sim/uart_rx.vcd
```

---

## 🗺️ Roadmap

- [ ] **Multi-Language Support**: VHDL and Verilog support (see `docs/MULTI_LANGUAGE_ARCHITECTURE.md`)
- [ ] **Plugin System**: Extensible tool integrations
- [ ] **Cloud Indexing**: Remote codebase analysis
- [ ] **Formal Verification**: Integration with model checkers
- [ ] **Coverage Analysis**: AI-driven coverage hole detection
- [ ] **Web UI**: Browser-based interface for non-terminal users

See [`docs/COMMERCIAL_VIABILITY_ROADMAP.md`](./docs/COMMERCIAL_VIABILITY_ROADMAP.md) for the full product roadmap.

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](./LICENSE) file for details.

```
MIT License
Copyright (c) 2024 GateFlow
```

---

## 🙏 Acknowledgments

- **Anthropic** - Claude AI powers the multi-agent system
- **Verilator** - Open-source SystemVerilog linting and simulation
- **Verible** - SystemVerilog parsing and analysis
- **Slang** - High-performance SystemVerilog compiler frontend

---

## 📧 Support

- **Documentation**: [`docs/`](./docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/cursor-for-vhdl/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/cursor-for-vhdl/discussions)

---

<div align="center">

**Built with ❤️ for the hardware design community**

[⬆ Back to Top](#gateflow-cli)

</div>
