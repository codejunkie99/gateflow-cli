# Event Bus

Central event system for communication between CLI components.

## Purpose

- Decouple components through event-driven architecture
- Stream events to UI (terminal or other)
- Track tool calls, results, and status updates
- Support multiple event types

## Key Files

- **`bus.ts`** - EventBus implementation
- **`types.ts`** - Event type definitions

## Event Types

- `status` - Status updates (indexing, linting, etc.)
- `tool_call` - Tool invocation
- `tool_result` - Tool execution result
- `token` - Streaming text tokens
- `agent_start/complete` - Agent lifecycle
- `index_update` - Index change notifications

## Usage

All major components emit events through the bus, which are then rendered by the UI system.

