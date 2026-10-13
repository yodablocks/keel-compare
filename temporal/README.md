# Temporal port

Not started.

## Plan

- One workflow function. Each step in `shared/world.ts` becomes an activity.
- Moment 2 should come for free: kill the worker process, start another, and the workflow replays from history.
- Moment 3: activity `retry` options with backoff. Use the workflow ID plus step name as the idempotency key.
- Moment 1: activity retries are blind, so catch `HallucinatedToolError` in the workflow and call `plan` again with a hint. Mark it non-retryable at the activity level.
- Moments 4 and 5: track spend in the workflow, `condition()` on an `approve` signal carrying the raised budget.

## Packages (not installed yet)

```sh
pnpm add @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity
```

Local server: `brew install temporal`, then `temporal server start-dev`.
