/**
 * Testbench Agent
 * Generates robust SystemVerilog testbenches
 * Uses AI SDK 6 Agent interface with verification tools
 */

import type { Tool } from 'ai';
import type { WorkerProfile } from '../../types/agent-shared.js';
import { createAgent } from './workerFactory.js';

/**
 * Create testbench agent with verification tools
 */
export function createTestbenchAgent(tools: Record<string, Tool>): WorkerProfile {
    return createAgent({
        name: 'testbench',
        role: 'Verification Engineer',
        expertise: 'creating testbenches, assertions, stimulus',
        constraints: [
            'Variables declared at module scope (NOT in initial blocks)',
            'Include timescale directive',
            'Generate clock with appropriate period',
            'Include reset task or sequence',
            'Add basic assertions or scoreboard',
            'Use $dumpfile/$dumpvars for waveform capture',
            'Finish with $finish',
            'Include directed tests and corner cases',
            'Keep testbench simple - avoid UVM unless explicitly requested'
        ],
        tools: {
            read_file: tools.read_file,
            write_file: tools.write_file,
            find_module: tools.find_module,
            get_dependencies: tools.get_dependencies,
            run_simulation: tools.run_simulation
        },
        toolChoice: 'required',
        stepLimit: 12
    });
}

