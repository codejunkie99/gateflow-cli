---
name: SystemVerilog Lint Fixing
description: "This skill should be used when the user mentions 'lint error', 'width mismatch', 'inferred latch', 'undriven signal', 'fix warnings', 'Verilator error', 'WIDTHTRUNC', 'BLKSEQ', or asks to 'check my code' or 'find errors'. Provides error-specific fix patterns for SystemVerilog lint issues."
version: 1.0.0
---

# SystemVerilog Lint Fix Patterns

Error-specific fix patterns for common SystemVerilog lint issues.

## WIDTHTRUNC / WIDTHEXPAND

**Message**: Width mismatch in assignment

**Diagnosis**: Signal widths don't match between source and destination.

**Fixes**:
```systemverilog
// Truncation (wide to narrow) - explicit slice
logic [15:0] wide;
logic [7:0]  narrow;
assign narrow = wide[7:0];

// Extension (narrow to wide) - zero extend
assign wide = {8'b0, narrow};

// Sign extension
assign wide = {{8{narrow[7]}}, narrow};

// Using $bits for dynamic width
assign narrow = wide[$bits(narrow)-1:0];
```

## LATCH

**Message**: Latch inferred for signal

**Diagnosis**: Combinational block doesn't assign signal in all paths.

**Fixes**:
```systemverilog
// Add default assignment at block start
always_comb begin
    out = '0;  // Default prevents latch
    if (sel) begin
        out = in_a;
    end
    // No else needed - default covers it
end

// Complete case statement
always_comb begin
    unique case (sel)
        2'b00: out = a;
        2'b01: out = b;
        2'b10: out = c;
        default: out = '0;  // Explicit default
    endcase
end
```

## UNDRIVEN

**Message**: Signal is not driven

**Diagnosis**: Signal declared but never assigned a value.

**Fixes**:
```systemverilog
// Option 1: Connect to appropriate source
assign undriven_sig = source_sig;

// Option 2: Remove if truly unused
// Delete the declaration

// Option 3: Tie off if intentionally unused
assign unused_input = '0;
```

## UNUSED

**Message**: Signal/variable is unused

**Fixes**:
```systemverilog
// Option 1: Remove declaration entirely

// Option 2: Use lint pragma for intentional cases
/* verilator lint_off UNUSED */
logic debug_signal;
/* verilator lint_on UNUSED */

// Option 3: Prefix with underscore (convention)
logic _unused_port;
```

## CASEINCOMPLETE

**Message**: Case statement does not cover all values

**Fix**: Add default case
```systemverilog
unique case (state)
    IDLE:   next_state = start ? ACTIVE : IDLE;
    ACTIVE: next_state = done ? DONE : ACTIVE;
    DONE:   next_state = IDLE;
    default: next_state = IDLE;  // Required
endcase
```

## BLKSEQ

**Message**: Blocking assignment in sequential block

**Fix**: Use non-blocking for sequential logic
```systemverilog
// Wrong
always_ff @(posedge clk) begin
    data = new_data;  // Blocking - bad
end

// Correct
always_ff @(posedge clk) begin
    data <= new_data;  // Non-blocking - good
end
```

## COMBDLY

**Message**: Delayed assignment in combinational block

**Fix**: Remove delays from combinational logic
```systemverilog
// Wrong
always_comb begin
    out = #1 in_a & in_b;  // Delay - not synthesizable
end

// Correct
always_comb begin
    out = in_a & in_b;
end
```

## MULTIDRIVEN

**Message**: Signal driven from multiple always blocks

**Fix**: Consolidate drivers or use separate signals
```systemverilog
// Wrong - multiple drivers
always_ff @(posedge clk) data <= a;
always_ff @(posedge clk) data <= b;

// Correct - single driver with mux
always_ff @(posedge clk) begin
    data <= sel ? a : b;
end
```

## Fix Workflow

1. Read error message and line number
2. Identify error category from above
3. Apply appropriate fix pattern
4. Re-run lint to verify
5. Check for cascading errors from the fix
