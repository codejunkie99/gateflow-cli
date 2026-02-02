---
name: gf-sim
description: Run Verilator simulation on a SystemVerilog testbench.
allowed-tools:
  - Bash
  - Read
  - Glob
  - gateflow:gf_find_all_sv_files
  - gateflow:gf_find_vcd_files
argument-hint: "<testbench.sv> [--top=<module>] [--waves]"
---

# GateFlow Simulation Command

Run Verilator simulation on SystemVerilog testbenches.

## Instructions

When user invokes /gf-sim <testbench>:

1. **Locate testbench file**:
   - If full path given, use directly
   - If just filename, search with `gf_find_all_sv_files`
   - Testbench files typically named `*_tb.sv` or `tb_*.sv`

2. **Identify dependencies**:
   - Read the testbench to find module instantiations
   - Locate DUT (Device Under Test) source files
   - Gather all required .sv files

3. **Compile with Verilator**:
   ```bash
   verilator --binary --trace -Wall \
     -o sim_output \
     --top-module <testbench_module> \
     <all_sv_files>
   ```

4. **Run simulation**:
   ```bash
   ./obj_dir/sim_output
   ```

5. **Capture results**:
   - Parse stdout for pass/fail assertions
   - Look for `$finish` or `$fatal` calls
   - Collect VCD output path

6. **Report in format**:

```
Simulation Results: counter_tb.sv
=================================

Compilation: PASSED
  Files: counter.sv, counter_tb.sv
  Warnings: 0

Execution: PASSED
  Runtime: 1.2s
  Simulated time: 10000ns

Test Status: PASSED (12/12 assertions)
  [PASS] Reset initializes count to 0
  [PASS] Count increments on clock
  [PASS] Count wraps at maximum value
  ...

VCD Output: obj_dir/counter_tb.vcd (245 KB)
  Tip: Use /gf-wave obj_dir/counter_tb.vcd to analyze waveforms
```

## Failure Reporting

If simulation fails:

```
Simulation Results: fifo_tb.sv
==============================

Compilation: PASSED

Execution: FAILED
  Runtime: 0.3s (stopped early)
  Simulated time: 450ns

Test Status: FAILED (3/8 assertions)
  [PASS] FIFO empty on reset
  [PASS] Write increments count
  [FAIL] Read data matches write data at t=350ns
    Expected: 0xAA
    Got: 0x00
  [FAIL] FIFO full flag asserts at t=400ns
  ... (2 more failures)

Error Details:
  fifo_tb.sv:47: Assertion failed: data_out !== expected_data
  $fatal called at fifo_tb.sv:52

VCD Output: obj_dir/fifo_tb.vcd
  Tip: Analyze waveforms around t=350ns to debug the failure
```

## Arguments

- `testbench` (required): Path to testbench file or filename
- `--top` (optional): Top module name (auto-detected from filename if not specified)
- `--waves` (optional): Force VCD generation even if not in testbench

## Compilation Errors

If Verilator compilation fails:

```
Simulation FAILED: Compilation Error
====================================

%Error: counter.sv:15: Cannot find signal: 'clk_in'
%Error: counter_tb.sv:23: Module 'counter' port 'data' not found

Suggestion: Run /gf-lint to check for errors before simulating.
```

## Tips

- Auto-detects testbench module from filename pattern
- Searches for DUT files in same directory and `src/`, `rtl/` subdirs
- VCD files placed in `obj_dir/` by default
- Supports SystemVerilog assertions ($assert, $error, $fatal)
- Use `--waves` if testbench doesn't have `$dumpfile`/`$dumpvars`
