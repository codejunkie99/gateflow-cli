# Project Indexer

Scans and indexes SystemVerilog projects to discover modules, packages, interfaces, and their dependencies.

## Purpose

- Parse SystemVerilog files to extract module definitions
- Build dependency graphs for compilation order
- Provide fast module lookup by name
- Track file changes and update index incrementally

## Key Files

- **`index.ts`** - Main ProjectIndexer class
- **`parser.ts`** - SystemVerilog parser for extracting definitions

## Usage

The indexer is used by:
- `find_module` tool to locate modules
- Dependency resolution for compilation
- Project statistics and analysis

## Features

- Incremental updates (only re-index changed files)
- Dependency graph building
- Include path resolution
- Module search and discovery

