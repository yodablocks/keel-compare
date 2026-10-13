# The workflow

One research agent, five steps, run against the scripted world in `shared/world.ts`:

```
research -> plan -> draft -> send -> follow-up
```

Input: `{ topic: "durable execution" }`. Output: `{ draft, messageId, followUp }`.
Starting budget: $0.125. Step costs: research $0.04, plan $0.03, draft $0.05, send $0.01, follow-up $0.02. Failed attempts are not charged.

## The five moments

Each port has to get through all five in one run, with two worker processes. For each moment we
record how the port handles it: built in, configured, hand-written, or not possible.

| # | Moment | What the world does | Pass criteria |
|---|--------|---------------------|---------------|
| 1 | Bad model output | `plan` without a hint asks for `serch_web`, a tool that does not exist | The retry is different from the first try: the error goes back to the model as a hint. A blind retry of the same call fails forever. |
| 2 | Worker crash | The harness SIGKILLs worker A while `draft` runs | Worker B finishes the run. `research` and `plan` do not run again. |
| 3 | Rate limit | The first `sendEmail` in each process throws a 429 | The run backs off and retries. The email goes out once, under a stable idempotency key. |
| 4 | Over budget | After `send` the run has spent $0.13 of $0.125 | `follow-up` does not start. The run pauses and asks a person instead of failing. |
| 5 | Approval | A reviewer raises the budget to $0.25 and approves | The run resumes at `follow-up` and completes, having spent $0.15. |

## Rules for a fair comparison

- Same world, same costs, same budget. Ports import `shared/world.ts` and do not change it.
- Use each tool the way its docs recommend. If something needs hand-written code, write it and count the lines.
- No real model. Model calls are scripted so the comparison is about failure handling, not prompts.
- Each port ships a transcript in `transcripts/`, recorded the same way as keel's.
