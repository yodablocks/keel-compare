import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET_USD, COST, createWorld, HallucinatedToolError, RateLimitError } from "../shared/world.ts";

const quiet = () => {};

test("plan hallucinates a tool without a hint and recovers with one", async () => {
  const world = createWorld(quiet);
  await assert.rejects(world.plan("x"), HallucinatedToolError);
  assert.deepEqual(await world.plan("x", "use a listed tool"), { tool: "search_web", query: "x" });
});

test("the first send per world is rate limited, the second succeeds", async () => {
  const world = createWorld(quiet);
  await assert.rejects(world.sendEmail("run-1:send"), RateLimitError);
  assert.equal((await world.sendEmail("run-1:send")).messageId, "msg-run-1:send");
});

test("the budget runs out after send, before follow-up", () => {
  const beforeFollowUp = COST.research.usd + COST.plan.usd + COST.draft.usd + COST.send.usd;
  assert.ok(beforeFollowUp > BUDGET_USD);
  assert.ok(beforeFollowUp - COST.send.usd <= BUDGET_USD);
});
