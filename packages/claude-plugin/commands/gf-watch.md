---
name: gf-watch
description: Watch for file changes and automatically run lint checks.
allowed-tools:
  - Bash
  - Glob
  - gateflow:gf_lint_file
argument-hint: "[patterns...]"
---

# GateFlow Watch Command

Set up file watching for automatic linting.

## Instructions

When user invokes /gf-watch:

1. **Explain watch behavior**:

```
GateFlow Watch Mode
===================

This will monitor SystemVerilog files for changes and automatically lint them.

Watching patterns:
  - **/*.sv
  - **/*.svh

When a file changes:
  1. Run lint check
  2. Report any new errors/warnings
  3. Suggest /gf-fix if errors found
```

2. **Provide setup options**:

### Option A: Using fswatch (macOS/Linux)

```bash
# Install fswatch if needed
brew install fswatch  # macOS
# or: apt-get install fswatch  # Linux

# Run watch
fswatch -o **/*.sv | while read; do
  echo "File changed, running lint..."
  # Your lint command here
done
```

### Option B: Using nodemon

```bash
npm install -g nodemon
nodemon --watch '**/*.sv' --ext sv,svh --exec 'echo "Linting..." && verilator --lint-only *.sv'
```

### Option C: Using entr

```bash
# Install entr
brew install entr  # macOS

# Run watch
find . -name "*.sv" | entr -c sh -c 'echo "Linting..."; verilator --lint-only *.sv'
```

3. **For IDE users**, suggest:
   - VSCode: Install SystemVerilog extension with lint-on-save
   - Vim: Use ALE or similar for async linting

## Arguments

- `patterns` (optional): File patterns to watch (default: `**/*.sv`, `**/*.svh`)

## Note

Claude Code doesn't support long-running watch processes directly. This command provides setup instructions for external file watchers that integrate with your development workflow.

For one-time lint checks, use `/gf-lint` instead.
