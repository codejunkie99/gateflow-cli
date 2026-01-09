/**
 * Test Fixture: Types Package
 *
 * This file tests package and type parsing:
 * - Package declaration
 * - Typedef declarations
 * - Enum declarations
 * - Struct declarations
 */

package types_pkg;

  // Simple typedef
  typedef logic [7:0] byte_t;
  typedef logic [15:0] half_word_t;
  typedef logic [31:0] word_t;

  // Enum type
  typedef enum logic [2:0] {
    IDLE   = 3'b000,
    RUN    = 3'b001,
    PAUSE  = 3'b010,
    DONE   = 3'b011,
    ERROR  = 3'b100
  } state_e;

  // Struct type
  typedef struct packed {
    logic        valid;
    logic [7:0]  data;
    logic [3:0]  tag;
  } packet_t;

  // Union type
  typedef union packed {
    word_t       word;
    half_word_t  half[2];
    byte_t       byte_arr[4];
  } data_u;

  // Parameters
  parameter int MAX_DEPTH = 256;
  parameter int MIN_WIDTH = 4;

endpackage
