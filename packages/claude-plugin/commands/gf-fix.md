---
name: gf-fix
description: Automatically fix lint errors in a SystemVerilog file using AI-powered analysis.
allowed-tools:
  - Read
  - Edit
  - Write
  - gateflow:gf_lint_file
  - gateflow:gf_read_file
argument-hint: "<file> [--max-iterations=5]"
---

# GateFlow Fix Command

Iteratively fix lint errors in a SystemVerilog file.

## Instructions

When user invokes /gf-fix <file>:

1. **Read the target file** to understand current code

2. **Run initial lint** using `gf_lint_file` to get error list

3. **For each error, apply appropriate fix**:

   **Width Mismatches (WIDTHTRUNC/WIDTHEXPAND)**:
   - Add explicit slicing: `signal[7:0]`
   - Add zero extension: `{8'b0, signal}`
   - Adjust signal declaration width

   **Inferred Latches (LATCH)**:
   - Add default assignment at start of always_comb
   - Add default case to case statements
   - Ensure all paths assign all outputs

   **Undriven Signals (UNDRIVEN)**:
   - Connect to appropriate source
   - Remove if unused
   - Tie off: `assign sig = '0;`

   **Unused Variables (UNUSED)**:
   - Remove declaration if truly unused
   - Add lint pragma if intentionally unused

   **Incomplete Case (CASEINCOMPLETE)**:
   - Add `default:` case

4. **Apply fixes and re-lint** - repeat until clean or max iterations

5. **Show summary**:

```
Fix Summary for counter.sv
==========================

Iteration 1/5:
  Fixed 3 errors:
  - Line 15: Width mismatch → Added explicit cast [7:0]
  - Line 23: Inferred latch → Added default assignment
  - Line 31: Missing semicolon → Added semicolon
  Re-checking... 1 error remaining

Iteration 2/5:
  Fixed 1 error:
  - Line 42: Undriven signal → Connected to input port
  Re-checking... Clean!

Result: Fixed counter.sv in 2 iterations (4 errors fixed)
```

## Arguments

- `file` (required): Path to SystemVerilog file to fix
- `--max-iterations` (optional): Maximum fix iterations (default: 5)

## Important

- Always show proposed changes before applying
- Preserve original code style and formatting
- Add brief comments for non-obvious fixes
- If a fix seems risky, ask user for confirmation
- Stop if same error persists after fix attempt (avoid infinite loops)
