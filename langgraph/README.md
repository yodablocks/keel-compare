# LangGraph.js port

Done. Transcript: [`../transcripts/langgraph.txt`](../transcripts/langgraph.txt).

```sh
docker compose up -d
pnpm demo:langgraph
```

## Files

- `graph.ts`: the agent as a `StateGraph`, one node per step, plus the hand-written budget gate.
- `worker.ts`: one process that runs `start`, `resume` or `approve` on a thread, then exits.
- `demo.ts`: the harness. Kills worker A mid-draft, starts worker B to resume, plays the reviewer, starts worker C to finish.

## How each moment is handled

1. Bad output: the `plan` node catches `HallucinatedToolError`, writes a hint to state, and a conditional edge sends it back to `plan`.
2. Crash: `PostgresSaver` with `durability: "sync"`. Worker B calls `invoke(null)` and resumes at `draft`. The harness has to decide that B should do this: LangGraph does not notice the dead worker.
3. Rate limit: `retryPolicy` on the `send` node, `retryOn` limited to `RateLimitError`. Idempotency key is `<thread_id>:send`.
4. Budget: `spentUsd` is a summing reducer in state. `gated()` checks it before each node and calls `interrupt()` when over.
5. Approval: worker C resumes with `Command({ resume: { approved, budgetUsd } })`. The gated node reruns from the top and `interrupt()` returns that value.

Differences from keel's run: three processes instead of two (each invoke exits when it finishes or pauses), and the 429 does not show up in state because the retry happens inside the node.
