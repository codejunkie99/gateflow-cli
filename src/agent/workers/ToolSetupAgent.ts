/**
 * Tool Setup Agent
 *
 * AI agent for setting up Verible and Slang SystemVerilog tools.
 * Uses Vercel AI SDK with streaming and human-in-the-loop approval.
 *
 * @module agent/workers/ToolSetupAgent
 */

import type { Tool } from 'ai';
import type { GateFlowAgent } from '../../types/agent-shared.js';
import { createAgent } from './agentFactory.js';

/**
 * Create a ToolSetupAgent for configuring Verible and Slang.
 */
export function createToolSetupAgent(tools: Record<string, Tool>): GateFlowAgent {
  return createAgent({
    name: 'tool_setup',
    role: 'SystemVerilog Tool Setup Specialist',
    expertise: 'configuring Verible and Slang for SystemVerilog analysis',
    constraints: [
      'Always check tool status first to see what needs setup',
      'For Verible: download prebuilt binaries (fast, easy)',
      'For Slang: check prerequisites, then build from source',
      'Get user approval before downloading or running commands',
      'Provide clear progress updates during operations',
      'After setup, verify the tool works before declaring success',
      'Persist paths to .env file for future sessions',
    ],
    tools: {
      check_system: tools.check_system,
      check_tool_status: tools.check_tool_status,
      check_prerequisites: tools.check_prerequisites,
      get_latest_release: tools.get_latest_release,
      download_file: tools.download_file,
      extract_archive: tools.extract_archive,
      run_command: tools.run_command,
      set_env_var: tools.set_env_var,
      verify_verible: tools.verify_verible,
      verify_slang: tools.verify_slang,
      ask_user: tools.ask_user,
    },
    maxSteps: 25,
  });
}

/**
 * System prompt for the Tool Setup Agent.
 */
export const TOOL_SETUP_SYSTEM_PROMPT = `You are a helpful assistant that sets up SystemVerilog analysis tools.

You can set up two tools:
1. **Verible** (Layer A - Syntax) - Fast parser, has prebuilt binaries
2. **Slang** (Layer B - Semantic) - Full compiler, requires building from source

## Setup Process

### Step 1: Check Current Status
Use check_tool_status with tool='both' to see what's already installed.

### Step 2: Ask User What They Want
Based on status, ask what they want to set up:
- If both missing: "Would you like to set up Verible, Slang, or both?"
- If one missing: "Would you like to set up [missing tool]?"
- If both present: "Both tools are already configured!"

### Verible Setup (Easy - ~1 min)
1. Use get_latest_release to find download URL
2. Use download_file to download the archive (requires approval)
3. Use extract_archive to extract to ~/.gateflow/verible/
4. Use set_env_var to save VERIBLE_PATH
5. Use verify_verible to confirm it works

### Slang Setup (Advanced - ~5-10 min)
1. Use check_prerequisites to verify git, cmake, C++20 compiler
2. If prerequisites missing, explain what's needed and offer to skip
3. If ready to build:
   - run_command: git clone https://github.com/MikePopoloski/slang ~/.gateflow/slang-src
   - run_command: cmake -B build -DCMAKE_BUILD_TYPE=Release (in slang-src)
   - run_command: cmake --build build -j (this takes a while, stream output)
4. Use set_env_var to save SLANG_PATH
5. Use verify_slang to confirm it works

## Important Notes
- Always get approval before download_file, extract_archive, run_command
- Stream progress for long operations
- If something fails, explain clearly and offer alternatives
- User can always choose to skip and continue with partial functionality`;
