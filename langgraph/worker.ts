// One LangGraph process. LangGraph has no queue or lease: something outside has to decide which
// process runs which thread and when. Here that is demo.ts, which passes the command on argv.
// Usage: node langgraph/worker.ts <name> <threadId> start|resume|approve [approvedBudgetUsd]
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { BUDGET_USD, createWorld } from "../shared/world.ts";
import { buildGraph, type Approval } from "./graph.ts";

const [name = "?", threadId, mode, approvedBudget] = process.argv.slice(2);
const log = (line: string) => process.stdout.write(`[worker ${name}] ${line}\n`);
if (!threadId || !mode) throw new Error("usage: worker.ts <name> <threadId> start|resume|approve [budgetUsd]");

const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL ?? "postgres://keel:keel@localhost:5434/keel_compare");
const graph = buildGraph(createWorld(log, Number(process.env.DRAFT_MS ?? 1500)), log, checkpointer);
// "sync" writes each checkpoint before the next node starts. The default, "async", can lose the
// last finished node if the process dies right after it.
const config = { configurable: { thread_id: threadId }, durability: "sync" as const };

log(`started (${mode})`);
const input =
  mode === "start" ? { topic: "durable execution", budgetUsd: BUDGET_USD }
  : mode === "resume" ? null
  : new Command({ resume: { approved: true, budgetUsd: Number(approvedBudget), by: "demo-reviewer" } satisfies Approval });
await graph.invoke(input, config);

const snapshot = await graph.getState(config);
const pending = snapshot.tasks.flatMap((t) => t.interrupts);
if (pending.length > 0) log(`paused: ${(pending[0]!.value as { reason: string }).reason}`);
else log("finished");
await checkpointer.end();
