/**
 * Test Fixture: Checker and Bind Constructs
 *
 * Tests:
 * - Checker declaration
 * - Checker instantiation
 * - Bind statement
 */

// Checker for protocol validation
checker protocol_checker (
  logic clk,
  logic rst_n,
  logic valid,
  logic ready,
  logic [7:0] data
);

  // Default clocking
  default clocking @(posedge clk);
  endclocking

  // Sequence for valid handshake
  sequence valid_handshake;
    valid ##[0:5] ready;
  endsequence

  // Property: valid must be acknowledged
  property valid_ack_p;
    valid |-> ##[1:10] ready;
  endproperty

  // Property: data stable during valid
  property data_stable_p;
    valid && !ready |=> $stable(data);
  endproperty

  // Assertions
  a_valid_ack: assert property (valid_ack_p);
  a_data_stable: assert property (data_stable_p);

  // Coverage
  c_handshake: cover property (valid_handshake);

endchecker

// Module to be checked
module target_module (
  input  logic clk,
  input  logic rst_n,
  input  logic valid,
  output logic ready,
  input  logic [7:0] data
);

  logic ready_reg;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      ready_reg <= 0;
    end else begin
      ready_reg <= valid;
    end
  end

  assign ready = ready_reg;

endmodule

// Testbench with bind
module tb_bind;

  logic clk, rst_n, valid, ready;
  logic [7:0] data;

  // DUT instantiation
  target_module dut (
    .clk(clk),
    .rst_n(rst_n),
    .valid(valid),
    .ready(ready),
    .data(data)
  );

  // Bind checker to target module
  bind target_module protocol_checker checker_inst (
    .clk(clk),
    .rst_n(rst_n),
    .valid(valid),
    .ready(ready),
    .data(data)
  );

  // Clock generation
  initial begin
    clk = 0;
    forever #5 clk = ~clk;
  end

endmodule
