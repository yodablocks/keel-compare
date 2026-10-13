// Temporal demo, same five moments as keel's `pnpm demo`:
//   1. the model hallucinates a tool name and the workflow calls plan again with a hint
//   2. worker A is SIGKILLed mid-draft and, after the heartbeat timeout, worker B gets the activity
//   3. the email API rate-limits and the activity retry policy backs off
//   4. the run goes over budget and waits for a signal
//   5. the reviewer raises the budget and approves, and the run completes
// Usage: pnpm demo:temporal (needs `temporal server start-dev`)
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, Connection } from "@temporalio/client";
import { BUDGET_USD, RAISED_BUDGET_USD } from "../shared/world.ts";
import { approve, status } from "./workflow.ts";

const workerScript = fileURLToPath(new URL("./worker.ts", import.meta.url));
const taskQueue = `demo-${randomUUID().slice(0, 8)}`;
const say = (line: string) => process.stdout.write(`${line}\n`);
const workers: ChildProcess[] = [];

function startWorker(name: string, onLine: (line: string) => void = () => {}): ChildProcess {
  const child = spawn(process.execPath, [workerScript, name, taskQueue], { stdio: ["ignore", "pipe", "inherit"] });
  createInterface({ input: child.stdout! }).on("line", (line) => {
    say(line);
    onLine(line);
  });
  workers.push(child);
  return child;
}

const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const client = new Client({ connection });

say(`temporal demo: task queue ${taskQueue}, $${BUDGET_USD} budget`);
let killedA = false;
const workerA = startWorker("A", (line) => {
  if (!killedA && line.includes("calling model for draft")) {
    killedA = true;
    say("[demo] SIGKILL worker A (mid-draft, no cleanup)");
    workerA.kill("SIGKILL");
    say("[demo] starting worker B; the server hands it the draft once A misses its 1.5s heartbeat");
    startWorker("B");
  }
});

const handle = await client.workflow.start("researchAgent", {
  taskQueue,
  workflowId: `research-${randomUUID()}`,
  args: [{ topic: "durable execution", budgetUsd: BUDGET_USD }],
});
say(`[demo] started workflow ${handle.workflowId}`);

let approved = false;
let exitCode = 1;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  const { status: run } = await handle.describe();
  if (run.name !== "RUNNING") {
    if (run.name === "COMPLETED") {
      const result = await handle.result();
      say(`[demo] workflow completed, spent $${result.spentUsd.toFixed(2)}`);
      say(`[demo] result: ${JSON.stringify({ draft: result.draft, messageId: result.messageId, followUp: result.followUp })}`);
      exitCode = 0;
    } else say(`[demo] workflow ended as ${run.name}`);
    break;
  }
  const s = await handle.query(status).catch(() => undefined);
  if (s?.waitingFor && !approved) {
    say(`[reviewer] workflow is waiting: ${s.waitingFor}`);
    await handle.signal(approve, { approved: true, budgetUsd: RAISED_BUDGET_USD, by: "demo-reviewer" });
    approved = true;
    say(`[reviewer] raised the budget to $${RAISED_BUDGET_USD} and approved`);
  }
  await sleep(200);
}
if (exitCode !== 0 && Date.now() >= deadline) say("[demo] timed out");

// Temporal keeps every attempt in the event history; print the failures it recorded.
say("[demo] failures in workflow history:");
for await (const event of (await handle.fetchHistory()).events ?? []) {
  const failure = event.activityTaskFailedEventAttributes?.failure ?? event.activityTaskTimedOutEventAttributes?.failure;
  if (failure) say(`  ${failure.message}${failure.cause?.message ? `: ${failure.cause.message}` : ""}`);
}

for (const w of workers) if (w.exitCode === null && w.signalCode === null) w.kill("SIGTERM");
await Promise.all(workers.map((w) => (w.exitCode === null && w.signalCode === null ? new Promise((r) => w.once("exit", r)) : null)));
await connection.close();
process.exit(exitCode);
