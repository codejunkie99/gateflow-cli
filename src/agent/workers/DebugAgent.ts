/**
 * Debug Agent
 * Diagnoses and fixes simulation failures
 * Uses AI SDK 6 Agent interface with debug tools
 */

import type { Tool } from 'ai';
import type { WorkerProfile } from '../../types/agent-shared.js';
import { createAgent } from './workerFactory.js';

/**
 * Create debug agent with debugging tools
 */
export function createDebugAgent(tools: Record<string, Tool>): WorkerProfile {
    return createAgent({
        name: 'debug',
        role: 'Simulation Debugger',
        expertise: 'diagnosing hangs, mismatches, failures',
        constraints: [
            'Reproduce failure - identify root cause',
            'Propose minimal fix - avoid rewriting entire design',
            'Add instrumentation if needed (minimal $display points)',
            'Check reset sequencing, clocking, handshake protocols',
            'Validate fix with explicit verification step',
            'Focus on smallest plausible root cause'
        ],
        tools: {
            read_file: tools.read_file,
            edit_lines: tools.edit_lines,
            search_replace: tools.search_replace,
            lint_file: tools.lint_file,
            run_simulation: tools.run_simulation,
            search_code: tools.search_code
        },
        toolChoice: 'required',
        stepLimit: 15
    });
}

