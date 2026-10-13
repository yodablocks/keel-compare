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

Status: keel done (transcript in `transcripts/keel.txt`), LangGraph and Temporal not started.

| Moment | keel | LangGraph.js | Temporal |
|--------|------|--------------|----------|
| 1. Bad model output, retry with a hint | Built in: classifier labels it `bad_output`, policy retries with the error as a hint | TBD | TBD |
| 2. Worker killed mid-step | Built in: lease expires, worker B resumes from stored steps | TBD | TBD |
| 3. Rate limit, back off, send once | Built in: classified `transient`, backoff, idempotency key per step | TBD | TBD |
| 4. Over budget, pause | Built in: per-run budget, `over_budget` escalates to an approval | TBD | TBD |
| 5. Human raises budget, approves | Built in: `setRunBudget` + `resolveApproval` | TBD | TBD |
| Lines of workflow code | TBD | TBD | TBD |
| Infra to run it | Postgres | Postgres (checkpointer) | Temporal server |

## What each one does well

TBD after the ports are done.

## What keel does differently

TBD.

## What I would change in keel

TBD.

## Run it

Needs Node 24+ and pnpm.

```sh
pnpm test                 # checks the scripted world
```

Per-port instructions are in [`langgraph/`](langgraph/README.md) and [`temporal/`](temporal/README.md).
