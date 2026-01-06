# Verification

Verilator integration for linting and simulating SystemVerilog code.

## Purpose

- Run Verilator lint checks on SystemVerilog files
- Compile and simulate designs
- Parse error messages and warnings
- Support WSL paths on Windows

## Key Files

- **`verilator.ts`** - Verilator wrapper and integration
- **`fix-loop.ts`** - Automatic error fixing loop

## Features

- Lint checking with error parsing
- Simulation execution
- VCD file generation
- WSL path conversion for Windows
- Timeout handling

## Usage

Used by:
- `lint_file` tool
- `run_simulation` tool
- Debug agent for error diagnosis

