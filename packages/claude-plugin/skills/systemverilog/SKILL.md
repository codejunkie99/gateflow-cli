---
name: SystemVerilog Development
description: "This skill should be used when the user asks to 'design a module', 'write SystemVerilog', 'implement an FSM', 'create a pipeline', or works with .sv/.svh/.v/.vh files. Provides modern SV conventions, coding patterns, and synthesizability guidance."
version: 1.0.0
globs:
  - "**/*.sv"
  - "**/*.svh"
  - "**/*.v"
  - "**/*.vh"
---

# SystemVerilog Development

Provide expert guidance for SystemVerilog RTL design following IEEE 1800-2017 standards.

## Always Block Conventions

Use modern SystemVerilog constructs:

| Purpose | Construct | Pattern |
|---------|-----------|---------|
| Flip-flops | `always_ff` | `always_ff @(posedge clk or negedge rst_n)` |
| Combinational | `always_comb` | `always_comb begin ... end` |
| Latches (rare) | `always_latch` | `always_latch begin ... end` |

## Signal Types

- Use `logic` for all signals (replaces `wire` and `reg`)
- Use `typedef enum logic` for state machines
- Use `typedef struct packed` for grouped signals
- Always specify explicit widths

## Reset Convention

Active-low asynchronous reset is the standard pattern:

```systemverilog
always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
        data_reg <= '0;
    end else begin
        data_reg <= data_next;
    end
end
```

## Port Declarations

Use explicit port typing with ANSI-style declarations:

```systemverilog
module example #(
    parameter int WIDTH = 8
) (
    input  logic             clk,
    input  logic             rst_n,
    input  logic [WIDTH-1:0] data_in,
    output logic [WIDTH-1:0] data_out
);
```

## FSM Pattern

Use enumerated types with explicit encoding:

```systemverilog
typedef enum logic [1:0] {
    IDLE   = 2'b00,
    ACTIVE = 2'b01,
    DONE   = 2'b10
} state_t;

state_t state_reg, state_next;

always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) state_reg <= IDLE;
    else        state_reg <= state_next;
end

always_comb begin
    state_next = state_reg;
    unique case (state_reg)
        IDLE:   if (start) state_next = ACTIVE;
        ACTIVE: if (done)  state_next = DONE;
        DONE:   state_next = IDLE;
        default: state_next = IDLE;
    endcase
end
```

## Handshaking (Valid/Ready)

Standard flow control pattern:

```systemverilog
// Producer side
assign valid = data_available;
always_ff @(posedge clk) begin
    if (valid && ready) begin
        // Data accepted, advance to next
    end
end

// Consumer side
assign ready = can_accept;
always_ff @(posedge clk) begin
    if (valid && ready) begin
        captured_data <= data_in;
    end
end
```

## Pipeline Stage

Register data with associated valid signal:

```systemverilog
always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
        stage1_data  <= '0;
        stage1_valid <= 1'b0;
    end else begin
        stage1_data  <= stage0_data;
        stage1_valid <= stage0_valid;
    end
end
```

## Synthesizability Rules

Ensure all code is synthesizable:
- No `initial` blocks in RTL (testbench only)
- No `#` delays in RTL
- No `$display` or system tasks in RTL
- All signals driven in all paths (no latches unless intended)
- Use `unique case` or `priority case` with `default`

