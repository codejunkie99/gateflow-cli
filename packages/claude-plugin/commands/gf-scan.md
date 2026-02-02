---
name: gf-scan
description: Build SystemVerilog project index. Scans for modules, interfaces, packages and maps dependencies.
allowed-tools:
  - Glob
  - Read
  - Grep
  - gateflow:gf_find_all_sv_files
  - gateflow:gf_find_module
  - gateflow:gf_get_project_stats
argument-hint: "[directory]"
---

# GateFlow Scan Command

Build the SystemVerilog project index for the current workspace.

## Instructions

When user invokes /gf-scan:

1. **Find all SystemVerilog files** using `gf_find_all_sv_files` tool or Glob patterns:
   - `**/*.sv` - SystemVerilog source
   - `**/*.svh` - SystemVerilog headers
   - `**/*.v` - Verilog source
   - `**/*.vh` - Verilog headers

2. **Parse each file** to extract:
   - Module declarations with ports (name, direction, width)
   - Interface definitions
   - Package definitions
   - Module instantiations

3. **Build dependency graph**:
   - Which modules instantiate which
   - Package imports
   - Include file relationships

4. **Identify hierarchy**:
   - Top-level modules (not instantiated by others)
   - Leaf modules (don't instantiate anything)
   - Hierarchy depth

5. **Report results** in this format:

```
Project Index Summary
=====================
Files scanned: X
Modules: Y
Packages: Z
Interfaces: W

Top-level modules:
  - top_module (path/to/file.sv)
  - testbench (path/to/tb.sv)

Module Hierarchy:
  top_module
  ├── sub_module_a (2 instances)
  │   └── leaf_module
  └── sub_module_b
      └── another_leaf

Packages:
  - common_pkg (types, constants)
  - config_pkg (parameters)
```

## Arguments

- `directory` (optional): Starting directory to scan. Defaults to current directory.

## Tips

- If scanning a large project, inform user it may take time
- Warn about any files that couldn't be parsed
- Suggest `/gf-lint` after scanning to check for errors
