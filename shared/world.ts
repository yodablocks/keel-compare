// The scripted world every port runs against: a fake model and fake tools that misbehave on cue.
// No framework code lives here, so keel, LangGraph and Temporal all hit the same failures.
// Mirrors keel's scripts/demo/agent.ts.
import { setTimeout as sleep } from "node:timers/promises";

export const TOOLS = ["search_web", "read_page"];
export const BUDGET_USD = 0.125;
export const RAISED_BUDGET_USD = 0.25;

// Cost each successful step reports. Failed attempts are not charged.
export const COST = {
  research: { usd: 0.04, tokens: 1800 },
  plan: { usd: 0.03, tokens: 900 },
  draft: { usd: 0.05, tokens: 2600 },
  send: { usd: 0.01, tokens: 0 },
  followUp: { usd: 0.02, tokens: 700 },
} as const;

export type Research = { notes: string[] };
export type Plan = { tool: string; query: string };

export class HallucinatedToolError extends Error {
  override name = "HallucinatedToolError";
}

export class RateLimitError extends Error {
  override name = "RateLimitError";
  readonly status = 429;
}

export type World = ReturnType<typeof createWorld>;

// One world per process. The email counter is per process on purpose: a fresh worker after a
// crash hits the rate limit on its first send, exactly as in the keel demo.
export function createWorld(log: (line: string) => void, draftMs = 1500) {
  let emailCalls = 0;

  return {
    async research(topic: string): Promise<Research> {
      log("calling model for research");
      await sleep(200);
      return { notes: [`${topic} keeps state in a database`, "steps are replayed after a crash"] };
    },

    // Without a hint the model asks for a tool that does not exist.
    async plan(topic: string, hint?: string): Promise<Plan> {
      if (!hint) {
        log("calling model for plan");
        const call = { tool: "serch_web", query: topic };
        if (!TOOLS.includes(call.tool)) {
          throw new HallucinatedToolError(`Model requested tool \`${call.tool}\`, which is not in the provided tool list`);
        }
        return call;
      }
      log("calling model for plan (with hint)");
      return { tool: "search_web", query: topic };
    },

    // Slow on purpose: the harness kills the worker while this is running.
    async draft(topic: string, research: Research, plan: Plan): Promise<string> {
      log("calling model for draft");
      await sleep(draftMs);
      return `A short brief on ${topic}, from ${research.notes.length} notes and a ${plan.tool} for "${plan.query}".`;
    },

    // The first send in each process is rate limited. The caller supplies the idempotency key.
    async sendEmail(idempotencyKey: string): Promise<{ messageId: string }> {
      emailCalls++;
      log(`sending email (idempotency key ${idempotencyKey})`);
      if (emailCalls === 1) throw new RateLimitError("429 Too Many Requests: email API rate limit");
      return { messageId: `msg-${idempotencyKey}` };
    },

    async followUp(): Promise<string> {
      log("calling model for follow-up");
      return "Scheduled a follow-up question for next week.";
    },
  };
}
