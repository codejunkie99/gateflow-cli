# GateFlow Agent System

This document describes the GateFlow CLI agent architecture, prompt modes, and how to extend the system.

## Overview

GateFlow uses a single AI agent (`GateFlowAgent`) with **dynamic prompt modes** that adapt the system prompt based on the detected task. This provides specialized behavior for different operations while keeping the architecture simple.

```
┌─────────────────────────────────────────────────────────────┐
│                     User Query                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   detectMode()                              │
│  Analyzes query text + context to select appropriate mode   │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ general  │    │ lint_fix │    │ testbench│  ... etc
    └──────────┘    └──────────┘    └──────────┘
          │                │                │
          └────────────────┼────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               GateFlowAgent.run()                           │
│  Uses mode-specific system prompt + shared tools            │
└─────────────────────────────────────────────────────────────┘
```

## Prompt Modes

### 1. `general` (default)
**Purpose**: Codebase exploration, understanding, general questions.

**Triggered by**: Default when no other mode matches.

**Key behaviors**:
- Uses tools to read/search files before answering
- Explains findings with evidence from the codebase
- Proposes minimal changes when edits are requested

**Example queries**:
- "What modules are in this project?"
- "How does the counter work?"
- "Show me the FSM states"

---

### 2. `lint_fix`
**Purpose**: Fix Verilator/lint errors with minimal targeted changes.

**Triggered by**:
- Query contains: `lint`, `verilator`, `fix error`, `compile error`, `syntax error`
- Context has `hasErrors: true` (from previous lint)
- Command is `lint` or `fix`

**Key behaviors**:
- Reads ALL errors first to identify root cause
- Prefers declaration/import fixes over logic changes
- Applies minimal, surgical edits
- Adds TODO comments when uncertain

**Example queries**:
- "Fix the lint errors"
- "Fix the undeclared signal error"
- "Why is Verilator complaining about width mismatch?"

---

### 3. `testbench`
**Purpose**: Generate structured, runnable testbenches.

**Triggered by**:
- Query contains: `testbench`, `test bench`, `tb_`, `stimulus`, `scoreboard`
- Command is `generate` and query mentions testbench

**Key behaviors**:
- Declares ALL variables at module scope (critical rule)
- Reads DUT module first to understand interface
- Includes clock gen, reset sequence, DUT instantiation
- Adds waveform dump and $finish

**Example queries**:
- "Generate a testbench for counter"
- "Create tb for the ALU"
- "Write stimulus for my FSM"

---

### 4. `debug`
**Purpose**: Diagnose simulation failures, mismatches, hangs.

**Triggered by**:
- Query contains: `debug`
- Query contains `simulation` + (`fail`, `hang`, `mismatch`)
- Query contains: `$fatal`, `assertion`

**Key behaviors**:
- Categorizes failure type (compile, runtime, hang, X-prop)
- Inspects reset sequencing, clocking, handshakes
- Proposes minimal instrumentation ($display, assertions)
- Provides "how to confirm" validation step

**Example queries**:
- "Debug why the simulation hangs"
- "Why is my output wrong?"
- "The assertion fired at time 100ns"

---

### 5. `edit`
**Purpose**: Targeted code modifications preserving intent.

**Triggered by**:
- Query contains: `edit`, `modify`, `change`, `update`, `refactor`, `add a`, `remove`

**Key behaviors**:
- Makes smallest possible diff
- Preserves module interfaces
- Avoids cosmetic formatting mixed with functional changes
- States exactly what changes and why

**Example queries**:
- "Add a reset signal to this module"
- "Change the counter width to 16 bits"
- "Remove the unused output port"

---

### 6. `generate`
**Purpose**: Create new synthesizable RTL from scratch.

**Triggered by**:
- Query contains: `create`, `generate`, `new module`, `write a module`, `implement a`
- Command is `generate` (unless testbench)

**Key behaviors**:
- Generates clean, synthesizable SystemVerilog
- Uses always_ff/always_comb appropriately
- Provides predictable reset behavior
- Documents assumptions in comments/TODOs

**Example queries**:
- "Create a 4-bit counter"
- "Generate an AXI-Lite slave"
- "Write a FIFO module"

---

## Mode Detection Logic

The `detectMode()` function in `cli/src/agent/prompts.ts` uses a priority-ordered keyword classifier:

```typescript
function detectMode(query: string, context: DetectModeContext): PromptMode {
    // 1. Context overrides (highest priority)
    if (context.hasErrors) return 'lint_fix';
    if (context.command === 'lint') return 'lint_fix';
    if (context.command === 'generate') {
        if (query.includes('testbench')) return 'testbench';
        return 'generate';
    }

    // 2. Keyword detection (order matters!)
    // - lint_fix keywords
    // - testbench keywords (before generate!)
    // - debug keywords
    // - edit keywords
    // - generate keywords
    // - default: general
}
```

**Important**: Testbench detection happens BEFORE generate detection because "generate testbench" is a common phrase.

---

## Shared Rules

All modes include `SHARED_RULES` which enforces:

1. **No hallucination**: Never invent file contents, ports, or error logs
2. **Minimal changes**: Prefer smallest diff that solves the task
3. **Preserve intent**: Add TODOs when uncertain
4. **Dependency order**: Handle files in order (package → module → top → testbench)
5. **SystemVerilog style**: always_ff/always_comb, proper reset, explicit widths
6. **Anti-patterns**: Avoid blocking in sequential, missing defaults, latches

---

## Session State

The agent tracks state across turns:

```typescript
interface AgentSession {
    messages: CoreMessage[];     // Conversation history
    currentMode: PromptMode;     // Active mode
    hasErrors: boolean;          // True if lint errors detected
    turnCount: number;
    toolCallCount: number;
}
```

The `hasErrors` flag is set when `lint_file` tool returns errors, automatically routing subsequent queries to `lint_fix` mode.

---

## Extending the System

### Adding a New Mode

1. **Define the prompt** in `cli/src/agent/prompts.ts`:
```typescript
const NEW_MODE = `${SHARED_RULES}
## Mode: NEW_MODE (purpose)

### Primary Objectives
...

### Workflow
...
`;
```

2. **Add to registry**:
```typescript
export const SYSTEM_PROMPTS: Record<PromptMode, string> = {
    // ... existing modes
    new_mode: NEW_MODE,
};
```

3. **Update type**:
```typescript
export type PromptMode =
    | 'general'
    // ... existing modes
    | 'new_mode';
```

4. **Add detection keywords** in `detectMode()`:
```typescript
if (q.includes('new_keyword')) {
    return 'new_mode';
}
```

### Forcing a Mode

You can force a specific mode by passing it to `agent.run()`:

```typescript
await agent.run(query, { mode: 'lint_fix' });
```

This bypasses auto-detection.

### Mode Context

Pass additional context to influence detection:

```typescript
await agent.run(query, {
    modeContext: {
        hasErrors: true,
        command: 'generate'
    }
});
```

---

## Files

| File | Purpose |
|------|---------|
| `cli/src/agent/prompts.ts` | Prompt library, mode types, detection logic |
| `cli/src/agent/core.ts` | GateFlowAgent class, run loop, session state |
| `cli/src/agent/tools.ts` | Tool definitions and executors |
| `cli/src/verification/fix-loop.ts` | Iterative lint-fix cycle (uses lint_fix mode) |
| `cli/src/cli/commands.ts` | CLI commands (generate uses mode-specific prompts) |

---

## Debugging Mode Selection

The agent logs the selected mode in the status message:

```
[lint_fix] Processing...
```

If queries are being routed incorrectly, check:
1. Query text - does it contain expected keywords?
2. Context - is `hasErrors` set? Is a `command` specified?
3. Priority order - is another mode matching first?

---

## Best Practices

1. **Be specific in queries**: "Fix the undeclared signal error in counter.sv" routes better than "fix it"

2. **Use explicit mode for fix loops**: The FixLoop always forces `lint_fix` mode

3. **Testbench generation**: Always reads DUT first - make sure the DUT file exists

4. **Edit mode**: Specify what to change, not just "make it better"

5. **Debug mode**: Include the error message or simulation output in your query

