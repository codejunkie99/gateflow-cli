---
name: gf-setup
description: First-time setup and onboarding for GateFlow. Installs tools, explains features, and gets you started.
allowed-tools:
  - Bash
  - Glob
  - Read
  - Write
  - WebSearch
  - gateflow:gf_check_tool_status
  - gateflow:gf_find_all_sv_files
---

# GateFlow Setup & Onboarding

Welcome new users and get them started with GateFlow.

## Instructions

When user invokes /gf-setup OR on first use of any /gf-* command:

### 1. Welcome Message

```
+---------------------------------------------------------------+
|                                                               |
|   Welcome to GateFlow!                                        |
|                                                               |
|   AI-powered SystemVerilog development assistant              |
|                                                               |
|   Made with <3 for Hardware                                   |
|   by Avid and Menace                                          |
|                                                               |
|   Loving hardware doesn't have to be gatekept.                |
|                                                               |
+---------------------------------------------------------------+
```

### 2. Auto-Install All Dependencies

**Install everything automatically - don't ask:**

```bash
# macOS
echo "Setting up your environment..."

# Homebrew (if missing)
which brew > /dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js
echo "Checking Node.js..."
which node > /dev/null || brew install node

# Verilator (required)
echo "Checking Verilator..."
which verilator > /dev/null || brew install verilator

# Verible (for fast parsing) - requires tap
echo "Checking Verible..."
if ! which verible-verilog-syntax > /dev/null 2>&1; then
    brew tap chipsalliance/verible
    brew install chipsalliance/verible/verible
fi

echo "All tools installed!"
```

**Optional: Install Slang (for advanced semantic analysis)**

Slang needs to be built from source. Only install if user explicitly wants it:

```bash
# Install build tools
brew install cmake

# Clone and build slang
git clone https://github.com/MikePopoloski/slang.git /tmp/slang
cd /tmp/slang
cmake -B build
cmake --build build -j$(sysctl -n hw.ncpu)

# Install to /usr/local/bin (or ~/bin)
sudo cp build/bin/slang /usr/local/bin/ 2>/dev/null || cp build/bin/slang ~/bin/

# Cleanup
rm -rf /tmp/slang
```

If build fails, use WebSearch to find current instructions:
```
WebSearch: "build slang SystemVerilog macOS arm64 2024"
```

Show progress:
```
Setting up GateFlow...

[1/4] Homebrew - OK
[2/4] Node.js - OK (v20.10.0)
[3/4] Verilator - OK (5.024)
[4/4] Verible - OK (installing via chipsalliance tap...)

All tools ready!
```

### 2b. Fallback: Use WebSearch if Installation Fails

If any brew install fails, use Claude Code's WebSearch to find the correct method:

```
WebSearch: "install verilator macOS 2024"
WebSearch: "install verible systemverilog macOS homebrew"
```

This lets GateFlow self-heal when package names or installation methods change.

### 3. Quick Tour

After tools are installed, show a quick tour:

```
===============================================================
                     Quick Start Guide
===============================================================

INDEX YOUR PROJECT
   /gf-scan
   Discovers all modules, packages, and dependencies

CHECK FOR ERRORS
   /gf-lint
   Runs Verilator lint on your code

AUTO-FIX ERRORS
   /gf-fix <file>
   AI fixes width mismatches, latches, and more

GENERATE CODE
   /gf-gen module <name>     - Create a new module
   /gf-gen testbench <name>  - Create a testbench
   /gf-gen package <name>    - Create a package

ANALYZE WAVEFORMS
   /gf-wave <file.vcd>
   Parse and analyze simulation results

COMPLEX TASKS
   /gf-plan <description>
   Multi-agent planning for big tasks

===============================================================
```

### 4. Detect Project

Check if there's already a SystemVerilog project:

```bash
# Count SV files
find . -name "*.sv" -o -name "*.v" 2>/dev/null | head -20
```

If files found:
```
Found 12 SystemVerilog files in your project!

Try: /gf-scan to index them
```

If no files:
```
No SystemVerilog files found yet.

Try: /gf-gen module counter
To create your first module!
```

### 5. Mark Onboarding Complete

Create a marker so we don't repeat onboarding:

```bash
mkdir -p ~/.gateflow
touch ~/.gateflow/.onboarded
```

### 6. Ready Message

```
===============================================================

   You're all set!

   Just describe what you want to build in plain English,
   or use the /gf-* commands above.

   Example: "Create a FIFO module with configurable depth"

   We can't wait to see what you create!

===============================================================
```

## Key Behaviors

- Run automatically on first /gf-* command if ~/.gateflow/.onboarded doesn't exist
- Install ALL tools without asking
- Show friendly progress, not scary terminal output
- End with encouragement and a clear next step
- Keep the energy positive and welcoming
