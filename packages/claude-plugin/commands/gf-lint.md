---
name: gf-lint
description: Run Verilator lint on SystemVerilog files to detect errors and warnings.
allowed-tools:
  - Glob
  - Read
  - gateflow:gf_lint_file
  - gateflow:gf_find_all_sv_files
argument-hint: "[files...]"
---

# GateFlow Lint Command

Run Verilator linting on SystemVerilog files.

## Instructions

When user invokes /gf-lint:

1. **Determine target files**:
   - If files specified: lint those specific files
   - If no arguments: find all .sv files in project using `gf_find_all_sv_files`

2. **Run lint on each file** using `gf_lint_file` tool

3. **Categorize results**:
   - **Errors**: Must fix, will prevent compilation
   - **Warnings**: Should fix, potential issues
   - **Info**: Style suggestions

4. **Report in format**:

```
Lint Results
============

counter.sv:
  Line 15: ERROR - Width mismatch: expected 8 bits, got 16
  Line 23: WARNING - Unused variable 'temp_reg'

fsm.sv:
  Line 42: ERROR - Latch inferred for signal 'state_next'
  Line 58: WARNING - Case statement incomplete

Summary
-------
Files checked: 5
Errors: 3
Warnings: 4

Files with errors:
  - counter.sv (1 error)
  - fsm.sv (2 errors)
```

## Arguments

- `files` (optional): Specific files to lint. Supports globs like `src/*.sv`.

## Follow-up Suggestions

If errors found:
- Suggest `/gf-fix <file>` for auto-fixing
- Offer to explain specific error codes
- Reference sv-lint-fix skill for fix patterns

## Error Code Reference

Common Verilator warnings:
- `WIDTHTRUNC` / `WIDTHEXPAND`: Width mismatch
- `LATCH`: Inferred latch
- `UNDRIVEN`: Signal not driven
- `UNUSED`: Unused variable
- `CASEINCOMPLETE`: Case missing values
- `BLKSEQ`: Blocking in sequential block
