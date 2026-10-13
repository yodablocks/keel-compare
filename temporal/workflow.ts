// The research agent as a Temporal workflow. Runs in Temporal's deterministic sandbox, so it only
// imports types from the shared world; all I/O happens in activities.
import { ActivityFailure, ApplicationFailure, condition, defineQuery, defineSignal, proxyActivities, setHandler, workflowInfo } from "@temporalio/workflow";
import type { Activities } from "./activities.ts";

export type Approval = { approved: boolean; budgetUsd: number; by: string };
export type Status = { spentUsd: number; budgetUsd: number; waitingFor?: string; errors: string[] };

export const approve = defineSignal<[Approval]>("approve");
export const status = defineQuery<Status>("status");

// heartbeatTimeout plays the role of keel's 1.5s lease. Bad output is not retried by Temporal:
// a blind retry would send the same prompt, so the workflow handles it below.
const { research, plan, draft, sendEmail, followUp } = proxyActivities<Activities>({
  startToCloseTimeout: "30s",
  heartbeatTimeout: "1.5s",
  retry: { initialInterval: "800ms", maximumInterval: "5s", maximumAttempts: 6, nonRetryableErrorTypes: ["HallucinatedToolError"] },
});

export async function researchAgent(input: { topic: string; budgetUsd: number }) {
  const s: Status = { spentUsd: 0, budgetUsd: input.budgetUsd, errors: [] };
  let decision: Approval | undefined;
  setHandler(status, () => s);
  setHandler(approve, (d) => void (decision = d));

  // Hand-written budget gate: over budget, wait for an approve signal instead of failing.
  async function costed<T>(name: string, call: () => Promise<{ value: T; usd: number }>): Promise<T> {
    if (s.spentUsd > s.budgetUsd) {
      s.waitingFor = `spent $${s.spentUsd.toFixed(2)} of its $${s.budgetUsd} budget before step "${name}"`;
      await condition(() => decision !== undefined);
      if (!decision!.approved) throw ApplicationFailure.nonRetryable(`Reviewer ${decision!.by} rejected the run`);
      s.budgetUsd = decision!.budgetUsd;
      s.waitingFor = undefined;
      decision = undefined;
    }
    const { value, usd } = await call();
    s.spentUsd += usd;
    return value;
  }

  const notes = await costed("research", () => research(input.topic));

  let hint: string | undefined;
  let toolCall;
  while (!toolCall) {
    try {
      toolCall = await costed("plan", () => plan(input.topic, hint));
    } catch (e) {
      const cause = e instanceof ActivityFailure ? e.cause : undefined;
      if (!(cause instanceof ApplicationFailure && cause.type === "HallucinatedToolError") || hint) throw e;
      s.errors.push(cause.message);
      hint = `The previous attempt produced unusable output: ${cause.message}`;
    }
  }

  const brief = await costed("draft", () => draft(input.topic, notes, toolCall));
  const sent = await costed("send", () => sendEmail(`${workflowInfo().workflowId}:send`));
  const next = await costed("follow-up", () => followUp());
  return { draft: brief, messageId: sent.messageId, followUp: next, spentUsd: s.spentUsd };
}
