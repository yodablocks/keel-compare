// One Temporal worker process. Unlike LangGraph, workers just poll a task queue: the server
// decides who runs what, and reassigns work from a worker that stops heartbeating.
// Usage: node temporal/worker.ts <name> <taskQueue>
import { fileURLToPath } from "node:url";
import { DefaultLogger, NativeConnection, Runtime, Worker } from "@temporalio/worker";
import { createWorld } from "../shared/world.ts";
import { createActivities } from "./activities.ts";

const [name = "?", taskQueue] = process.argv.slice(2);
const log = (line: string) => process.stdout.write(`[worker ${name}] ${line}\n`);
if (!taskQueue) throw new Error("usage: worker.ts <name> <taskQueue>");

// The SDK logs every worker state change and activity failure; the demo prints its own lines.
Runtime.install({ logger: new DefaultLogger("ERROR") });
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
const worker = await Worker.create({
  connection,
  taskQueue,
  workflowsPath: fileURLToPath(new URL("./workflow.ts", import.meta.url)),
  activities: createActivities(createWorld(log, Number(process.env.DRAFT_MS ?? 1500)), log),
});
process.on("SIGTERM", () => worker.shutdown());
log("started");
await worker.run();
await connection.close();
