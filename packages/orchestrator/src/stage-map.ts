/**
 * Map Studio digital-human / step agent id → Bridge `/runs/:id/:stage`.
 * Keep in sync with apps/studio-api dify-dsl.generator `bridgeStageForAgent`.
 */

export type StageMapAgent = {
  role?: string | null;
  dify?: { agent_id?: string | null } | null;
};

const KNOWN: Record<string, string> = {
  requirement_intake: "requirement",
  requirement_clarify: "requirement",
  requirement: "requirement",
  plan: "plan",
  fullstack_dev: "dev",
  code_review: "review",
  test: "test",
  ops: "release_test",
};

export function bridgeStageForAgent(
  agent: StageMapAgent | null | undefined,
  agentId: string,
): string {
  const fromDify = agent?.dify?.agent_id?.trim();
  if (fromDify) return fromDify;

  if (KNOWN[agentId]) return KNOWN[agentId];

  switch (agent?.role) {
    case "intake":
    case "clarify":
    case "spec":
      return "requirement";
    case "plan":
      return "plan";
    case "implement":
      return "dev";
    case "review":
      return "review";
    case "verify":
      return "test";
    case "ops":
      return "release_test";
    default:
      return agentId;
  }
}
