/**
 * Test Fixture: Simple Counter Module
 *
 * This file tests basic module parsing with:
 * - Module declaration with parameters
 * - Port declarations (input/output)
 * - Signal declarations
 * - Module instantiation
 */

`include "defs.svh"

module counter #(
  parameter WIDTH = 8,
  parameter INIT_VALUE = 0
)(
  input  logic clk,
  input  logic rst_n,
  input  logic enable,
  output logic [WIDTH-1:0] count
);

  // Internal signals
  logic [WIDTH-1:0] next_count;

  // Sequential logic
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      count <= INIT_VALUE;
    end else if (enable) begin
      count <= next_count;
    end
  end

  // Combinational logic
  always_comb begin
    next_count = count + 1'b1;
  end

endmodule
