# Type Safety Fix Plan: Remove All `as any` Casts

## Current State
- **Total remaining casts:** 20
- **Already fixed:** 35 (workflows/ + orchestrator/)

## Execution Plan

### STEP 1: ui-agents.ts (3 casts) - LOW RISK
Remove model casts at lines 119, 198, 404:
```typescript
// Before
model: createModel(parseModelString(this.model)) as any,
// After
model: createModel(parseModelString(this.model)),
```

### STEP 2: workers/PlanningAgent.ts (1 cast) - LOW RISK
Remove model cast at line 52:
```typescript
// Before
model: model as any,
// After
model: model,
```

### STEP 3: core.ts model casts (2 casts) - LOW RISK
Remove model casts at lines 484, 605:
```typescript
// Before
model: createModel(effectiveModelConfig) as any,
model: bundle.model as any,
// After
model: createModel(effectiveModelConfig),
model: bundle.model,
```

### STEP 4: core.ts error handling (4 casts) - LOW RISK
Fix error handling at lines 730-732, 742 using proper type narrowing:
```typescript
// Before
case 'error': {
    const errorMsg = (part as any).error instanceof Error
        ? (part as any).error.message
        : String((part as any).error);
// After
case 'error': {
    const errorMsg = part.error instanceof Error
        ? part.error.message
        : String(part.error);
```

### STEP 5: loop-control.ts (2 casts) - LOW RISK
Remove redundant array casts at lines 137, 262:
```typescript
// Before
const msgArray = [...messages] as any[];
// After
const msgArray = [...messages];
```

### STEP 6: ThinkingChain.ts (1 cast) - LOW RISK
Fix event typing at line 236 - ThoughtEvent already has `data` property:
```typescript
// Before
if (step.data) {
    (event as any).data = step.data;
}
// After (properly typed event)
const event: ThoughtEvent = {
    type: 'thought',
    // ... other properties
    data: step.data ? step.data : undefined,
};
```

### STEP 7: core.ts usage tracking (6 casts) - MEDIUM RISK
Create ExtendedUsage interface to properly type usage objects:
```typescript
interface ExtendedUsage {
  inputTokens?: number;
  outputTokens?: number;
  extended?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    textTokens?: number;
    cachedTokens?: number;
    finishReason?: string;
    rawUsage?: unknown;
  };
  outputTokenDetails?: { reasoningTokens?: number; textTokens?: number };
  cachedTokens?: number;
  raw?: unknown;
}
```

### STEP 8: tools.ts executor return type (1 cast fixed indirectly) - MEDIUM RISK
Add explicit return type to `createToolExecutors()`:
```typescript
// Before
export function createToolExecutors(ctx: ToolContext) {
// After
export function createToolExecutors(ctx: ToolContext): Record<string, (args: unknown) => Promise<unknown>> {
```
This fixes core.ts:246 without changes there.

### STEP 9: tools.ts learnedTypes (1 cast) - MEDIUM RISK
Investigate `knowledgeTypes` expected type and fix array typing.

### STEP 10: core.ts prepareStep (1 cast) - HIGHER RISK
Either:
- Align `PrepareStepFn` with AI SDK's expected signature
- Or use `@ts-expect-error` with documentation

## Testing Strategy
After each step: `npx tsc --noEmit`
Final: `npm run build`

## Expected Result
- 20 casts → 0 casts
- (possibly 1 with documented @ts-expect-error if SDK types incompatible)

## Risk Assessment
| Risk Level | Steps | Casts |
|------------|-------|-------|
| Low | 1-6 | 13 |
| Medium | 7-9 | 6 |
| Higher | 10 | 1 |
