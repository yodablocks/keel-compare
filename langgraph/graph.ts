// The research agent as a LangGraph StateGraph. One node per step, Postgres checkpoints between nodes.
// Everything keel gives a step for free (budget gate, hint on bad output, idempotency key) is written here by hand.
import { Annotation, END, interrupt, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { COST, HallucinatedToolError, RateLimitError, type Plan, type Research, type World } from "../shared/world.ts";

const last = <T>() => Annotation<T>({ reducer: (_, next) => next, default: () => undefined as T });

export const State = Annotation.Root({
  topic: Annotation<string>,
  budgetUsd: Annotation<number>,
  spentUsd: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  errors: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  hint: last<string | undefined>(),
  findings: last<Research | undefined>(),
  toolCall: last<Plan | undefined>(),
  brief: last<string | undefined>(),
  messageId: last<string | undefined>(),
  followUp: last<string | undefined>(),
});
type S = typeof State.State;
type Update = typeof State.Update;

export type Approval = { approved: boolean; budgetUsd: number; by: string };

// Hand-written budget gate. Over budget, the node pauses with interrupt() and waits for a person.
// On resume LangGraph reruns the node from the top, and interrupt() returns the reviewer's decision.
function gated(name: string, node: (s: S, config: LangGraphRunnableConfig) => Promise<Update>) {
  return async (s: S, config: LangGraphRunnableConfig): Promise<Update> => {
    let budgetUsd = s.budgetUsd;
    if (s.spentUsd > budgetUsd) {
      const decision = interrupt({
        reason: `spent $${s.spentUsd.toFixed(2)} of its $${budgetUsd} budget before step "${name}"`,
      }) as Approval;
      if (!decision.approved) throw new Error(`Reviewer ${decision.by} rejected the run`);
      budgetUsd = decision.budgetUsd;
    }
    return { ...(await node(s, config)), budgetUsd };
  };
}

export function buildGraph(world: World, log: (line: string) => void, checkpointer: BaseCheckpointSaver) {
  return new StateGraph(State)
    .addNode("research", gated("research", async (s) => ({ findings: await world.research(s.topic), spentUsd: COST.research.usd })))
    // Bad output: a blind retry would ask for `serch_web` again, so catch it and loop back with a hint in state.
    .addNode("plan", gated("plan", async (s) => {
      try {
        return { toolCall: await world.plan(s.topic, s.hint), spentUsd: COST.plan.usd };
      } catch (e) {
        if (!(e instanceof HallucinatedToolError)) throw e;
        log(`plan failed: "${e.message}" -> retry with hint`);
        return { hint: `The previous attempt produced unusable output: ${e.message}`, errors: [e.message] };
      }
    }))
    .addNode("draft", gated("draft", async (s) => ({ brief: await world.draft(s.topic, s.findings!, s.toolCall!), spentUsd: COST.draft.usd })))
    .addNode(
      "send",
      gated("send", async (_, config) => {
        const key = `${config.configurable?.thread_id}:send`;
        try {
          return { messageId: (await world.sendEmail(key)).messageId, spentUsd: COST.send.usd };
        } catch (e) {
          log(`send failed: "${(e as Error).message}" -> ${e instanceof RateLimitError ? "retry policy backs off" : "fail"}`);
          throw e;
        }
      }),
      // Only rate limits are retried. The default retryOn retries almost every error, including bad output.
      { retryPolicy: { maxAttempts: 5, initialInterval: 800, maxInterval: 5000, retryOn: (e) => e instanceof RateLimitError } },
    )
    .addNode("follow-up", gated("follow-up", async () => ({ followUp: await world.followUp(), spentUsd: COST.followUp.usd })))
    .addEdge(START, "research")
    .addEdge("research", "plan")
    .addConditionalEdges("plan", (s) => (s.toolCall ? "draft" : "plan"), ["draft", "plan"])
    .addEdge("draft", "send")
    .addEdge("send", "follow-up")
    .addEdge("follow-up", END)
    .compile({ checkpointer });
}
