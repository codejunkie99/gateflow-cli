---
name: gf-wave
description: Analyze VCD waveform files from simulation results.
allowed-tools:
  - Read
  - Glob
  - gateflow:gf_analyze_waveform
  - gateflow:gf_find_vcd_files
argument-hint: "<vcd-file> [--signals=<list>]"
---

# GateFlow Waveform Command

Analyze VCD waveform files from simulation.

## Instructions

When user invokes /gf-wave <vcd-file>:

1. **Locate VCD file**:
   - If full path given, use directly
   - If just filename, use `gf_find_vcd_files` to locate it
   - If multiple matches, ask user to clarify

2. **Analyze waveform** using `gf_analyze_waveform` tool

3. **Report analysis**:

```
Waveform Analysis: simulation.vcd
=================================

Time Range: 0ns to 1000ns
Total Signals: 42
Time Resolution: 1ns

Detected Clocks:
  clk: 100MHz (10ns period), 50% duty cycle

Reset Sequence:
  rst_n: Asserted at 0ns, released at 25ns (2.5 cycles)

Signal Summary:
  - 1-bit signals: 15
  - Multi-bit signals: 27
  - Max width: 32 bits

Key Observations:
  - data_valid asserts 5ns after clk rising edge
  - FSM states observed: IDLE → LOAD → PROCESS → DONE
  - 3 complete transactions captured

Potential Issues:
  ⚠ Signal 'debug_flag' never toggles (stuck at 0)
  ⚠ 'ack' has 2ns glitch at t=450ns
  ⚠ 'data_out' shows X values at t=0-25ns (before reset release)
```

## Arguments

- `vcd-file` (required): Path to VCD file, or filename to search for
- `--signals` (optional): Comma-separated list of signals to focus on

## Signal-Specific Analysis

If `--signals` provided:

```
/gf-wave sim.vcd --signals=clk,data_in,data_out,valid

Signal Analysis: clk, data_in, data_out, valid
=============================================

clk:
  Type: Clock
  Period: 10ns (100MHz)
  Transitions: 200

data_in [7:0]:
  Changes: 15 times
  Values observed: 0x00, 0xAA, 0x55, 0xFF

data_out [7:0]:
  Changes: 15 times
  Latency from data_in: 2 clock cycles

valid:
  Assertions: 15
  Average pulse width: 10ns (1 cycle)
```

## Timing Diagram (ASCII)

For small signal sets, show ASCII waveform:

```
     0ns    100ns   200ns   300ns   400ns
      |       |       |       |       |
clk:  _/‾\_/‾\_/‾\_/‾\_/‾\_/‾\_/‾\_/‾\_/‾\
rst_n:__/‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
valid:________/‾‾‾‾\________________/‾‾‾‾\
data: --------<0xAA>----------------<0x55>
```

## Tips

- Suggest looking at specific signals if user has questions
- Offer to trace a data path through the design
- Recommend running additional simulations if coverage seems low
