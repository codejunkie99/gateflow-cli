# CLI Commands

Command-line interface entry points and command implementations.

## Purpose

- Parse command-line arguments
- Initialize context and dependencies
- Execute commands (chat, lint, scan, etc.)
- Handle user interaction

## Key Files

- **`main.ts`** - CLI program setup and command registration
- **`commands.ts`** - Command implementations
- **`index.ts`** - Re-exports

## Commands

- `chat` - Interactive chat mode (default)
- `scan` - Scan and index project
- `lint` - Run Verilator lint
- `fix` - Auto-fix lint errors
- `watch` - Watch files for changes
- `gen` - Generate code templates
- `doctor` - Check environment

## Entry Point

The CLI starts from `src/index.ts` which imports `cli/main.ts`.

