/**
 * Test Fixture: Class Hierarchy and OOP Features
 *
 * Tests:
 * - Virtual classes
 * - Class inheritance (extends)
 * - Constraints
 * - Covergroups
 * - Functions and tasks in classes
 */

// Base transaction class
virtual class base_transaction;
  rand bit [7:0] addr;
  rand bit [31:0] data;
  bit valid;

  // Constraint
  constraint addr_range_c {
    addr inside {[8'h00:8'hFF]};
  }

  constraint data_align_c {
    data[1:0] == 2'b00;
  }

  // Pure virtual function
  pure virtual function void display();

  // Regular function
  function bit is_valid();
    return valid;
  endfunction

  // Task
  task reset();
    addr = 0;
    data = 0;
    valid = 0;
  endtask

endclass

// Read transaction extends base
class read_transaction extends base_transaction;
  rand bit [3:0] burst_len;

  constraint burst_c {
    burst_len inside {1, 2, 4, 8};
  }

  // Covergroup
  covergroup read_cg;
    addr_cp: coverpoint addr {
      bins low  = {[0:63]};
      bins mid  = {[64:191]};
      bins high = {[192:255]};
    }
    burst_cp: coverpoint burst_len {
      bins single = {1};
      bins multi  = {[2:8]};
    }
  endgroup

  function new();
    read_cg = new();
  endfunction

  virtual function void display();
    $display("READ: addr=%h data=%h burst=%d", addr, data, burst_len);
  endfunction

endclass

// Write transaction extends base
class write_transaction extends base_transaction;
  rand bit [3:0] strobe;
  rand bit last;

  constraint strobe_c {
    strobe != 4'b0000;
  }

  // Covergroup with cross coverage
  covergroup write_cg;
    strobe_cp: coverpoint strobe;
    last_cp: coverpoint last;
    strobe_last_cross: cross strobe_cp, last_cp;
  endgroup

  function new();
    write_cg = new();
  endfunction

  virtual function void display();
    $display("WRITE: addr=%h data=%h strobe=%b last=%b", addr, data, strobe, last);
  endfunction

endclass

// Parameterized class
class fifo #(type T = int, int DEPTH = 8);
  T storage [DEPTH];
  int head, tail;

  function void push(T item);
    storage[tail] = item;
    tail = (tail + 1) % DEPTH;
  endfunction

  function T pop();
    T item = storage[head];
    head = (head + 1) % DEPTH;
    return item;
  endfunction

endclass
