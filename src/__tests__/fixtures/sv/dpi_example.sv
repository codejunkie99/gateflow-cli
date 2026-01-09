/**
 * Test Fixture: DPI (Direct Programming Interface)
 *
 * Tests:
 * - DPI imports (C functions called from SV)
 * - DPI exports (SV functions called from C)
 * - Context functions
 */

module dpi_example;

  // DPI import - pure function
  import "DPI-C" pure function int c_add(int a, int b);

  // DPI import - context function
  import "DPI-C" context function void c_display(string msg);

  // DPI import - function with various types
  import "DPI-C" function real c_sqrt(real x);

  // DPI import - returning void
  import "DPI-C" function void c_init();

  // DPI export - export SV function to C
  export "DPI-C" function sv_callback;

  // DPI export - another function
  export "DPI-C" function sv_get_status;

  // Local variables
  int result;
  real sqrt_val;

  // SV function to be called from C
  function int sv_callback(int value);
    return value * 2;
  endfunction

  function int sv_get_status();
    return result;
  endfunction

  // Usage example
  initial begin
    c_init();
    result = c_add(10, 20);
    sqrt_val = c_sqrt(2.0);
    c_display("DPI test complete");
  end

endmodule
