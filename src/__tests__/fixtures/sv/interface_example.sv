/**
 * Test Fixture: Interface Example
 *
 * This file tests:
 * - Interface declaration
 * - Modport declarations
 * - Interface instantiation
 */

interface axi_lite_if #(
  parameter ADDR_WIDTH = 32,
  parameter DATA_WIDTH = 32
)(
  input logic clk,
  input logic rst_n
);

  // Write address channel
  logic [ADDR_WIDTH-1:0] awaddr;
  logic                   awvalid;
  logic                   awready;

  // Write data channel
  logic [DATA_WIDTH-1:0] wdata;
  logic [DATA_WIDTH/8-1:0] wstrb;
  logic                   wvalid;
  logic                   wready;

  // Write response channel
  logic [1:0]             bresp;
  logic                   bvalid;
  logic                   bready;

  // Read address channel
  logic [ADDR_WIDTH-1:0] araddr;
  logic                   arvalid;
  logic                   arready;

  // Read data channel
  logic [DATA_WIDTH-1:0] rdata;
  logic [1:0]             rresp;
  logic                   rvalid;
  logic                   rready;

  // Modports
  modport master (
    output awaddr, awvalid, wdata, wstrb, wvalid, bready, araddr, arvalid, rready,
    input  awready, wready, bresp, bvalid, arready, rdata, rresp, rvalid
  );

  modport slave (
    input  awaddr, awvalid, wdata, wstrb, wvalid, bready, araddr, arvalid, rready,
    output awready, wready, bresp, bvalid, arready, rdata, rresp, rvalid
  );

endinterface

// Module using the interface
module axi_slave (
  axi_lite_if.slave axi
);

  always_ff @(posedge axi.clk or negedge axi.rst_n) begin
    if (!axi.rst_n) begin
      axi.awready <= 1'b0;
      axi.wready  <= 1'b0;
    end else begin
      axi.awready <= 1'b1;
      axi.wready  <= 1'b1;
    end
  end

endmodule
