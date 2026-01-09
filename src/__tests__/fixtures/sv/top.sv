/**
 * Test Fixture: Top-Level Module
 *
 * This file tests:
 * - Import statements
 * - Module instantiation with parameters
 * - Port connections
 * - Hierarchy building
 */

`include "defs.svh"

module top
  import types_pkg::*;
#(
  parameter NUM_COUNTERS = 4
)(
  input  logic clk,
  input  logic rst_n,
  output logic [`DATA_WIDTH-1:0] result
);

  // Local signals
  logic [`DEFAULT_WIDTH-1:0] counter_out [NUM_COUNTERS];
  state_e current_state;
  packet_t data_packet;

  // Instantiate counters
  genvar i;
  generate
    for (i = 0; i < NUM_COUNTERS; i++) begin : gen_counters
      counter #(
        .WIDTH(`DEFAULT_WIDTH),
        .INIT_VALUE(i)
      ) u_counter (
        .clk(clk),
        .rst_n(rst_n),
        .enable(1'b1),
        .count(counter_out[i])
      );
    end
  endgenerate

  // State machine
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      current_state <= IDLE;
    end else begin
      case (current_state)
        IDLE:  current_state <= RUN;
        RUN:   current_state <= PAUSE;
        PAUSE: current_state <= DONE;
        DONE:  current_state <= IDLE;
        default: current_state <= ERROR;
      endcase
    end
  end

  // Output logic
  assign result = {counter_out[3], counter_out[2], counter_out[1], counter_out[0]};

endmodule
