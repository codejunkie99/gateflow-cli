---
name: VCD Waveform Analysis
description: "This skill should be used when the user mentions 'waveform', 'VCD file', 'simulation results', 'signal trace', 'debug the output', 'what happened in sim', 'show me the waves', or 'analyze timing'. Provides VCD parsing, clock detection, anomaly identification, and signal tracing techniques."
version: 1.0.0
globs:
  - "**/*.vcd"
---

# VCD Waveform Analysis

Techniques for analyzing Value Change Dump (VCD) simulation waveforms.

## VCD File Structure

```
$timescale 1ns $end
$scope module tb $end
$var wire 1 ! clk $end
$var wire 8 " data [7:0] $end
$upscope $end
$enddefinitions $end

#0
0!
b00000000 "

#5
1!

#10
0!
b10101010 "
```

Key sections:
- `$timescale`: Time unit and precision
- `$scope/$upscope`: Module hierarchy
- `$var`: Signal definitions (type, width, identifier, name)
- `#<time>`: Timestamp markers
- Value changes: `0`/`1` for bits, `b<binary>` for vectors

## Analysis Workflow

1. **Identify time range**: Find simulation start/end times
2. **Locate clocks**: Find signals with regular toggling
3. **Find reset**: Locate reset assertion/deassertion
4. **Trace key signals**: Follow data from input to output
5. **Check anomalies**: Look for X/Z values, glitches, stuck signals

## Clock Detection

Identify clock signals by:
- **Name patterns**: `clk`, `clock`, `sysclk`, `pclk`
- **Regular transitions**: Consistent toggle frequency
- **50% duty cycle**: Equal high/low times

Calculate frequency:
```
Period = Time between rising edges
Frequency = 1 / Period
Duty Cycle = High time / Period × 100%
```

## Reset Sequence Analysis

Check reset behavior:
- **Assertion time**: When reset goes active
- **Duration**: How many clock cycles
- **Deassertion**: When reset releases
- **Synchronization**: Release aligned to clock?

Expected pattern:
```
Time 0ns:    rst_n = 0 (asserted)
Time 25ns:   rst_n = 1 (released after 2.5 clock cycles)
```

## Signal Tracing

For data signals, track:
- **When valid**: Check associated valid/enable signals
- **Setup time**: Data stable before clock edge
- **Hold time**: Data stable after clock edge
- **Propagation**: Delay from input to output

## Anomaly Detection

### X (Unknown) Values
- **Cause**: Uninitialized registers, multiple drivers
- **Location**: Usually after reset should clear
- **Fix**: Check reset initialization, driver conflicts

### Z (High-Impedance) Values
- **Cause**: Undriven signals, tri-state without enable
- **Location**: Should only appear on bidirectional buses
- **Fix**: Check all signal connections

### Glitches
- **Cause**: Combinational hazards, race conditions
- **Identification**: Multiple transitions between clock edges
- **Impact**: May cause spurious triggers in async logic

### Stuck Signals
- **Cause**: Undriven, reset not clearing, logic error
- **Identification**: Signal never changes from initial value
- **Check**: Is signal connected? Is reset reaching it?

## Timing Verification

### Clock-to-Q Delay
Time from clock edge to output change:
```
@(posedge clk)  →  data_out changes
      ↑                    ↑
      |______ delay _______|
```

### Setup Violations
Data changes too close to clock edge:
```
data_in changes at t=9.5ns
clock rises at t=10ns
Setup time = 0.5ns (may be too short!)
```

### State Machine Transitions
Track state register changes:
```
Time   State
0ns    IDLE
100ns  IDLE → LOAD  (start asserted)
150ns  LOAD → PROCESS
300ns  PROCESS → DONE
350ns  DONE → IDLE
```

## Common Patterns

### Data Transaction
```
     clk: _/‾\_/‾\_/‾\_/‾\_
   valid: ____/‾‾‾‾\________
   ready: ________/‾‾‾‾\____
    data: ----<VALID>--------
              ^
              Transaction occurs when valid && ready
```

### Pipeline Flow
```
Stage 0: data_in arrives
Stage 1: data_s1 = data_in (1 cycle later)
Stage 2: data_s2 = data_s1 (2 cycles later)
Output:  data_out = data_s2 (3 cycles total latency)
```
