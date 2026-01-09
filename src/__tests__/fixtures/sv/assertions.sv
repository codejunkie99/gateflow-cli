/**
 * Test Fixture: SystemVerilog Assertions (SVA)
 *
 * Tests:
 * - Sequence declarations
 * - Property declarations
 * - Assert/assume/cover statements
 * - Clocking blocks
 */

module assertions_example (
  input  logic clk,
  input  logic rst_n,
  input  logic req,
  input  logic ack,
  input  logic valid,
  input  logic ready,
  input  logic [7:0] data
);

  // Simple sequence
  sequence req_ack_seq;
    req ##[1:5] ack;
  endsequence

  // Sequence with arguments
  sequence handshake_seq(sig_valid, sig_ready);
    sig_valid ##[0:3] sig_ready;
  endsequence

  // Sequence with local variable
  sequence data_stable_seq;
    logic [7:0] captured_data;
    (valid, captured_data = data) ##1 (data == captured_data)[*1:4];
  endsequence

  // Simple property
  property req_eventually_ack_p;
    @(posedge clk) disable iff (!rst_n)
    req |-> ##[1:10] ack;
  endproperty

  // Property using sequence
  property handshake_complete_p;
    @(posedge clk) disable iff (!rst_n)
    req_ack_seq |-> ##1 valid;
  endproperty

  // Property with implication
  property valid_then_stable_p;
    @(posedge clk) disable iff (!rst_n)
    valid |-> data == $past(data) || $rose(valid);
  endproperty

  // Clocking block for testbench
  clocking cb @(posedge clk);
    default input #1step output #1ns;
    input  req, ack, valid;
    output ready;
    inout  data;
  endclocking

  // Default clocking
  default clocking default_cb @(posedge clk);
    input req, ack;
  endclocking

  // Assertions
  assert property (req_eventually_ack_p)
    else $error("Request not acknowledged within 10 cycles");

  assume property (valid_then_stable_p);

  cover property (handshake_complete_p);

  // Immediate assertions
  always @(posedge clk) begin
    if (rst_n) begin
      assert (!(valid && !ready))
        else $warning("Valid asserted when not ready");
    end
  end

  // Concurrent assertions with labels
  REQ_ACK_CHECK: assert property (req_eventually_ack_p);
  HANDSHAKE_COV: cover property (handshake_complete_p);

endmodule
