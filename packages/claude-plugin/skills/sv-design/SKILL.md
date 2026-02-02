---
name: SystemVerilog RTL Design
description: "Provides RTL design patterns, synthesis guidelines, and coding templates. Use when the user mentions 'module design', 'FSM', 'state machine', 'pipeline', 'synthesizable', 'parameterize', 'parameter', 'localparam', 'clock domain', 'CDC', 'FIFO', 'register file', 'always_ff', 'always_comb', 'generate', or asks about synthesis-related coding."
version: 1.0.0
---

# SystemVerilog RTL Design Reference

## Coding Standards

### Signal Declarations

```systemverilog
// Preferred: logic for all signals
logic [7:0] data;
logic       valid;

// Avoid: reg/wire (older style)
// reg [7:0] data;   // Don't use
// wire valid;        // Don't use
```

### Always Blocks

| Block Type | Use Case | Assignment |
|------------|----------|------------|
| `always_ff` | Sequential logic (flip-flops) | Non-blocking `<=` |
| `always_comb` | Combinational logic | Blocking `=` |
| `always_latch` | Latches (avoid!) | Blocking `=` |

```systemverilog
// Sequential - non-blocking
always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        q <= '0;
    else
        q <= d;
end

// Combinational - blocking
always_comb begin
    y = a & b;
    z = y | c;  // Uses updated y
end
```

## Design Patterns

### Parameterized Module

```systemverilog
module fifo #(
    parameter int WIDTH = 8,
    parameter int DEPTH = 16,
    parameter bit FWFT  = 1'b0  // First-word-fall-through
) (
    input  logic             clk,
    input  logic             rst_n,
    // Write interface
    input  logic [WIDTH-1:0] wr_data,
    input  logic             wr_en,
    output logic             full,
    // Read interface
    output logic [WIDTH-1:0] rd_data,
    input  logic             rd_en,
    output logic             empty
);
    localparam int ADDR_WIDTH = $clog2(DEPTH);

    // Memory array
    logic [WIDTH-1:0] mem [DEPTH];

    // Pointers
    logic [ADDR_WIDTH:0] wr_ptr, rd_ptr;  // Extra bit for full/empty

    // ... implementation
endmodule
```

### FSM with typedef enum

```systemverilog
typedef enum logic [2:0] {
    IDLE    = 3'b001,
    RUNNING = 3'b010,
    DONE    = 3'b100
} state_t;

state_t state, next_state;

// State register (sequential)
always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        state <= IDLE;
    else
        state <= next_state;
end

// Next state logic (combinational)
always_comb begin
    next_state = state;  // Default: hold
    unique case (state)
        IDLE:    if (start)    next_state = RUNNING;
        RUNNING: if (complete) next_state = DONE;
        DONE:    next_state = IDLE;
        default: next_state = IDLE;  // Safe default
    endcase
end

// Output logic (combinational)
always_comb begin
    busy = (state == RUNNING);
    done = (state == DONE);
end
```

### Pipeline Stage

```systemverilog
module pipeline_stage #(
    parameter int WIDTH = 32
) (
    input  logic             clk,
    input  logic             rst_n,
    // Upstream
    input  logic [WIDTH-1:0] data_in,
    input  logic             valid_in,
    output logic             ready_out,
    // Downstream
    output logic [WIDTH-1:0] data_out,
    output logic             valid_out,
    input  logic             ready_in
);

    // Handshake: transfer when valid && ready
    wire transfer_in  = valid_in  && ready_out;
    wire transfer_out = valid_out && ready_in;

    // Pipeline register
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            data_out  <= '0;
            valid_out <= 1'b0;
        end else if (transfer_in || transfer_out) begin
            data_out  <= data_in;
            valid_out <= valid_in;
        end
    end

    // Ready when empty or downstream accepts
    assign ready_out = !valid_out || ready_in;

endmodule
```

### Clock Domain Crossing (2FF Synchronizer)

```systemverilog
module sync_2ff #(
    parameter int WIDTH = 1,
    parameter int STAGES = 2
) (
    input  logic             clk_dst,
    input  logic             rst_n,
    input  logic [WIDTH-1:0] data_src,
    output logic [WIDTH-1:0] data_dst
);
    logic [WIDTH-1:0] sync_reg [STAGES];

    always_ff @(posedge clk_dst or negedge rst_n) begin
        if (!rst_n) begin
            for (int i = 0; i < STAGES; i++)
                sync_reg[i] <= '0;
        end else begin
            sync_reg[0] <= data_src;
            for (int i = 1; i < STAGES; i++)
                sync_reg[i] <= sync_reg[i-1];
        end
    end

    assign data_dst = sync_reg[STAGES-1];

endmodule
```

### Generate Blocks

```systemverilog
// Conditional generate
generate
    if (USE_BRAM) begin : gen_bram
        bram_module u_mem (...);
    end else begin : gen_lutram
        lutram_module u_mem (...);
    end
endgenerate

// Iterative generate
generate
    for (genvar i = 0; i < N; i++) begin : gen_stages
        pipeline_stage #(.WIDTH(WIDTH)) u_stage (
            .data_in (stage_data[i]),
            .data_out(stage_data[i+1]),
            ...
        );
    end
endgenerate
```

## Synthesis Guidelines

### Do's

| Pattern | Why |
|---------|-----|
| `always_ff` / `always_comb` | Clear intent to synthesis tools |
| `unique case` / `priority case` | Helps optimization, catches errors |
| `'0` / `'1` for reset values | Flexible width |
| Synchronous reset (FPGAs) | Uses flip-flop reset input |
| Named port connections | `.port(signal)` - readable, catches errors |

### Don'ts

| Anti-Pattern | Problem |
|--------------|---------|
| `initial` blocks | Not synthesizable (simulation only) |
| `#delays` | Not synthesizable |
| `force`/`release` | Not synthesizable |
| `fork`/`join` | Not synthesizable |
| Incomplete `case` | Infers latch |
| Missing `else` | May infer latch |
| Reading before writing in `always_comb` | Infers latch |

### Avoiding Latches

```systemverilog
// BAD - infers latch (missing else)
always_comb begin
    if (sel)
        y = a;
    // y not assigned when sel=0 -> LATCH
end

// GOOD - complete assignment
always_comb begin
    if (sel)
        y = a;
    else
        y = b;
end

// GOOD - default value first
always_comb begin
    y = '0;  // Default
    if (sel)
        y = a;
end
```

## Timing Patterns

### Registered Outputs

```systemverilog
// Register outputs to improve timing
always_ff @(posedge clk) begin
    data_out_reg <= internal_result;
end
assign data_out = data_out_reg;
```

### Pipelining for Timing Closure

```systemverilog
// Break long combinational paths with registers
// Before: a -> [long_logic] -> y

// After:
always_ff @(posedge clk) begin
    stage1 <= a;                    // Input register
    stage2 <= long_logic_part1;     // Pipeline register
    y      <= long_logic_part2;     // Output register
end
```

## Common Modules

| Module | Key Considerations |
|--------|-------------------|
| FIFO | Gray code pointers for CDC, full/empty flags |
| Arbiter | Fixed priority, round-robin, or weighted |
| Register File | Read-during-write behavior (bypass?) |
| Counter | Overflow handling, enable, load |
| Shift Register | Parallel load, serial in/out |
| Mux | One-hot select vs binary select |
| Encoder/Decoder | Priority vs non-priority |
