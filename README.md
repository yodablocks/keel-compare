# keel-compare

The same AI agent workflow built three times: in [keel](https://github.com/yodablocks/keel), in
LangGraph.js and in Temporal. The goal is to see what each one handles when the agent fails, and
what has to be written by hand.

I wrote keel, so read this with that in mind. Where LangGraph or Temporal does better, this README says so.

## The workflow

A research agent, `research -> plan -> draft -> send -> follow-up`, hits five failures in one run:
a hallucinated tool name, a worker killed mid-step, a rate-limited email API, running over budget,
and a human approval to continue. The full spec and pass criteria are in [SPEC.md](SPEC.md).

All three ports run against the same scripted model and tools in [`shared/world.ts`](shared/world.ts).

## Results

Status: all three done (transcripts in [`transcripts/`](transcripts/)). Every port completes the run at $0.15.

| Moment | keel | LangGraph.js | Temporal |
|--------|------|--------------|----------|
| 1. Bad model output, retry with a hint | Built in: classifier labels it `bad_output`, policy retries with the error as a hint | Hand-written: the node catches the error, puts a hint in state, a conditional edge loops back. The default `retryOn` would retry it blindly | Hand-written: mark the error type non-retryable, catch it in the workflow, call the activity again with a hint |
| 2. Worker killed mid-step | Built in: lease expires, worker B resumes from stored steps | Half built in: `invoke(null)` resumes from the last checkpoint and finished nodes do not rerun. Nothing detects the crash: no lease, no queue, so you decide who resumes and when | Built in: worker B picks up the activity after A misses its 1.5s heartbeat, the workflow replays from history. The activity has to send heartbeats itself |
| 3. Rate limit, back off, send once | Built in: classified `transient`, backoff, idempotency key per step | Configured: per-node `retryPolicy` with backoff, filtered to rate limits. Idempotency key built by hand from `thread_id` | Built in: activity retry policy with backoff (retries everything by default). Idempotency key built by hand from the workflow ID |
| 4. Over budget, pause | Built in: per-run budget, `over_budget` escalates to an approval | Hand-written: spend tracked in state, a gate before each node calls `interrupt()` | Hand-written: spend tracked in the workflow, a gate before each activity waits on `condition()` |
| 5. Human raises budget, approves | Built in: `setRunBudget` + `resolveApproval` | Built in: `interrupt()` pauses, `Command({ resume })` carries the decision and the new budget | Built in: a signal carries the decision, a query shows why it is waiting |
| Failure record | Every attempt, with its classification and action | Only what you write to state | Final failure per activity. Retried attempts (the crash, the 429) are not in the history |
| Infra to run it | Postgres | Postgres (checkpointer) | Temporal server (dev server is in-memory; production needs its own database or Temporal Cloud) |

## What each one does well

**LangGraph.js**
- Human in the loop is the strongest part. `interrupt()` inside any node, resume with any value, and the paused state is inspectable with `getState()`.
- Resuming after a crash works with no extra code once a Postgres checkpointer is set: finished nodes are not rerun.
- The graph is explicit. The bad-output loop is a visible edge (`plan -> plan`), not a hidden retry.

Gaps found while building it:
- No process model. When a worker dies, the thread just sits at `next: ["draft"]` until something you wrote calls `invoke(null)` on it. LangGraph Platform adds a server and queue for this; the open-source library does not.
- The default `retryOn` retries almost any error, including bad model output, with the same input. Retries have to be filtered by hand.
- Checkpoint durability defaults to `"async"`. The docs say it saves while the next node runs; this port sets `"sync"` to be safe. Not yet tested whether `"async"` actually loses a step on SIGKILL.
- No budget concept. Spend lives in state and the gate is about 15 lines in `langgraph/graph.ts`.
- Node names cannot match state keys (`research`, `plan`, `draft` had to become `findings`, `toolCall`, `brief`).

**Temporal**
- Crash recovery is the best of the three. Workers just poll a queue; the server notices the dead worker by heartbeat timeout and hands the activity to another one. The workflow replays from history without rerunning finished steps.
- Retries with backoff come with every activity, configured in one place.
- Signals and queries make the approval step simple, and `condition()` waits durably for as long as needed.
- It is the most mature of the three by far.

Gaps found while building it:
- The workflow runs in a deterministic sandbox and cannot import `shared/world.ts` (it uses Node timers). Activities return their cost so the workflow can add it up.
- Bad model output has no special handling. The default policy retries every error with the same input, so it has to be marked non-retryable and handled in workflow code.
- No budget concept, same as LangGraph.
- Retries are invisible in the history: only the last failure of each activity is recorded. The demo's history shows the bad-output failure and nothing about the crash or the 429.
- Crash detection needs heartbeats from the activity itself. Without them, a dead worker is only noticed at `startToCloseTimeout` (30s here).

## What keel does differently

- Failures are classified (`bad_output`, `transient`, `over_budget`, ...) and the policy picks the action from the class. In the other two, each failure type is a separate hand-written path.
- A retry can change the input: the error goes back to the model as a hint. Both others would resend the same call unless you write the loop yourself.
- Budgets are part of the engine. Steps report usage, and going over turns into an approval instead of an error.
- Every attempt is stored with what happened and what the engine decided. That record is what makes evaluating the classifier possible.
- It only needs Postgres. Temporal needs its own server; LangGraph needs nothing but leaves process management to you.

## What I would change in keel

TBD.

## Run it

Needs Node 24+ and pnpm.

```sh
pnpm install
docker compose up -d     # Postgres on port 5434
pnpm test                # checks the scripted world
pnpm demo:langgraph      # LangGraph port, five moments in one run
temporal server start-dev --headless   # in another terminal
pnpm demo:temporal       # Temporal port
```

Per-port instructions are in [`langgraph/`](langgraph/README.md) and [`temporal/`](temporal/README.md).
