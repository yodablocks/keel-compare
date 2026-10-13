# Temporal port

Done. Transcript: [`../transcripts/temporal.txt`](../transcripts/temporal.txt).

```sh
temporal server start-dev --headless   # needs `brew install temporal`
pnpm demo:temporal
```

## Files

- `workflow.ts`: the agent as a workflow, plus the hand-written budget gate, the approve signal and the status query.
- `activities.ts`: the five steps as activities. Each returns its cost and heartbeats while it runs.
- `worker.ts`: one worker process polling a task queue.
- `demo.ts`: the harness. Starts the workflow, kills worker A mid-draft, starts worker B, plays the reviewer.

## How each moment is handled

1. Bad output: `HallucinatedToolError` is in `nonRetryableErrorTypes`, so the activity fails at once. The workflow catches it and calls `plan` again with a hint.
2. Crash: activities heartbeat every 300ms with a 1.5s `heartbeatTimeout` (keel's lease length). When A dies the server gives the draft to B, and B replays the workflow from history.
3. Rate limit: the activity retry policy (800ms initial, 5s max) retries the 429. Idempotency key is `<workflowId>:send`.
4. Budget: the workflow adds up the cost each activity returns. Over budget, it sets `waitingFor` and waits on `condition()`.
5. Approval: the reviewer reads `waitingFor` through the `status` query and sends the `approve` signal with the new budget.

Same two worker processes as keel's run.
