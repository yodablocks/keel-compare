# LangGraph.js port

Not started.

## Plan

- One `StateGraph` with a node per step. State holds `research`, `plan`, `draft`, `messageId`, `followUp`, `spentUsd`, `hint`.
- `PostgresSaver` checkpointer, so a second process can resume the thread after the first is killed (moment 2).
- Moment 1: catch `HallucinatedToolError` in the `plan` node and loop back with a hint in state.
- Moment 3: node-level retry policy for `RateLimitError`. Check whether the email can be sent twice if the process dies after the send and before the checkpoint.
- Moments 4 and 5: budget check before each node, `interrupt()` when over, resume with `Command({ resume })` carrying the raised budget.

## Packages (not installed yet)

```sh
pnpm add @langchain/langgraph @langchain/langgraph-checkpoint-postgres @langchain/core
```

Postgres: reuse keel's `docker compose up -d` (port 5433), on a separate database.
