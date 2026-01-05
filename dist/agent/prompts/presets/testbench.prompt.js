/**
 * Testbench Generation Preset
 */
import { PromptBuilder } from '../PromptBuilder.js';
export function buildTestbenchPrompt(moduleSpec) {
    return new PromptBuilder()
        .addBase()
        .addRole('Verification Engineer', 'creating robust SystemVerilog testbenches')
        .addConstraint([
        'Generate standalone, runnable testbench',
        'Include timescale directive',
        'Generate clock with appropriate period',
        'Include reset task or sequence',
        'Add basic assertions or scoreboard',
        'Use $dumpfile/$dumpvars for waveform capture',
        'Finish with $finish',
        'Variables declared at module scope (NOT in initial blocks)',
        'Include directed tests and corner cases',
        'Keep testbench simple - avoid UVM unless explicitly requested'
    ])
        .addTask(`Generate testbench for module: ${moduleSpec.name || 'unknown'}`)
        .addContext({
        code: moduleSpec.code
    })
        .addExample('Simple clocked testbench', `module tb_${moduleSpec.name || 'dut'}();
  parameter CLK_PERIOD = 10;
  
  logic clk;
  logic rst;
  // DUT ports...
  
  ${moduleSpec.name || 'dut'} dut (.*);
  
  always #(CLK_PERIOD/2) clk = ~clk;
  
  initial begin
    rst = 1;
    #20 rst = 0;
  end
  
  // Test cases...
  
  initial begin
    $dumpfile("${moduleSpec.name || 'dut'}.vcd");
    $dumpvars(0, dut);
  end
  
endmodule`, 'Note: Variables declared at module scope, clock generated in always block')
        .enableThinking()
        .setOutputFormat({
        format: 'text',
        description: 'Complete SystemVerilog testbench file'
    })
        .build();
}
