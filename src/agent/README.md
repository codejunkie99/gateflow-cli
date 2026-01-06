# Agent System

The AI agent system provides intelligent code generation, analysis, and modification capabilities for SystemVerilog projects.

## Structure

- **`orchestrator/`** - Multi-agent coordination and task orchestration
- **`workers/`** - Specialized worker agents for different tasks
- **`prompts/`** - Prompt templates and system prompts
- **`reasoning/`** - Thinking chain and reasoning visibility
- **`core.ts`** - Main agent class and orchestration logic
- **`tools.ts`** - AI SDK tool definitions for agents

## Key Components

### Orchestrator
Coordinates multiple agents to handle complex multi-step requests. Automatically routes tasks to appropriate worker agents.

### Worker Agents
- **UnderstandingAgent** - Analyzes existing code and project structure
- **CodeGenerationAgent** - Creates new SystemVerilog modules
- **TestbenchAgent** - Generates testbenches and verification code
- **DebugAgent** - Diagnoses simulation failures and errors
- **RefactoringAgent** - Modifies existing code

### Tools
Defines the tools available to agents (file operations, linting, simulation, etc.)

