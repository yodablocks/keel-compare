// LangGraph demo, same five moments as keel's `pnpm demo`:
//   1. the model hallucinates a tool name and the plan node loops back with a hint
//   2. worker A is SIGKILLed mid-draft and worker B resumes the thread from its last checkpoint
//   3. the email API rate-limits and the send node's retry policy backs off
//   4. the run goes over budget and pauses on interrupt()
//   5. the reviewer raises the budget and approves, and the run completes
// Usage: pnpm demo:langgraph (needs `docker compose up -d`)
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { RAISED_BUDGET_USD } from "../shared/world.ts";
import { buildGraph } from "./graph.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://keel:keel@localhost:5434/keel_compare";
const workerScript = fileURLToPath(new URL("./worker.ts", import.meta.url));
const threadId = randomUUID();
const say = (line: string) => process.stdout.write(`${line}\n`);

function runWorker(name: string, args: string[], onLine: (line: string, kill: () => void) => void = () => {}) {
  const child = spawn(process.execPath, [workerScript, name, threadId, ...args], { stdio: ["ignore", "pipe", "inherit"] });
  createInterface({ input: child.stdout! }).on("line", (line) => {
    say(line);
    onLine(line, () => child.kill("SIGKILL"));
  });
  return new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
}

const checkpointer = PostgresSaver.fromConnString(DATABASE_URL);
await checkpointer.setup();
// Read-only handle for inspecting the thread. The world is never called from here.
const graph = buildGraph(undefined as never, say, checkpointer);
const config = { configurable: { thread_id: threadId } };

say(`langgraph demo: thread ${threadId}, $0.125 budget`);

let killed = false;
await runWorker("A", ["start"], (line, kill) => {
  if (!killed && line.includes("calling model for draft")) {
    killed = true;
    say("[demo] SIGKILL worker A (mid-draft, no cleanup)");
    kill();
  }
});
const afterCrash = await graph.getState(config);
say(`[demo] thread is stuck at ${JSON.stringify(afterCrash.next)}, and nothing else notices: no lease, no queue`);
say("[demo] the harness starts worker B and tells it to resume the thread");
await runWorker("B", ["resume"]);

const paused = await graph.getState(config);
const pending = paused.tasks.flatMap((t) => t.interrupts);
if (pending.length > 0) {
  say(`[reviewer] pending interrupt at ${JSON.stringify(paused.next)}: ${(pending[0]!.value as { reason: string }).reason}`);
  say(`[reviewer] raised the budget to $${RAISED_BUDGET_USD} and approved`);
  await runWorker("C", ["approve", String(RAISED_BUDGET_USD)]);
}

const final = await graph.getState(config);
const v = final.values;
const done = final.next.length === 0 && v.followUp !== undefined;
say(`[demo] run ${done ? "completed" : "did not complete"}, spent $${v.spentUsd.toFixed(2)}`);
say(`[demo] result: ${JSON.stringify({ draft: v.brief, messageId: v.messageId, followUp: v.followUp })}`);
say(`[demo] errors kept in state: ${JSON.stringify(v.errors)}`);
await checkpointer.end();
process.exit(done ? 0 : 1);
