import { resolveAgentDriver } from "@agent-studio/agent-runtime";

export type SelectableRepo = {
  id: string;
  name: string;
  role: string;
  local_path: string;
  agents_md_path: string;
  remote_url?: string;
  note?: string;
};

const FRONTEND_TERMS = [
  "前端",
  "frontend",
  "vue",
  "react",
  "页面",
  "ui",
  "组件",
  "css",
  "vite",
];
const BACKEND_TERMS = [
  "后端",
  "backend",
  "api",
  "nestjs",
  "mysql",
  "数据库",
  "service",
  "controller",
];
const ALL_TERMS = ["全部仓库", "所有仓库", "全部仓", "所有仓", "前后端", "全栈改", "多个仓库"];

/** Lower = change earlier (contracts/providers before consumers). */
const ROLE_ORDER: Record<string, number> = {
  infra: 0,
  backend: 1,
  fullstack: 2,
  docs: 3,
  frontend: 4,
  unknown: 5,
};

function roleRank(role: string): number {
  return ROLE_ORDER[role] ?? ROLE_ORDER.unknown!;
}

function scoreRepo(requirement: string, repo: SelectableRepo): number {
  const req = requirement.toLowerCase();
  let score = 0;
  const fe = FRONTEND_TERMS.filter((t) => req.includes(t.toLowerCase())).length;
  const be = BACKEND_TERMS.filter((t) => req.includes(t.toLowerCase())).length;
  if (repo.role === "frontend") score += fe * 3 - be;
  else if (repo.role === "backend") score += be * 3 - fe;
  else if (repo.role === "fullstack") score += Math.max(fe, be);
  if (repo.name && req.includes(repo.name.toLowerCase())) score += 8;
  if (repo.id && req.includes(repo.id.toLowerCase())) score += 5;
  return score;
}

/** Order selected ids to reduce rework: provider/API before consumer/UI. */
function orderForLessRework(
  ids: string[],
  repos: SelectableRepo[],
): { repo_ids: string[]; order_reason: string } {
  const selected = ids
    .map((id) => repos.find((r) => r.id === id))
    .filter((r): r is SelectableRepo => Boolean(r));
  selected.sort((a, b) => {
    const d = roleRank(a.role) - roleRank(b.role);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  return {
    repo_ids: selected.map((r) => r.id),
    order_reason:
      selected.length <= 1
        ? "single repo"
        : `ordered by dependency: ${selected.map((r) => `${r.id}(${r.role})`).join(" → ")} (infra/backend before frontend)`,
  };
}

function heuristicSelect(
  requirement: string,
  repos: SelectableRepo[],
): { repo_ids: string[]; reason: string } {
  if (!repos.length) throw new Error("no repos to select");
  const req = requirement.toLowerCase();
  let ids: string[] = [];
  let reason = "";

  if (ALL_TERMS.some((t) => req.includes(t.toLowerCase()))) {
    ids = repos.map((r) => r.id);
    reason = "heuristic: requirement mentions all/multi repos";
  } else {
    const ranked = [...repos]
      .map((r) => ({ r, score: scoreRepo(requirement, r) }))
      .sort((a, b) => b.score - a.score);
    const positive = ranked.filter((x) => x.score > 0).map((x) => x.r.id);
    if (positive.length) {
      ids = positive;
      reason = `heuristic multi-select score>0 → ${positive.join(",")}`;
    } else {
      const fe = FRONTEND_TERMS.some((t) => req.includes(t.toLowerCase()));
      const be = BACKEND_TERMS.some((t) => req.includes(t.toLowerCase()));
      if (fe && be) {
        ids = repos
          .filter(
            (r) =>
              r.role === "frontend" ||
              r.role === "backend" ||
              r.role === "fullstack",
          )
          .map((r) => r.id);
        reason = "heuristic: both frontend+backend terms → matching roles";
      }
      if (!ids.length) {
        ids = [ranked[0]!.r.id];
        reason = `heuristic single fallback score=${ranked[0]!.score.toFixed(2)} role=${ranked[0]!.r.role}`;
      }
    }
  }

  const ordered = orderForLessRework(ids, repos);
  return {
    repo_ids: ordered.repo_ids,
    reason: `${reason}; ${ordered.order_reason}`,
  };
}

function parseSelection(text: string, repos: SelectableRepo[]): {
  repo_ids: string[];
  reason: string;
} | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      repo_ids?: string[];
      repo_id?: string;
      reason?: string;
      order_reason?: string;
    };
    const ids = obj.repo_ids?.length
      ? obj.repo_ids
      : obj.repo_id
        ? [obj.repo_id]
        : [];
    const seen = new Set<string>();
    const valid: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      if (!repos.some((r) => r.id === id)) continue;
      seen.add(id);
      valid.push(id);
    }
    if (!valid.length) return null;
    const reasonParts = [obj.reason || "manager agent selection"];
    if (obj.order_reason) reasonParts.push(obj.order_reason);
    return {
      repo_ids: valid, // preserve Manager's order
      reason: reasonParts.join("; "),
    };
  } catch {
    return null;
  }
}

/**
 * Manager decides which repos to change and in which order (reduce rework).
 */
export async function managerSelectRepos(opts: {
  requirement: string;
  repos: SelectableRepo[];
  projectName?: string;
}): Promise<{
  repo_ids: string[];
  reason: string;
  driver: string;
  agents_md_path: string;
  agents_md_paths: string[];
}> {
  const { requirement, repos } = opts;
  if (!repos.length) throw new Error("project has no repos");

  const driver = resolveAgentDriver();

  const catalog = repos
    .map(
      (r) =>
        `- id=${r.id} name=${r.name} role=${r.role} path=${r.local_path} agents=${r.agents_md_path}`,
    )
    .join("\n");
  const prompt = `
You are the Manager agent for project "${opts.projectName || ""}".
Plan which git repositories this work order must modify, AND the change order.

Selection (critical):
- Include EVERY repo that needs code/docs changes for a correct end-to-end delivery.
- Do NOT decide only from surface keywords (e.g. "页面/登录/UI" ≠ frontend-only).
- User-facing features almost always need BOTH UI and API/auth/data (backend) when such repos exist.
- Examples that usually need frontend + backend: login, register, CRUD screens, permissions, uploads, payments.
- Exclude only repos that are truly unrelated after thinking about APIs, auth, storage, and shared contracts.

Ordering (critical — reduce rework):
- Put providers/contracts first: API schema, backend services, shared libs, infra.
- Put consumers later: frontend/UI that depends on those APIs.
- If A defines an interface that B implements or calls, A before B.
- repo_ids array order = execution order (index 0 runs first).

Reply with ONLY JSON:
{"repo_ids":["first_repo","second_repo"],"reason":"why these repos","order_reason":"why this order"}

Repositories:
${catalog}

Requirement:
${requirement}
`.trim();

  let selection: { repo_ids: string[]; reason: string } | null = null;
  try {
    const result = await driver.run({
      stage: "manager",
      cwd: repos[0]!.local_path,
      prompt,
    });
    selection = parseSelection(result.raw || result.summary, repos);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Manager agent failed while selecting repos: ${msg}`);
  }

  if (!selection?.repo_ids.length) {
    throw new Error(
      "Manager agent did not return valid JSON repo_ids. Refusing keyword heuristic fallback.",
    );
  }

  if (
    selection.repo_ids.length > 1 &&
    !/order|顺序|先|后|→|before|after/i.test(selection.reason)
  ) {
    selection = {
      ...selection,
      reason: `${selection.reason}; execution order = repo_ids array order`,
    };
  }

  const selectedRepos = selection.repo_ids
    .map((id) => repos.find((r) => r.id === id))
    .filter((r): r is SelectableRepo => Boolean(r));
  if (!selectedRepos.length) {
    throw new Error("Manager returned repo_ids that do not match the project catalog");
  }
  const primary = selectedRepos[0]!;
  return {
    repo_ids: selectedRepos.map((r) => r.id),
    reason: selection.reason,
    driver: driver.id,
    agents_md_path: primary.agents_md_path,
    agents_md_paths: selectedRepos.map((r) => r.agents_md_path),
  };
}
