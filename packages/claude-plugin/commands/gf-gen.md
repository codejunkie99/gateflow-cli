---
name: gf-gen
description: Generate SystemVerilog module, testbench, or package from specifications.
allowed-tools:
  - Read
  - Write
  - Glob
  - gateflow:gf_find_module
  - gateflow:gf_lint_file
argument-hint: "<type> <name> [--output=<path>]"
---

# GateFlow Generate Command

Generate SystemVerilog code from specifications.

## Instructions

When user invokes /gf-gen <type> <name>:

### For Module Generation (`/gf-gen module <name>`)

Generate a synthesizable module with:

```systemverilog
module <name> #(
    parameter int WIDTH = 8
) (
    input  logic             clk,
    input  logic             rst_n,
    input  logic [WIDTH-1:0] data_in,
    output logic [WIDTH-1:0] data_out
);

// Internal signals
logic [WIDTH-1:0] data_reg;

// Sequential logic
always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
        data_reg <= '0;
    end else begin
        data_reg <= data_in;
    end
end

// Combinational output
always_comb begin
    data_out = data_reg;
end

endmodule
```

Features to include:
- Parameterized width
- Clock and active-low async reset
- Example always_ff and always_comb blocks
- Inline documentation comments

### For Testbench Generation (`/gf-gen testbench <name>`)

1. **Check if DUT exists** using `gf_find_module`
2. If found, read DUT to get interface
3. Generate testbench with:
   - Clock generation (100MHz default)
   - Reset sequence (3 cycles)
   - DUT instantiation with explicit connections
   - Waveform dumping ($dumpfile/$dumpvars)
   - Basic test stimulus
   - $finish at completion

### For Package Generation (`/gf-gen package <name>`)

Generate package with:

```systemverilog
package <name>_pkg;

// Type definitions
typedef enum logic [1:0] {
    STATE_IDLE   = 2'b00,
    STATE_ACTIVE = 2'b01,
    STATE_DONE   = 2'b10
} state_t;

// Constants
localparam int DATA_WIDTH = 8;
localparam int ADDR_WIDTH = 16;

// Utility function
function automatic logic [7:0] reverse_bits(input logic [7:0] data);
    for (int i = 0; i < 8; i++) begin
        reverse_bits[i] = data[7-i];
    end
endfunction

endpackage
```

## Arguments

- `type` (required): `module`, `testbench`, or `package`
- `name` (required): Name for the generated entity
- `--output` (optional): Output file path (default: `<name>.sv`)

## Post-Generation

After generating:
1. Run `/gf-lint` on the new file to verify
2. Show the generated code
3. Offer to customize (add ports, modify parameters)
