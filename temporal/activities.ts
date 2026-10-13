// The five steps as Temporal activities. Each returns its cost so the workflow can track spend,
// and heartbeats while it runs so a dead worker is noticed after the heartbeat timeout.
import { heartbeat } from "@temporalio/activity";
import { COST, type Plan, type Research, type World } from "../shared/world.ts";

export type Costed<T> = { value: T; usd: number };

export function createActivities(world: World, log: (line: string) => void) {
  async function step<T>(name: string, usd: number, fn: () => Promise<T>): Promise<Costed<T>> {
    const beat = setInterval(() => heartbeat(), 300);
    try {
      return { value: await fn(), usd };
    } catch (e) {
      log(`${name} failed: "${(e as Error).message}"`);
      throw e;
    } finally {
      clearInterval(beat);
    }
  }

  return {
    research: (topic: string) => step("research", COST.research.usd, () => world.research(topic)),
    plan: (topic: string, hint?: string) => step("plan", COST.plan.usd, () => world.plan(topic, hint)),
    draft: (topic: string, research: Research, plan: Plan) => step("draft", COST.draft.usd, () => world.draft(topic, research, plan)),
    sendEmail: (idempotencyKey: string) => step("send", COST.send.usd, () => world.sendEmail(idempotencyKey)),
    followUp: () => step("follow-up", COST.followUp.usd, () => world.followUp()),
  };
}

export type Activities = ReturnType<typeof createActivities>;
