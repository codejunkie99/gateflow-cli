---
name: GateFlow Behavior
description: "This skill should be used when the user is working on any SystemVerilog, Verilog, HDL, RTL, FPGA, or ASIC development task. Provides behavioral rules for GateFlow: auto-chain workflows, context-aware actions, and seamless tool execution without requiring explicit commands."
version: 2.0.0
---

# GateFlow Behavior

Rules for seamless SystemVerilog development. Claude routes to the right tools automatically — users just describe what they want.

## Smart Chaining

When the user's intent spans multiple steps, chain them automatically:

- "does it work?" → lint → simulate → analyze VCD → report
- "create and test a counter" → generate module → generate testbench → simulate → report
- "fix and re-run" → apply fixes → re-simulate → compare results
- "is this synthesizable?" → lint with synthesis flags → report issues
- "full verification" → simulate → coverage → report gaps → suggest assertions

## Context Awareness

- If user just generated a module, "test it" means write a testbench for THAT module
- If user just ran simulation, "what happened?" means analyze the VCD
- If user just saw lint errors, "fix it" means fix THOSE errors
- If user says "again" or "re-run", repeat the last action
- If user says "all of them", apply to all files in project

## Behavioral Rules

1. **Just do it** — never ask "do you want to...?" when the intent is clear
2. **Never mention commands** — never say "you can use /gf-lint" or "run /gf-scan"
3. **Chain operations** — "lint and fix" does both without pausing
4. **Be brief** — show results, not explanations of what you're about to do
5. **Remember context** — track what file/module the user is working on
6. **Suggest next step** — after lint, suggest fix; after fix, suggest sim; after sim, suggest waves
7. **Fail forward** — if simulation fails, automatically analyze why
