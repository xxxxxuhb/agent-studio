import type { WorkOrder, WorkOrderGit, WorkOrderRunStep } from "@agent-studio/agent-schema";

export type ParsedBridgeGitNote = {
  sha: string;
  branch: string;
  prUrl: string;
  pushed: boolean;
};

/** Parse Bridge review/git summary text for commit + optional PR/MR URL. */
export function parseBridgeGitNote(text: string): ParsedBridgeGitNote | null {
  if (!text?.trim()) return null;
  if (!/\[bridge\]\s*git:/i.test(text)) return null;

  const committed = text.match(/committed\s+([0-9a-f]{7,40})\s+on\s+(\S+)/i);
  const cleanPush = text.match(
    /pushed\s+existing\s+(\S+)\s+@\s+([0-9a-f]{7,40})/i,
  );
  const sha = committed?.[1] || cleanPush?.[2] || "";
  const branch = (committed?.[2] || cleanPush?.[1] || "").replace(
    /[)\].,;]+$/,
    "",
  );
  if (!sha || !branch) return null;

  const prMatch = text.match(
    /(?:\|\s*pr:\s*|\bpr:\s*|\bopened\s+(?:GitHub\s+)?PR:\s*|\bopened\s+GitLab\s+MR:\s*|\bexisting\s+(?:GitHub\s+PR|GitLab\s+MR):\s*)(https?:\/\/\S+)/i,
  );
  const prUrl = (prMatch?.[1] || "").replace(/[)\].,;]+$/, "");
  const pushed = /\bpushed\b/i.test(text);
  return { sha, branch, prUrl, pushed };
}

export function bridgeGitUnchanged(
  current: WorkOrderGit | undefined,
  parsed: ParsedBridgeGitNote,
): boolean {
  return (
    current?.commit_sha === parsed.sha &&
    (!parsed.prUrl || current?.pr_url === parsed.prUrl)
  );
}

/** Build run.git patch from a parsed Bridge note (does not mutate). */
export function buildBridgeGitState(opts: {
  previous?: WorkOrderGit;
  parsed: ParsedBridgeGitNote;
  stamp: string;
  step?: Pick<WorkOrderRunStep, "step_id">;
}): WorkOrderGit {
  const { previous, parsed, stamp, step } = opts;
  return {
    status: parsed.prUrl
      ? "pr_open"
      : parsed.pushed
        ? "pushed"
        : "committed",
    branch: parsed.branch,
    base_sha: previous?.base_sha || "",
    head_sha: parsed.sha,
    commit_sha: parsed.sha,
    commit_message: previous?.commit_message || "review: pass and commit",
    pr_url: parsed.prUrl || previous?.pr_url || "",
    committed_at: stamp,
    committed_by_step: step?.step_id || previous?.committed_by_step || "",
    note: parsed.prUrl
      ? `Review committed; Bridge opened PR: ${parsed.prUrl}`
      : "Review agent committed working tree changes.",
  };
}

export function bridgeGitEventMessage(parsed: ParsedBridgeGitNote): string {
  return parsed.prUrl
    ? `评审已提交 ${parsed.sha.slice(0, 12)} @ ${parsed.branch}，Bridge 已开 PR: ${parsed.prUrl}`
    : `评审已提交代码 ${parsed.sha.slice(0, 12)} @ ${parsed.branch}`;
}

/** Apply parsed Bridge git note onto a work order run (mutates). Returns false if skipped. */
export function applyBridgeGitNote(
  order: WorkOrder,
  text: string,
  opts: { stamp: string; step?: WorkOrderRunStep },
): boolean {
  if (!order.run) return false;
  const parsed = parseBridgeGitNote(text);
  if (!parsed) return false;
  if (bridgeGitUnchanged(order.run.git, parsed)) return false;
  order.run.git = buildBridgeGitState({
    previous: order.run.git,
    parsed,
    stamp: opts.stamp,
    step: opts.step,
  });
  return true;
}
