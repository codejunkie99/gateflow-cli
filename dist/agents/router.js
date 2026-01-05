/**
 * Router Agent
 * Routes natural language queries to the appropriate specialized agent using agents-as-tools pattern
 */
import { Agent } from '@openai/agents-core';
import { getDefaultModel } from './index.js';
import { writeCodeAgent } from './writeCode.js';
import { readCodebaseAgent } from './readCodebase.js';
import { editCodeAgent } from './editCode.js';
import { lintFixAgent } from './lintFix.js';
import { testbenchAgent } from './testbench.js';
import { explainAgent } from './explain.js';
// Convert specialized agents to tools for the router
const writeCodeTool = writeCodeAgent.asTool({
    toolName: 'write_code',
    toolDescription: 'Generate new SystemVerilog/Verilog code from a specification. Use when user wants to CREATE new modules, counters, FSMs, or any new HDL design. Examples: "make a 4-bit counter", "create an adder", "design a UART module".'
});
const readCodebaseTool = readCodebaseAgent.asTool({
    toolName: 'read_codebase',
    toolDescription: 'Scan and analyze a codebase to understand its structure. Use when user wants to explore files, understand project structure, or find modules. Examples: "what files are in src/", "show me the project structure", "list all modules".'
});
const editCodeTool = editCodeAgent.asTool({
    toolName: 'edit_code',
    toolDescription: 'Modify existing SystemVerilog/Verilog code. Use when user wants to CHANGE, UPDATE, or ADD to existing code. Examples: "add a reset signal", "change the width to 16 bits", "add error checking".'
});
const lintFixTool = lintFixAgent.asTool({
    toolName: 'lint_fix',
    toolDescription: 'Lint and fix syntax errors in SystemVerilog/Verilog files. Use when user mentions errors, lint issues, or wants to check/fix code. Examples: "fix the errors in counter.sv", "lint my code", "there are syntax errors".'
});
const testbenchTool = testbenchAgent.asTool({
    toolName: 'generate_testbench',
    toolDescription: 'Generate a testbench for a SystemVerilog/Verilog module. Use when user wants to TEST or VERIFY a module, or explicitly asks for a testbench. Examples: "create a testbench for counter", "test this module", "generate tb".'
});
const explainTool = explainAgent.asTool({
    toolName: 'explain_code',
    toolDescription: 'Explain what SystemVerilog/Verilog code does. Use when user asks WHAT code does, HOW it works, or wants documentation. Examples: "what does this module do?", "explain the counter", "how does this work?".'
});
/**
 * Main router agent - routes user queries to specialized agents
 */
export const routerAgent = new Agent({
    name: 'GateFlowRouter',
    model: getDefaultModel(),
    instructions: `You are GateFlow, an AI assistant for SystemVerilog/Verilog hardware design.

You route user requests to specialized agents. Analyze each query and call the most appropriate tool.

## Available Tools

1. **write_code** - Generate NEW code from specifications
   - Keywords: create, make, generate, build, design, implement, new
   - Examples: "make a counter", "create an adder"

2. **read_codebase** - Explore and analyze existing files
   - Keywords: show, list, find, scan, what files, project structure
   - Examples: "show files in src/", "what's in this project"

3. **edit_code** - Modify EXISTING code
   - Keywords: add, change, modify, update, edit, remove, fix (when not syntax)
   - Examples: "add reset to counter.sv", "change width to 8"

4. **lint_fix** - Check and fix SYNTAX errors
   - Keywords: lint, syntax error, compile error, fix errors, verilator
   - Examples: "fix errors in counter.sv", "lint my code"

5. **generate_testbench** - Create testbenches
   - Keywords: testbench, tb, test, verify, stimulus
   - Examples: "create testbench for counter", "test this module"

6. **explain_code** - Explain what code does
   - Keywords: what does, how does, explain, describe, document
   - Examples: "what does counter.sv do?", "explain this code"

## Routing Rules

1. If user mentions a FILE PATH and an ACTION:
   - "fix errors in X.sv" → lint_fix
   - "add Y to X.sv" → edit_code
   - "explain X.sv" → explain_code
   - "testbench for X.sv" → generate_testbench

2. If user describes something NEW to create → write_code

3. If user asks about project/files → read_codebase

4. If user asks "what" or "how" about code → explain_code

5. If ambiguous, prefer:
   - write_code for new designs
   - edit_code if file exists and needs changes
   - explain_code for questions

## Response Style

After the specialized agent completes:
- Summarize what was done
- Note any files created/modified
- Suggest next steps if appropriate

Be helpful, concise, and natural. You're like Claude Code but for hardware design.`,
    tools: [
        writeCodeTool,
        readCodebaseTool,
        editCodeTool,
        lintFixTool,
        testbenchTool,
        explainTool
    ]
});
