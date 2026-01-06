# GateFlow Multi-Agent System

This document describes the GateFlow CLI's multi-agent architecture, specialized agents, and how to extend the system.

## Overview

GateFlow uses a **multi-agent orchestration system** that automatically coordinates specialized worker agents for complex tasks. Simple queries are handled by a single agent, while complex requests trigger planning and multi-step execution.

```
┌─────────────────────────────────────────────────────────────┐
│                     User Query                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Complexity Detection (AI SDK)                   │
│    "Does this need multi-agent coordination?"                │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
   Simple Request                    Complex Request
          │                                 │
          ▼                                 ▼
┌──────────────────┐           ┌─────────────────────────┐
│  AI Routing      │           │   Planning Agent        │
│  generateObject()│           │   ExecutionPlanSchema   │
└──────────────────┘           └─────────────────────────┘
          │                                 │
          ▼                                 ▼
┌──────────────────┐           ┌─────────────────────────┐
│  Single Worker   │           │   Sequential Execution  │
│  Agent           │           │   (dependency order)    │
└──────────────────┘           └─────────────────────────┘
```

## Specialized Worker Agents

### 1. Understanding Agent

**Purpose**: Read and analyze existing SystemVerilog code.

**Use Cases**:
- "What does this module do?"
- "Trace the dependencies of counter"
- "Show me the FSM states"
- "List all modules in the project"

**Tools**: `read_file`, `find_module`, `search_code`, `get_dependencies`, `list_files`

**Constraints**:
- Never modify files
- Always cite specific file/line references
- Trace dependency chains completely

---

### 2. Code Generation Agent

**Purpose**: Create new synthesizable SystemVerilog modules.

**Use Cases**:
- "Create a 4-bit counter"
- "Generate an AXI-Lite slave"
- "Write a FIFO module"
- "Implement a UART receiver"

**Tools**: `write_file`, `read_file`, `lint_file`, `find_module`

**Constraints**:
- Use always_ff/always_comb appropriately
- Provide predictable reset behavior
- Document assumptions in comments
- Lint after generation

---

### 3. Testbench Agent

**Purpose**: Generate verification code and testbenches.

**Use Cases**:
- "Generate a testbench for counter"
- "Create stimulus for the ALU"
- "Write a self-checking TB"

**Tools**: `read_file`, `write_file`, `find_module`, `run_simulation`

**Constraints**:
- **CRITICAL**: Declare ALL variables at module scope
- Read DUT first to understand interface
- Include clock gen, reset, DUT instantiation
- Add $dumpfile/$dumpvars for waveforms
- Add $finish at end

---

### 4. Debug Agent

**Purpose**: Diagnose simulation failures and mismatches.

**Use Cases**:
- "Why does simulation hang?"
- "Debug the assertion failure"
- "Find root cause of mismatch"

**Tools**: `read_file`, `lint_file`, `run_simulation`, `search_code`

**Constraints**:
- Categorize failure type first (compile/runtime/hang/X-prop)
- Propose minimal instrumentation
- Provide "how to confirm" validation
- Don't rewrite to make tests pass

---

### 5. Refactoring Agent

**Purpose**: Modify existing code with minimal changes.

**Use Cases**:
- "Add a reset signal"
- "Rename signal clk to sys_clk"
- "Change counter width to 16 bits"
- "Remove unused port"

**Tools**: `read_file`, `edit_lines`, `search_replace`, `lint_file`

**Constraints**:
- Preserve module interfaces unless explicitly asked
- Make smallest possible diff
- Keep naming consistent
- Avoid mixing cosmetic and functional changes

---

## Orchestrator

The `Orchestrator` class in `src/agent/orchestrator/Orchestrator.ts` coordinates agents.

### Simple Request Routing

For straightforward requests, the orchestrator uses AI-powered routing:

```typescript
const routing = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: AgentRoutingSchema,
    prompt: `Route this request to the best agent:
        Request: "${userRequest}"
        
        Available agents:
        - understanding: For reading/analyzing existing code
        - codegen: For creating new SystemVerilog modules
        - testbench: For generating testbenches
        - debug: For diagnosing simulation failures
        - refactoring: For modifying existing code`
});
```

### Complex Request Planning

For multi-step requests, the orchestrator creates an execution plan:

```typescript
const plan = await createPlan(userRequest, projectContext);

// Plan structure:
{
    planType: 'multi_file',
    tasks: [
        { id: 'task1', agent: 'understanding', description: '...' },
        { id: 'task2', agent: 'codegen', description: '...', dependencies: ['task1'] },
        { id: 'task3', agent: 'testbench', description: '...', dependencies: ['task2'] }
    ],
    estimatedSteps: 15,
    confidence: 0.85
}
```

Tasks are executed in dependency order - tasks with no dependencies first, then tasks whose dependencies have completed.

## Thinking Visibility

The `ThinkingChain` class provides visibility into agent reasoning.

### Categories

| Category | Description | Example |
|----------|-------------|---------|
| `analyzing` | Reading/understanding code | "Reading counter.sv to understand interface" |
| `planning` | Creating execution plans | "Planning multi-file testbench generation" |
| `generating` | Creating new content | "Generating tb_counter.sv" |
| `verifying` | Running lint/simulation | "Linting generated module" |
| `fixing` | Applying corrections | "Fixing width mismatch error" |
| `decomposing` | Breaking down tasks | "Splitting into 3 subtasks" |
| `coordinating` | Multi-agent handoff | "Delegating to testbench agent" |

### AI SDK Integration

ThinkingChain hooks into AI SDK's `onStepFinish` callback:

```typescript
const result = await streamText({
    // ...
    onStepFinish: (step) => {
        thinkingChain.onStepFinish(step);
    }
});
```

Step categorization is automatic based on:
- Tool calls made in the step
- Text patterns in the response
- Current agent context

## Agent Factory

All agents are created via the factory pattern:

```typescript
// src/agent/workers/agentFactory.ts
export function createAgent(config: AgentConfig): GateFlowAgent {
    const builder = new PromptBuilder()
        .addBase(AGENT_BASE_PROMPT)
        .addRole(config.role)
        .addExpertise(config.expertise);
    
    config.constraints.forEach(c => builder.addConstraint(c));
    
    return {
        name: config.name,
        system: builder.build(),
        tools: config.tools,
        maxSteps: config.maxSteps || 10,
        toolChoice: 'auto'
    };
}
```

## Prompt Modes (Legacy)

The single-agent flow still supports prompt modes for backward compatibility:

| Mode | Trigger | Behavior |
|------|---------|----------|
| `general` | Default | Exploration and questions |
| `lint_fix` | "lint", "fix error", hasErrors | Minimal error fixes |
| `testbench` | "testbench", "tb_" | TB generation |
| `debug` | "debug", "simulation fail" | Failure diagnosis |
| `edit` | "edit", "modify", "change" | Targeted edits |
| `generate` | "create", "generate", "new module" | New RTL creation |

Mode detection happens in `src/agent/prompts.ts`:

```typescript
function detectMode(query: string, context: DetectModeContext): PromptMode {
    if (context.hasErrors) return 'lint_fix';
    if (query.includes('testbench')) return 'testbench';
    // ... more rules
    return 'general';
}
```

## Extending the System

### Adding a New Worker Agent

1. **Create the agent file** in `src/agent/workers/`:

```typescript
// src/agent/workers/MyNewAgent.ts
import { createAgent, type ToolSet } from './agentFactory.js';

export function createMyNewAgent(tools: ToolSet) {
    return createAgent({
        name: 'mynew',
        role: 'Expert in specific domain',
        expertise: 'Detailed expertise description',
        constraints: [
            'Specific constraint 1',
            'Specific constraint 2'
        ],
        tools: filterTools(tools, ['read_file', 'write_file', 'lint_file']),
        maxSteps: 15
    });
}
```

2. **Export from index** in `src/agent/workers/index.ts`:

```typescript
export { createMyNewAgent } from './MyNewAgent.js';
```

3. **Register with orchestrator** in `src/agent/core.ts`:

```typescript
this.orchestrator.registerWorker('mynew', createMyNewAgent(tools));
```

4. **Update routing schema** in `src/types/agent-shared.ts`:

```typescript
export const AgentRoutingSchema = z.object({
    selectedAgent: z.enum([
        'understanding', 'codegen', 'testbench', 
        'debug', 'refactoring', 'mynew'  // Add here
    ]),
    // ...
});
```

5. **Update orchestrator prompt** in `src/agent/orchestrator/Orchestrator.ts`:

```typescript
Available agents:
- understanding: For reading/analyzing existing code
- codegen: For creating new SystemVerilog modules
// ...
- mynew: For specific domain tasks  // Add description
```

### Customizing Agent Behavior

Override the default factory:

```typescript
export function createCustomCodegenAgent(tools: ToolSet) {
    return createAgent({
        name: 'codegen',
        role: 'Expert SystemVerilog RTL designer',
        expertise: `Specializes in:
            - AXI bus interfaces
            - Low-power design techniques
            - FPGA-specific optimizations`,
        constraints: [
            'Always use synchronous resets',
            'Target Xilinx 7-series FPGAs',
            'Use DSP48 for multipliers'
        ],
        tools: filterTools(tools, [...]),
        maxSteps: 20
    });
}
```

### Adding Planning Rules

Modify `src/agent/workers/PlanningAgent.ts`:

```typescript
prompt: `Create an execution plan:

User Request: ${userRequest}

Guidelines:
- Identify dependencies before proposing edits
- Consider compilation order (packages → modules → top)
- Check if files exist before reading
- NEW: Always lint after code generation
- NEW: Run simulation for testbench tasks
`
```

## Debugging

### Agent Selection

The orchestrator logs routing decisions:

```typescript
// In Orchestrator.ts
this.bus.emit({
    type: 'delegation',
    from: 'orchestrator',
    to: routing.selectedAgent,
    taskType: 'routing'
});
```

Watch for `delegation` events in verbose mode.

### Task Execution

Each task emits start/complete events:

```typescript
this.bus.emit({ type: 'agent_start', agentName: 'codegen', task: '...' });
// ... execution ...
this.bus.emit({ type: 'agent_complete', agentName: 'codegen', success: true });
```

### Thinking Steps

Enable thinking visibility:

```json
// .gaterc.json
{
    "ux": {
        "showThinking": true,
        "showThinkingConfidence": true
    }
}
```

## Files Reference

| File | Purpose |
|------|---------|
| `src/agent/core.ts` | GateFlowAgent, session, complexity detection |
| `src/agent/orchestrator/Orchestrator.ts` | Multi-agent coordination |
| `src/agent/workers/agentFactory.ts` | Agent creation factory |
| `src/agent/workers/*.ts` | Individual agent definitions |
| `src/agent/workers/PlanningAgent.ts` | Execution plan generation |
| `src/agent/prompts/PromptBuilder.ts` | Composable prompt construction |
| `src/agent/reasoning/ThinkingChain.ts` | Reasoning visibility |
| `src/types/agent-shared.ts` | Zod schemas, interfaces |

## Best Practices

1. **Query specificity**: "Create a testbench for counter.sv" routes better than "test it"

2. **Complex vs simple**: Multi-file operations automatically trigger planning

3. **Agent selection**: Trust the AI routing - it considers query semantics

4. **Debugging**: Use verbose mode (`-v`) to see agent decisions

5. **Custom agents**: Start by copying an existing agent and modifying constraints
