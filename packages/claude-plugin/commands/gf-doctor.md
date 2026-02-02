---
name: gf-doctor
description: Check environment and automatically install any missing tools (Verilator, Verible, Node.js).
allowed-tools:
  - Bash
  - Glob
  - WebSearch
  - gateflow:gf_check_tool_status
  - gateflow:gf_find_all_sv_files
---

# GateFlow Doctor Command

Check environment and **automatically install** any missing tools.

## Instructions

When user invokes /gf-doctor:

### 1. Check and Auto-Install Each Tool

Run these checks and **install immediately if missing** - don't ask, just do it:

```bash
# Check Homebrew first (required for installs on macOS)
which brew || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Check and install Node.js
which node || brew install node

# Check and install Verilator (REQUIRED)
which verilator || brew install verilator

# Check and install Verible (requires tap)
if ! which verible-verilog-syntax > /dev/null 2>&1; then
    brew tap chipsalliance/verible
    brew install chipsalliance/verible/verible
fi
```

**Optional: Install Slang** (for advanced semantic analysis - requires building from source):

```bash
# Install if user wants it
brew install cmake
git clone https://github.com/MikePopoloski/slang.git /tmp/slang
cd /tmp/slang && cmake -B build && cmake --build build -j$(sysctl -n hw.ncpu)
sudo cp build/bin/slang /usr/local/bin/ 2>/dev/null || cp build/bin/slang ~/bin/
rm -rf /tmp/slang
```

If any install fails, use WebSearch to find current instructions.

### 2. Installation Flow

**DO NOT ASK** - just install missing tools automatically:

```
GateFlow Environment Check
==========================

Checking tools...

[OK] Homebrew found
[INSTALLING] Node.js not found - installing...
    > brew install node
    OK - Node.js v20.x installed

[OK] Verilator 5.024 found
[INSTALLING] Verible not found - installing...
    > brew tap chipsalliance/verible
    > brew install chipsalliance/verible/verible
    OK - Verible installed

All tools ready!
```

### 3. For Linux Users

```bash
# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Install Verilator
    which verilator || sudo apt-get update && sudo apt-get install -y verilator

    # Node.js via nvm or apt
    which node || curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
fi
```

### 4. Verify All Installed

After installing, verify everything works:

```bash
node --version
verilator --version
verible-verilog-syntax --version
slang --version
```

### 5. Report Final Status

```
GateFlow Environment Check
==========================

Tools:
  [OK] Node.js v20.10.0
  [OK] Verilator 5.044
  [OK] Verible 0.0-3946
  [--] Slang (optional - not installed)

Project:
  [OK] SystemVerilog files: 12 found
  [OK] Testbenches: 3 found

Ready to go! Try /gf-scan to index your project.
```

## Key Behavior

- **NEVER ask permission** to install tools - just install them
- Install required tools (Verilator, Verible) automatically
- Slang is optional - only build from source if user explicitly requests
- Use `brew install` on macOS, `apt-get` on Linux
- For Verible: `brew tap chipsalliance/verible && brew install chipsalliance/verible/verible`
- If Homebrew missing on Mac, install it first
- Show progress as each tool installs
- If install fails, use **WebSearch** to find current installation method
- Verify each install succeeded before moving on
