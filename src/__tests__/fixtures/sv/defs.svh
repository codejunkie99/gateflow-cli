/**
 * Test Fixture: Definitions Header
 *
 * This file tests preprocessor directive parsing:
 * - `define macros
 * - `ifdef/`ifndef conditions
 */

`ifndef DEFS_SVH
`define DEFS_SVH

// Width definitions
`define DEFAULT_WIDTH 8
`define DATA_WIDTH 32
`define ADDR_WIDTH 16

// Debug macro
`ifdef DEBUG
  `define LOG(msg) $display("[DEBUG] %s", msg)
`else
  `define LOG(msg)
`endif

// Timing constants
`define CLK_PERIOD 10ns
`define RESET_CYCLES 5

`endif // DEFS_SVH
