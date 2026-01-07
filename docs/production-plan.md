# GateFlow Production-Grade Improvements Plan

This document captures the recommended production-grade improvements to GateFlow’s agentic workflow, along with an implementation plan and Verilator integration guidance.

## Overview
The current query entry and agentic workflow wiring are solid, but production deployments benefit from stronger observability, safety controls, and operational resilience. The sections below outline targeted improvements and a concrete implementation plan.

---

## Proposed Improvements

1. **End-to-end request correlation IDs**
   - Add a `requestId` at query entry and attach it to all emitted events and reasoning steps.
   - Enables cross-agent tracing, debugging, and log correlation.

2. **Runtime/cost/token budgets**
   - Enforce time and token ceilings at both single-agent and multi-agent execution levels.
   - Prevents runaway costs and ensures predictable execution time.

3. **Persist plans/results for audit and replay**
   - Store execution plans and task outputs on disk.
   - Enables auditing, replay, and post-mortem analysis.

4. **Plan validation before execution**
   - Check dependency correctness, agent compatibility, and confidence thresholds before running tasks.
   - Avoids invalid plans and broken dependency graphs.

5. **Routing transparency**
   - Surface the rationale for routing and planning decisions.
   - Increases user trust and debugging clarity.

6. **Retry strategy for transient failures**
   - Implement configurable retries for model or tool failures.
   - Improves resilience in production environments.

7. **Per-agent tool permissions**
   - Enforce tool allowlists at runtime.
   - Prevents accidental or unsafe tool usage by the wrong agent.

8. **Richer project context for planning**
   - Provide lightweight project metadata to planning for higher-quality execution plans.

---

## Implementation Plan

### 1) Add end-to-end request correlation IDs
1. Generate a `requestId` at query entry in `src/cli/commands.ts` (near `chatCommand`).
2. Thread `requestId` through `GateFlowAgent.run(...)` in `src/agent/core.ts`.
3. Extend event types (likely `src/types/agent-shared.ts` and/or `events/types.ts`) to include `requestId`.
4. Update all `bus.emit(...)` calls in `src/agent/core.ts` and `src/agent/orchestrator/Orchestrator.ts` to include `requestId`.
5. Add `requestId` to `ThinkingChain` metadata if available.

### 2) Enforce runtime/cost/token budgets
1. Add CLI flags in `src/cli/main.ts` for time/token/tool-call limits.
2. Pass limits into `setupContext` and `GateFlowAgent` configuration.
3. Add enforcement checks inside `GateFlowAgent.run(...)` and `Orchestrator.executeWithPlan(...)`.
4. Emit structured errors on budget violations.

### 3) Persist plans/results for audit and replay
1. Create a run output directory (e.g., `.gateflow/runs/<requestId>/`) during `setupContext`.
2. Persist `ExecutionPlan` JSON when created in `src/agent/workers/PlanningAgent.ts`.
3. Persist task results in `src/agent/orchestrator/Orchestrator.ts`.
4. Add a CLI command like `gateflow runs show <id>` to inspect saved runs.

### 4) Validate plan consistency before execution
1. Add plan validation helpers (new module or in `PlanningAgent.ts`).
2. Validate dependencies, agent/task compatibility, and confidence thresholds.
3. Fail fast in `Orchestrator.executeWithPlan(...)` with a helpful error message.

### 5) Explain routing decisions
1. Surface complexity routing reasoning in `GateFlowAgent.run(...)` when verbose or when `--explain-routing` is passed.
2. Print a plan summary before executing tasks in `Orchestrator.executeWithPlan(...)`.

### 6) Add retry strategy for model/tool failures
1. Add retry configuration (max retries, delay) via CLI or environment.
2. Wrap `streamText(...)` calls with retry logic in `src/agent/core.ts` and `src/agent/orchestrator/Orchestrator.ts`.
3. Emit retry events for visibility.

### 7) Enforce per-agent tool permissions
1. Add tool allowlists in worker definitions (`src/agent/workers/*.ts`).
2. Ensure the factory filters tools at creation.
3. Add runtime checks in orchestration paths.

### 8) Improve planning context
1. Expand `getProjectContext()` to include index stats or top-level module info.
2. Cache context to avoid repeated scanning.

---

## Verilator Integration for Production

### Current Capability
- The CLI already supports `VERILATOR_PATH` and performs environment checks.
- A production deployment can rely on a properly installed Verilator or an explicit binary path.

### Recommended Production Approaches

1. **Containerized runtime (recommended)**
   - Provide a Docker image with a pinned Verilator version.
   - Standardize CI/prod usage to avoid platform drift.

2. **Bundled binary (if allowed)**
   - Ship a known Verilator binary with the CLI distribution.
   - Offers deterministic behavior but increases maintenance overhead.

3. **Version enforcement + health checks**
   - Expand `gateflow doctor` to verify expected Verilator version and warn on mismatches.
   - Store expected version in config (e.g., `.gaterc.json`).

4. **Managed dependency configuration**
   - Add config options for required Verilator version and path.
   - Ensure `setupContext` respects config + env overrides.

---

## Suggested Rollout Phases

**Phase 1 (Observability & Safety)**
- Request IDs, routing transparency, runtime budgets, and retry logic.

**Phase 2 (Auditability)**
- Persisted plans/results and a CLI command to inspect run history.

**Phase 3 (Planning & Permissions)**
- Plan validation, per-agent tool permissions, and richer planning context.

**Phase 4 (Production Hardening)**
- Formalize Verilator deployment strategy and version enforcement.
