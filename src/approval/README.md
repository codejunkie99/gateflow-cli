# Approval System

Manages user approval prompts for file modifications and policy enforcement.

## Purpose

- Prompt users before making destructive changes
- Enforce project policies (e.g., don't modify certain files)
- Track approval grants and permissions
- Support auto-approve mode for automation

## Key Files

- **`engine.ts`** - Policy engine and approval logic
- **`types.ts`** - Approval types and interfaces

## Integration

Used by:
- File operations (write, edit, delete)
- Tool executors before applying changes
- CLI commands for user interaction

## Features

- Policy-based file protection
- Approval grant tracking
- Auto-approve mode support
- Dry-run mode integration

