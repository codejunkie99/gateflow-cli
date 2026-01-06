## GateFlow CLI Architecture (v2)

This document explains how the GateFlow CLI is structured so you can extend it safely.

## High-level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     User Query                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Complexity Detection (AI SDK)                   │
│         generateObject() with ComplexityDetectionSchema      │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
   ┌──────────────┐                ┌──────────────────┐
   │ Simple Query │                │  Complex Query   │
   │ Single Agent │                │   Orchestrator   │
   └──────────────┘                └──────────────────┘
          │                                 │
          ▼                                 ▼
┌─────────────────┐           ┌─────────────────────────┐
│   streamText()  │           │   Planning Agent        │
│   with tools    │           │   Creates ExecutionPlan │
└─────────────────┘           └─────────────────────────┘
                                            │
                                            ▼
                              ┌─────────────────────────┐
                              │   Worker Agents         │
                              │   Execute tasks in      │
                              │   dependency order      │
                              └─────────────────────────┘
```

## Core Components

### 1. Entry Point: `src/cli/main.ts`

- Parses CLI args (Commander)
- Loads `.env` from multiple locations
- Dispatches to commands

### 2. Command Context: `src/cli/commands.ts`

Creates a unified context including:
- `EventBus` for all UI events
- `PolicyEngine` for safety checks
- `FileTools` and `EditTools`
- `ProjectIndexer` for module discovery
- `DiffEngine` for previews
- `Verilator` wrapper

### 3. Agent System: `src/agent/`

#### Core Agent: `src/agent/core.ts`

`GateFlowAgent` orchestrates the AI interaction:

```typescript
class GateFlowAgent {
    private orchestrator: Orchestrator;
    private session: AgentSession;
    
    async run(userMessage: string): Promise<string> {
        // 1. Detect complexity using AI
        const { object: complexity } = await generateObject({
            schema: ComplexityDetectionSchema,
            prompt: `Does this need multi-agent coordination?`
        });
        
        // 2. Route to orchestrator or single-agent flow
        if (complexity.needsMultiAgent) {
            return this.orchestrator.executeWithPlan(userMessage);
        }
        
        // 3. Single-agent: streamText with tools
        return streamText({ ... });
    }
}
```

#### Orchestrator: `src/agent/orchestrator/Orchestrator.ts`

Coordinates multiple specialized agents:

1. **Simple routing**: Uses `generateObject()` with `AgentRoutingSchema` to pick the best agent
2. **Complex planning**: Creates an `ExecutionPlan` via Planning Agent
3. **Task execution**: Runs tasks in dependency order with worker agents

```typescript
class Orchestrator {
    private workers: Map<string, GateFlowAgent>;
    
    async execute(userRequest: string): Promise<string> {
        // AI-powered routing to best agent
        const routing = await generateObject({ schema: AgentRoutingSchema });
        const worker = this.workers.get(routing.selectedAgent);
        return worker.run(routing.taskDescription);
    }
    
    async executeWithPlan(userRequest: string): Promise<string> {
        // Multi-step execution with planning
        const plan = await createPlan(userRequest);
        for (const task of sortByDependencies(plan.tasks)) {
            await this.workers.get(task.agent).run(task.description);
        }
    }
}
```

#### Worker Agents: `src/agent/workers/`

Specialized agents created via factory pattern:

| Agent | Role | Tools Focus |
|-------|------|-------------|
| `understanding` | Code analysis | `read_file`, `find_module`, `search_code` |
| `codegen` | New RTL creation | `write_file`, `lint_file` |
| `testbench` | Verification code | `write_file`, `read_file`, `run_simulation` |
| `debug` | Failure diagnosis | `read_file`, `lint_file`, `run_simulation` |
| `refactoring` | Code modification | `edit_lines`, `search_replace` |

#### Agent Factory: `src/agent/workers/agentFactory.ts`

```typescript
function createAgent(config: AgentConfig): GateFlowAgent {
    return {
        name: config.name,
        system: new PromptBuilder()
            .addRole(config.role)
            .addExpertise(config.expertise)
            .addConstraints(config.constraints)
            .build(),
        tools: config.tools,
        maxSteps: config.maxSteps || 10,
        toolChoice: 'auto'
    };
}
```

### 4. Prompt System: `src/agent/prompts/`

#### PromptBuilder: Composable Prompts

```typescript
const prompt = new PromptBuilder()
    .addBase('You are GateFlow...')
    .addRole('SystemVerilog expert')
    .addConstraint('Never invent file contents')
    .addTask('Generate a counter module')
    .build();
```

#### Presets: `src/agent/prompts/presets/`

- `general.prompt.ts` - Exploration mode
- `lintFix.prompt.ts` - Error fixing
- `testbench.prompt.ts` - TB generation

### 5. Thinking Chain: `src/agent/reasoning/ThinkingChain.ts`

Tracks agent reasoning for visibility:

```typescript
class ThinkingChain {
    // Hooks into AI SDK's onStepFinish callback
    onStepFinish(step: StepResult): void {
        const category = this.categorizeStep(step);
        this.bus.emit({
            type: 'thought',
            category,
            thought: step.text
        });
    }
}
```

Categories: `analyzing`, `planning`, `generating`, `verifying`, `fixing`, `decomposing`, `coordinating`

## Event System: `src/events/`

### Event Types

```typescript
type UiEvent =
    // Streaming
    | TokenEvent | TokenDoneEvent
    // Status
    | StatusEvent
    // Tools
    | ToolCallEvent | ToolResultEvent
    // Approvals
    | DiffPreviewEvent | ApprovalRequestEvent | ApprovalResponseEvent
    // Multi-agent
    | AgentStartEvent | AgentCompleteEvent | DelegationEvent
    // Thinking
    | ThinkingStepEvent
    // ...more
```

### EventBus

Simple pub/sub for decoupling:

```typescript
bus.emit({ type: 'agent_start', agentName: 'codegen', task: '...' });
bus.subscribe(event => renderer.handle(event));
```

## Tool System: `src/agent/tools.ts`

### Tool Catalog

All tools defined with AI SDK's `tool()` helper:

```typescript
const tools = {
    read_file: tool({
        description: 'Read a SystemVerilog file',
        parameters: z.object({ path: z.string() }),
        execute: async ({ path }) => ctx.fileTools.readFile(path)
    }),
    // ... 9 tools total
};
```

### Available Tools

| Tool | Purpose | Returns |
|------|---------|---------|
| `read_file` | Read file contents | `{ content, lines }` |
| `write_file` | Create/overwrite file | `{ path, created }` |
| `edit_lines` | Line-based edits | `{ applied, stats }` |
| `search_replace` | Pattern replacement | `{ replacements }` |
| `list_files` | Directory listing | `{ files[] }` |
| `search_code` | Regex search | `{ matches[] }` |
| `find_module` | Module lookup | `{ name, file, ports }` |
| `get_dependencies` | Dependency graph | `{ compilationOrder }` |
| `lint_file` | Verilator lint | `{ errors, warnings }` |
| `run_simulation` | Simulate design | `{ success, stdout }` |

## File Operations: `src/fileops/`

### FileTools: `src/fileops/file.ts`

- Safe path resolution (project root enforcement)
- SV-focused file scanning
- Code search with regex sanitization

### EditTools: `src/fileops/edit.ts`

- Line-based editing
- Search/replace with diff preview
- Policy-aware (requires approval for writes)

## Policy System: `src/approval/`

### PolicyEngine

Enforces safety contracts:

```typescript
class PolicyEngine {
    async checkTool(toolName: string, args: any): Promise<ApprovalResult> {
        // Path safety (inside project root)
        // Tool-specific rules (read vs write)
        // User approval if required
    }
}
```

### Approval Flow

1. Tool requests approval via `PolicyEngine`
2. `DiffPreviewEvent` emitted for visual diff
3. `ApprovalRequestEvent` prompts user
4. User responds: `Y` (once), `A` (all), `N` (reject), `S` (skip)

## Project Indexer: `src/indexer/`

### ProjectIndexer

Regex-based index for fast module discovery:

```typescript
interface ModuleInfo {
    name: string;
    file: string;
    line: number;
    ports: Port[];
    parameters: Parameter[];
    instantiates: string[];
}
```

Features:
- Incremental updates on file changes
- Dependency graph building
- Include path resolution

## Verification: `src/verification/`

### Verilator Integration

```typescript
class Verilator {
    async lint(file: string): Promise<LintResult>;
    async simulate(top: string, options): Promise<SimResult>;
}
```

- WSL support on Windows (auto-detects Unix paths)
- Error parsing with file/line extraction
- VCD file generation for waveforms

### Fix Loop: `src/verification/fix-loop.ts`

Iterative lint-fix cycle:

1. Lint file
2. Ask agent to propose fixes
3. Show diff, require approval
4. Apply changes
5. Re-lint until clean or thrashing detected

## UI Renderer: `src/ui/renderer.ts`

Handles all visual output:

- Token streaming (60fps buffered)
- Spinner management
- Diff previews (colorized)
- Approval prompts
- Agent lifecycle events
- Thinking step display

## Type System: `src/types/agent-shared.ts`

### Zod Schemas

```typescript
// AI routing decisions
const AgentRoutingSchema = z.object({
    selectedAgent: z.enum(['understanding', 'codegen', 'testbench', 'debug', 'refactoring']),
    taskDescription: z.string(),
    reasoning: z.string()
});

// Execution planning
const ExecutionPlanSchema = z.object({
    planType: z.enum(['single_file', 'multi_file', 'analysis_only']),
    tasks: z.array(TaskSchema),
    estimatedSteps: z.number(),
    confidence: z.number()
});
```

## Configuration: `src/config/`

### ConfigManager

Loads from multiple locations:

1. `~/.gateflowrc.json` (user global)
2. `.gaterc.json` (project root)
3. Environment variables

```typescript
interface GateFlowConfig {
    llm: { model, maxTokens, temperature };
    tools: { safeMode, autoApprove };
    project: { includePaths, excludePaths };
    ux: { showThinking, streamTokens };
}
```

## Directory Structure

```
cli/src/
├── agent/                 # AI agent system
│   ├── orchestrator/      # Multi-agent coordination
│   ├── workers/           # Specialized agents
│   ├── prompts/           # PromptBuilder & presets
│   ├── reasoning/         # ThinkingChain
│   ├── core.ts            # GateFlowAgent
│   └── tools.ts           # Tool definitions
├── approval/              # Policy & approval system
├── cli/                   # CLI commands & entry
├── config/                # Configuration management
├── diff/                  # Diff generation
├── error/                 # Error recovery
├── events/                # Event bus & types
├── fileops/               # File operations
├── indexer/               # Project indexing
├── memory/                # Session memory
├── types/                 # Shared TypeScript types
├── ui/                    # Terminal renderer
├── verification/          # Verilator integration
└── watch/                 # File watching
```

## Extending GateFlow

### Adding a New Tool

1. Add schema in `src/agent/tools.ts`:
```typescript
const myToolSchema = z.object({ param: z.string() });
```

2. Add executor:
```typescript
my_tool: tool({
    description: '...',
    parameters: myToolSchema,
    execute: async (args) => { ... }
})
```

3. Add policy rules in `src/approval/types.ts`

4. Add event types if needed in `src/events/types.ts`

### Adding a New Worker Agent

1. Create `src/agent/workers/MyAgent.ts`:
```typescript
export function createMyAgent(tools: ToolSet): GateFlowAgent {
    return createAgent({
        name: 'myagent',
        role: 'Expert in ...',
        expertise: '...',
        constraints: ['...'],
        tools: filterTools(tools, ['read_file', 'write_file'])
    });
}
```

2. Register in `src/agent/core.ts`:
```typescript
this.orchestrator.registerWorker('myagent', createMyAgent(tools));
```

3. Add to `AgentRoutingSchema` enum in `src/types/agent-shared.ts`

### Adding a New Event Type

1. Define in `src/events/types.ts`:
```typescript
export interface MyEvent extends BaseEvent {
    type: 'my_event';
    data: string;
}
```

2. Add to `UiEvent` union

3. Handle in `src/ui/renderer.ts`:
```typescript
case 'my_event':
    this.handleMyEvent(event.data);
    break;
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Lint failed |
| 2 | User rejected change |
| 3 | Tool error |
| 4 | Config error |
| 5 | Network error |
| 6 | Timeout |
| 7 | Watch error |
