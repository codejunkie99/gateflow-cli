# File Operations

Low-level file system operations for reading, writing, and editing SystemVerilog files.

## Purpose

Provides safe, policy-aware file operations with:
- User approval prompts for destructive changes
- Diff preview before applying changes
- Atomic writes with error handling
- File search and listing

## Key Files

- **`file.ts`** - File read/write operations
- **`edit.ts`** - Line-based editing and search/replace
- **`approval.ts`** - User approval workflow
- **`catalog.ts`** - Tool catalog for AI SDK

## Features

- Automatic re-indexing after file writes
- Dry-run mode for previewing changes
- Approval workflow integration
- File search with regex support

