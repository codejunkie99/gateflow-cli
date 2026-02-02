---
name: SystemVerilog Verification
description: "Provides verification methodology, SVA assertion patterns, coverage techniques, and testbench templates. Use when the user mentions 'testbench', 'assertion', 'SVA', 'property', 'sequence', 'coverage', 'covergroup', 'coverpoint', 'bins', 'cross coverage', 'constrained random', 'randomize', 'constraint', 'simulate', 'waveform', 'VCD', '$display', '$finish', or 'self-checking'."
version: 1.0.0
---

# SystemVerilog Verification Reference

## SVA (SystemVerilog Assertions)

### Assertion Types

| Type | Use Case | Example |
|------|----------|---------|
| Immediate | Procedural checks | `assert (a == b) else $error("mismatch");` |
| Concurrent | Temporal sequences | `assert property (@(posedge clk) req |-> ##[1:5] ack);` |

### Temporal Operators

```systemverilog
// Sequence operators
##N        // Delay N cycles
##[M:N]    // Delay M to N cycles
##[0:$]    // Eventually (use sparingly - unbounded)

// Property operators
|->        // Overlapping implication (same cycle)
|=>        // Non-overlapping implication (next cycle)
not        // Property negation
and        // Both properties must hold
or         // Either property must hold
```

### Common Assertion Patterns

```systemverilog
// 1. Request-Acknowledge handshake
property p_req_ack;
    @(posedge clk) disable iff (!rst_n)
    req |-> ##[1:5] ack;
endproperty

// 2. Mutual exclusion
property p_mutex;
    @(posedge clk) disable iff (!rst_n)
    !(grant_a && grant_b);
endproperty

// 3. One-hot state encoding
property p_onehot_state;
    @(posedge clk) disable iff (!rst_n)
    $onehot(state);
endproperty

// 4. Data stability during valid
property p_data_stable;
    @(posedge clk) disable iff (!rst_n)
    (valid && !ready) |=> $stable(data);
endproperty

// 5. FIFO overflow protection
property p_no_overflow;
    @(posedge clk) disable iff (!rst_n)
    full |-> !wr_en;
endproperty

// 6. Counter bounds
property p_counter_bounds;
    @(posedge clk) disable iff (!rst_n)
    count <= MAX_VALUE;
endproperty
```

### System Functions for Assertions

```systemverilog
$rose(sig)       // Signal rose this cycle
$fell(sig)       // Signal fell this cycle
$stable(sig)     // Signal unchanged
$changed(sig)    // Signal changed
$past(sig, N)    // Value N cycles ago
$onehot(vec)     // Exactly one bit set
$onehot0(vec)    // At most one bit set
$isunknown(sig)  // Contains X or Z
$countones(vec)  // Number of 1s
```

## Coverage

### Covergroup Structure

```systemverilog
covergroup cg_name @(posedge clk);
    option.per_instance = 1;
    option.goal = 100;

    // Basic coverpoint
    cp_state: coverpoint state {
        bins idle   = {IDLE};
        bins active = {ACTIVE};
        bins done   = {DONE};
        illegal_bins bad = {INVALID};
    }

    // Range bins
    cp_data: coverpoint data {
        bins zero    = {0};
        bins low     = {[1:63]};
        bins mid     = {[64:191]};
        bins high    = {[192:254]};
        bins max     = {255};
    }

    // Transition bins
    cp_state_trans: coverpoint state {
        bins t1 = (IDLE => ACTIVE);
        bins t2 = (ACTIVE => DONE);
        bins t3 = (DONE => IDLE);
    }

    // Cross coverage
    cross_state_valid: cross cp_state, valid;
endgroup
```

### Coverage Best Practices

1. **Goal setting**: Set realistic goals (90-100%)
2. **Meaningful bins**: Cover interesting ranges, not just random values
3. **Illegal bins**: Mark invalid states to catch bugs
4. **Transition coverage**: Important for FSMs
5. **Cross coverage**: Test combinations that matter

## Testbench Architecture

### Recommended Structure

```
tb_top
├── Clock/Reset Generation
├── DUT Instance
├── Interface Connections
├── Stimulus (initial block or tasks)
├── Assertions (properties)
├── Coverage (covergroups)
└── Result Checking (scoreboard)
```

### Useful Tasks

```systemverilog
// Reset task
task automatic apply_reset(int cycles = 5);
    rst_n = 0;
    repeat(cycles) @(posedge clk);
    rst_n = 1;
    @(posedge clk);
endtask

// Wait for condition with timeout
task automatic wait_for(ref logic condition, int timeout = 1000);
    fork
        begin
            wait(condition);
        end
        begin
            repeat(timeout) @(posedge clk);
            $error("Timeout waiting for condition");
        end
    join_any
    disable fork;
endtask

// Randomized delay
task automatic random_delay(int min_cycles, int max_cycles);
    int delay;
    delay = $urandom_range(max_cycles, min_cycles);
    repeat(delay) @(posedge clk);
endtask
```

## Constrained Random

```systemverilog
class Transaction;
    rand bit [7:0] data;
    rand bit [3:0] addr;
    rand bit       write;

    // Constraints
    constraint c_addr {
        addr inside {[0:10]};  // Valid address range
    }

    constraint c_data_special {
        data dist {
            0       := 10,     // 10% weight for 0
            [1:254] := 80,     // 80% weight for middle
            255     := 10      // 10% weight for max
        };
    }
endclass

// Usage
Transaction tx = new();
repeat(100) begin
    assert(tx.randomize());
    // Use tx.data, tx.addr, tx.write
end
```

## Debug Tips

### VCD File Generation
```systemverilog
initial begin
    $dumpfile("simulation.vcd");
    $dumpvars(0, tb_top);        // Dump all signals
    // OR selective:
    $dumpvars(1, tb_top.u_dut);  // Only DUT, 1 level deep
end
```

### Useful Display Formats
```systemverilog
$display("Time=%0t data=0x%h valid=%b", $time, data, valid);
$monitor("@%0t: state=%s", $time, state.name());
$strobe("End of timestep: count=%0d", count);  // After NBA
```

### Waveform Markers
```systemverilog
// Add markers for key events
always @(posedge error_flag)
    $display("=== ERROR at %0t ===", $time);
```
