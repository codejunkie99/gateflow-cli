---
name: SystemVerilog Testbench Patterns
description: "This skill should be used when the user asks to 'write a testbench', 'test this module', 'add assertions', 'create test stimulus', 'verify the design', 'add clock generation', or 'write a self-checking test'. Provides testbench templates, clock/reset patterns, and assertion guidance."
version: 1.0.0
---

# SystemVerilog Testbench Patterns

Templates and patterns for verification code.

## Testbench Structure

Every testbench needs these components:
1. Timescale declaration
2. DUT instantiation
3. Clock generation
4. Reset sequence
5. Waveform dumping
6. Test stimulus
7. Self-checking (optional)
8. Test completion

## Standard Template

```systemverilog
`timescale 1ns/1ps

module tb_<dut_name>;

// Match DUT parameters
parameter int WIDTH = 8;

// Testbench signals (directly match DUT ports)
logic             clk;
logic             rst_n;
logic [WIDTH-1:0] data_in;
logic             valid_in;
logic [WIDTH-1:0] data_out;
logic             valid_out;

// DUT instantiation - explicit port connections
<dut_name> #(
    .WIDTH(WIDTH)
) dut (
    .clk      (clk),
    .rst_n    (rst_n),
    .data_in  (data_in),
    .valid_in (valid_in),
    .data_out (data_out),
    .valid_out(valid_out)
);

// Clock: 100MHz (10ns period, 5ns half-period)
initial begin
    clk = 1'b0;
    forever #5 clk = ~clk;
end

// Reset: Assert for 3 cycles, then release
initial begin
    rst_n = 1'b0;
    repeat (3) @(posedge clk);
    rst_n = 1'b1;
    $display("[%0t] Reset released", $time);
end

// Waveform capture
initial begin
    $dumpfile("tb_<dut_name>.vcd");
    $dumpvars(0, tb_<dut_name>);
end

// Test stimulus
initial begin
    // Initialize all inputs
    data_in  = '0;
    valid_in = 1'b0;

    // Wait for reset release
    @(posedge rst_n);
    repeat (2) @(posedge clk);

    // Test 1: Basic operation
    $display("[%0t] Test 1: Basic operation", $time);
    @(posedge clk);
    data_in  = 8'hAA;
    valid_in = 1'b1;
    @(posedge clk);
    valid_in = 1'b0;
    repeat (5) @(posedge clk);

    // Test 2: Edge case
    $display("[%0t] Test 2: Edge case", $time);
    data_in = 8'hFF;
    valid_in = 1'b1;
    @(posedge clk);
    valid_in = 1'b0;
    repeat (5) @(posedge clk);

    // End simulation
    $display("[%0t] All tests completed", $time);
    $finish;
end

// Self-checking assertions
always @(posedge clk) begin
    if (rst_n && valid_out) begin
        assert (data_out !== 'x)
            else $error("[%0t] data_out is X when valid", $time);
    end
end

endmodule
```

## Clock Generation Patterns

```systemverilog
// Fixed frequency
initial begin
    clk = 0;
    forever #5 clk = ~clk;  // 100MHz
end

// Parameterized period
parameter real CLK_PERIOD = 10.0;
initial begin
    clk = 0;
    forever #(CLK_PERIOD/2) clk = ~clk;
end

// Multiple clocks
initial begin
    clk_fast = 0;
    clk_slow = 0;
    fork
        forever #2.5 clk_fast = ~clk_fast;  // 200MHz
        forever #5   clk_slow = ~clk_slow;  // 100MHz
    join
end
```

## Reset Patterns

```systemverilog
// Active-low async reset
initial begin
    rst_n = 1'b0;
    repeat (3) @(posedge clk);
    @(negedge clk);  // Release on falling edge
    rst_n = 1'b1;
end

// Reset task for re-use
task automatic apply_reset(int cycles = 3);
    rst_n = 1'b0;
    repeat (cycles) @(posedge clk);
    rst_n = 1'b1;
    @(posedge clk);
endtask
```

## Stimulus Tasks

```systemverilog
// Write transaction
task automatic write_data(input [7:0] data);
    @(posedge clk);
    data_in  <= data;
    valid_in <= 1'b1;
    @(posedge clk);
    valid_in <= 1'b0;
endtask

// Wait for condition with timeout
task automatic wait_for_done(input int timeout_cycles = 100);
    int count = 0;
    while (!done && count < timeout_cycles) begin
        @(posedge clk);
        count++;
    end
    assert (done) else $error("Timeout waiting for done");
endtask

// Randomized stimulus
task automatic random_test(input int num_transactions);
    for (int i = 0; i < num_transactions; i++) begin
        write_data($urandom);
        repeat ($urandom_range(1, 5)) @(posedge clk);
    end
endtask
```

## Assertions

```systemverilog
// Immediate assertion
always @(posedge clk) begin
    if (rst_n) begin
        assert (!$isunknown(data_out))
            else $error("Output has X/Z values");
    end
end

// Concurrent assertion - valid followed by ready
assert property (@(posedge clk) disable iff (!rst_n)
    valid |-> ##[1:3] ready
) else $error("Ready not asserted within 3 cycles");

// Sequence checking
sequence handshake;
    valid ##1 ready ##1 !valid;
endsequence

assert property (@(posedge clk) handshake);
```

## Test Completion

```systemverilog
// With summary
int test_count = 0;
int pass_count = 0;
int fail_count = 0;

final begin
    $display("\n========== Test Summary ==========");
    $display("Total:  %0d", test_count);
    $display("Passed: %0d", pass_count);
    $display("Failed: %0d", fail_count);
    if (fail_count == 0)
        $display("STATUS: PASSED");
    else
        $display("STATUS: FAILED");
    $display("==================================\n");
end
```
