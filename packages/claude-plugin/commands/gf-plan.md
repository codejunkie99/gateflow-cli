---
name: gf-plan
description: Plan and execute complex SystemVerilog tasks using multiple specialized agents working together.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Bash
  - Task
  - gateflow:gf_plan_complex_task
  - gateflow:gf_spawn_agent
  - gateflow:gf_parallel_agents
  - gateflow:gf_find_module
  - gateflow:gf_lint_file
argument-hint: "<task description>"
---

# GateFlow Plan Command

Plan and execute complex hardware tasks using multiple specialized agents.

## Instructions

When user invokes /gf-plan <task>:

### 1. Analyze the Task

Use `gf_plan_complex_task` to break down the task:

```
/gf-plan Create a UART module with transmit, receive, and testbench
```

The planner will suggest which agents to use:
- **sv-understanding**: First, analyze any existing code
- **sv-codegen**: Generate the UART TX and RX modules
- **sv-testbench**: Create comprehensive testbench
- **sv-debug**: Run lint and fix any errors

### 2. Execute with Multiple Agents

You can spawn agents **sequentially** or **in parallel**:

**Sequential** (when tasks depend on each other):
```
1. sv-understanding → Analyze existing serial protocols in codebase
2. sv-codegen → Generate UART module based on findings
3. sv-testbench → Create testbench for the new module
4. sv-debug → Lint check and fix errors
```

**Parallel** (when tasks are independent):
```
Run simultaneously:
- sv-codegen → Generate TX module
- sv-codegen → Generate RX module

Then:
- sv-testbench → Create testbench for both
```

### 3. Spawn Agents Using Task Tool

For each subtask, use the Task tool to spawn the appropriate agent:

```
Task tool call:
{
  "subagent_type": "gateflow:sv-codegen",
  "prompt": "Create a UART transmitter module with 8N1 format, configurable baud rate",
  "description": "Generate UART TX"
}
```

### 4. Parallel Execution

To run multiple agents in parallel, send **multiple Task tool calls in a single message**:

```
[Message with two Task calls]
1. Task: sv-codegen for TX module
2. Task: sv-codegen for RX module
```

Both will run simultaneously, reducing total time.

## Available Agents

| Agent | Best For | Example Tasks |
|-------|----------|---------------|
| **sv-understanding** | Analyzing code | "How does the existing SPI work?" |
| **sv-codegen** | Writing new RTL | "Create a FIFO module" |
| **sv-testbench** | Creating tests | "Write testbench for ALU" |
| **sv-debug** | Fixing errors | "Fix all lint warnings" |
| **sv-refactor** | Improving code | "Modernize to SystemVerilog" |

## Example Complex Tasks

### "Create a complete SPI master with testbench"
```
Plan:
1. [understanding] Check for existing SPI code or conventions
2. [codegen] Generate SPI master module
3. [codegen] Generate SPI slave for testing (parallel)
4. [testbench] Create comprehensive testbench
5. [debug] Lint and fix all modules
```

### "Refactor the legacy Verilog to modern SystemVerilog"
```
Plan:
1. [understanding] Analyze all legacy files
2. [refactor] Modernize each file (can parallelize)
3. [debug] Ensure no functional changes (lint clean)
4. [testbench] Verify behavior matches original
```

### "Debug why simulation is failing"
```
Plan:
1. [understanding] Trace the failing signal path
2. [debug] Identify root cause
3. [debug] Apply fix
4. [testbench] Add regression test
```

## Tips

- Start with `sv-understanding` for unfamiliar codebases
- Use parallel agents for independent modules
- Always end with `sv-debug` to ensure lint-clean code
- The planner suggests steps, but you can adjust based on context
