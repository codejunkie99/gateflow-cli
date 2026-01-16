/**
 * Code Generation Agent
 * Creates new SystemVerilog modules from specifications
 * Uses AI SDK 6 Agent interface with generation tools
 */

import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
import { createAgent } from './agentFactory.js';

/**
 * Create code generation agent with generation tools
 */
export function createCodeGenAgent(tools: Record<string, Tool>): GateFlowAgent {
    return createAgent({
        name: 'codegen',
        role: 'RTL Designer',
        expertise: 'generating synthesizable SystemVerilog code',
        constraints: [
            'Use SystemVerilog constructs (always_ff, always_comb)',
            'Avoid inferred latches - set defaults in always_comb',
            'Use explicit widths - avoid unsized constants',
            'Document assumptions in header comments',
            'Generate clean, synthesizable code',
            'Follow project style guidelines'
        ],
        tools: {
            read_file: tools.read_file,
            write_file: tools.write_file,
            find_module: tools.find_module,
            get_dependencies: tools.get_dependencies
        },
        toolChoice: 'required',
        maxSteps: 10
    });
}

