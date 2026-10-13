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

Status: keel and LangGraph.js done (transcripts in [`transcripts/`](transcripts/)), Temporal not started.

| Moment | keel | LangGraph.js | Temporal |
|--------|------|--------------|----------|
| 1. Bad model output, retry with a hint | Built in: classifier labels it `bad_output`, policy retries with the error as a hint | Hand-written: the node catches the error, puts a hint in state, a conditional edge loops back. The default `retryOn` would retry it blindly | TBD |
| 2. Worker killed mid-step | Built in: lease expires, worker B resumes from stored steps | Half built in: `invoke(null)` resumes from the last checkpoint and finished nodes do not rerun. Nothing detects the crash: no lease, no queue, so you decide who resumes and when | TBD |
| 3. Rate limit, back off, send once | Built in: classified `transient`, backoff, idempotency key per step | Configured: per-node `retryPolicy` with backoff, filtered to rate limits. Idempotency key built by hand from `thread_id` | TBD |
| 4. Over budget, pause | Built in: per-run budget, `over_budget` escalates to an approval | Hand-written: spend tracked in state, a gate before each node calls `interrupt()` | TBD |
| 5. Human raises budget, approves | Built in: `setRunBudget` + `resolveApproval` | Built in: `interrupt()` pauses, `Command({ resume })` carries the decision and the new budget | TBD |
| Infra to run it | Postgres | Postgres (checkpointer) | Temporal server |

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

TBD.

## What keel does differently

TBD.

## What I would change in keel

TBD.

## Run it

Needs Node 24+ and pnpm.

```sh
pnpm install
docker compose up -d     # Postgres on port 5434
pnpm test                # checks the scripted world
pnpm demo:langgraph      # LangGraph port, five moments in one run
```

Per-port instructions are in [`langgraph/`](langgraph/README.md) and [`temporal/`](temporal/README.md).
