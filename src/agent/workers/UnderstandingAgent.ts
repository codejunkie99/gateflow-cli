/**
 * Understanding Agent
 * Reads and analyzes SystemVerilog code files
 * Uses AI SDK 6 Agent interface with analysis tools
 */

import type { Tool } from 'ai';
import type { WorkerProfile } from '../../types/agent-shared.js';
import { createAgent } from './workerFactory.js';

/**
 * Create understanding agent with analysis tools
 */
export function createUnderstandingAgent(tools: Record<string, Tool>): WorkerProfile {
    return createAgent({
        name: 'understanding',
        role: 'Code Analysis Specialist',
        expertise: 'reading, parsing, understanding SystemVerilog code',
        constraints: [
            'Use tools to read files - do not guess code',
            'Identify patterns and extract semantics',
            'Provide structured analysis with modules, signals, interfaces, state machines',
            'Trace dependencies between modules',
            'Understand code structure and intent',
            'Do not write or modify files; describe findings only'
        ],
        tools: {
            read_file: tools.read_file,
            find_module: tools.find_module,
            search_code: tools.search_code,
            get_dependencies: tools.get_dependencies,
            find_all_sv_files: tools.find_all_sv_files,
            list_files: tools.list_files
        },
        stepLimit: 15,
        toolChoice: 'required'
    });
}
