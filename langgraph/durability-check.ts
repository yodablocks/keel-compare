// Does LangGraph's default checkpoint durability ("async") lose a finished node when the process dies?
// A child process runs a -> b -> c and SIGKILLs itself the moment b starts, right after a finished.
// The parent then reads the thread: if the next node is "a", a's checkpoint was lost and a will run again.
// Results: transcripts/langgraph-durability.txt
// Usage: node langgraph/durability-check.ts [runsPerMode]   (needs `docker compose up -d`)
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://keel:keel@localhost:5434/keel_compare";
const MODES = ["async", "sync", "exit"] as const;
// How long node a works. 0 also races the write of the starting checkpoint; 300 is like a short model call.
const A_MS = Number(process.env.A_MS ?? 300);
// How long into node b the crash happens. 0 is the worst case: right after a finished.
const KILL_AFTER_MS = Number(process.env.KILL_AFTER_MS ?? 0);
type Mode = (typeof MODES)[number];

const State = Annotation.Root({ done: Annotation<string[]>({ reducer: (x, y) => x.concat(y), default: () => [] }) });

function buildGraph(checkpointer: PostgresSaver, killInB: boolean) {
  return new StateGraph(State)
    .addNode("a", async () => {
      await sleep(A_MS);
      return { done: ["a"] };
    })
    .addNode("b", async () => {
      if (killInB) {
        if (KILL_AFTER_MS > 0) await sleep(KILL_AFTER_MS);
        process.kill(process.pid, "SIGKILL");
      }
      return { done: ["b"] };
    })
    .addNode("c", async () => ({ done: ["c"] }))
    .addEdge(START, "a")
    .addEdge("a", "b")
    .addEdge("b", "c")
    .addEdge("c", END)
    .compile({ checkpointer });
}

// Child: run the graph until it kills itself in b.
if (process.argv[2] === "child") {
  const [, , , threadId, mode] = process.argv as [string, string, string, string, Mode];
  const checkpointer = PostgresSaver.fromConnString(DATABASE_URL);
  await buildGraph(checkpointer, true).invoke({ done: [] }, { configurable: { thread_id: threadId }, durability: mode });
  throw new Error("unreachable: b should have killed the process");
}

const runs = Number(process.argv[2] ?? 20);
const self = fileURLToPath(import.meta.url);
const checkpointer = PostgresSaver.fromConnString(DATABASE_URL);
await checkpointer.setup();
const reader = buildGraph(checkpointer, false);

console.log(`${runs} runs per mode, node a works ${A_MS}ms. Each child SIGKILLs itself ${KILL_AFTER_MS}ms into node b, right after a finished.\n`);
console.log("mode    a kept   a kept, but next: []   a lost   nothing saved");
for (const mode of MODES) {
  const counts = { kept: 0, hidden: 0, lost: 0, none: 0 };
  for (let i = 0; i < runs; i++) {
    const threadId = randomUUID();
    const child = spawn(process.execPath, [self, "child", threadId, mode], { stdio: "inherit" });
    const signal = await new Promise((resolve) => child.once("exit", (_code, sig) => resolve(sig)));
    if (signal !== "SIGKILL") throw new Error(`child exited with ${signal}, expected SIGKILL`);
    const { next, values } = await reader.getState({ configurable: { thread_id: threadId } });
    if (next[0] === "b" && values.done?.includes("a")) counts.kept++;
    else if (next[0] === "a") counts.lost++;
    else if (next.length === 0 && !values.done) counts.none++;
    else if (next.length === 0 && values.done?.join() === "a") {
      // getState reports nothing left to run, but a's write was saved: resuming runs b and c only.
      const resumed = await reader.invoke(null, { configurable: { thread_id: threadId } });
      if (resumed?.done?.join() !== "a,b,c") throw new Error(`resume gave ${JSON.stringify(resumed?.done)}`);
      counts.hidden++;
    }
    else throw new Error(`unexpected state: next=${JSON.stringify(next)} values=${JSON.stringify(values)}`);
  }
  console.log(`${mode.padEnd(8)}${String(counts.kept).padEnd(9)}${String(counts.hidden).padEnd(23)}${String(counts.lost).padEnd(9)}${counts.none}`);
}
await checkpointer.end();
