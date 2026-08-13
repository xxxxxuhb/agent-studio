/**
 * Forge HTTP helpers (GitHub / GitLab MR·PR) via Octokit + Gitbeaker.
 * Keeps token / base URL resolution in one place; git.ts calls these.
 */
import { Gitlab } from "@gitbeaker/rest";
import { Octokit } from "@octokit/rest";

export type ForgeKind = "github" | "gitlab";

export type OpenMergeResult = {
  url?: string;
  note: string;
  existing?: boolean;
};

function githubToken(): string {
  return (
    process.env.BRIDGE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    ""
  ).trim();
}

function gitlabToken(): string {
  return (
    process.env.BRIDGE_GITLAB_TOKEN ||
    process.env.GITLAB_TOKEN ||
    process.env.PRIVATE_TOKEN ||
    ""
  ).trim();
}

export async function openGithubPullRequest(opts: {
  apiBase: string;
  projectPath: string;
  title: string;
  head: string;
  base: string;
  body: string;
}): Promise<OpenMergeResult> {
  const token = githubToken();
  if (!token) {
    return {
      note: "PR skipped: set GITHUB_TOKEN (or BRIDGE_GITHUB_TOKEN) in bridge .env",
    };
  }
  const [owner, repo] = opts.projectPath.split("/");
  if (!owner || !repo) {
    return { note: `PR skipped: bad GitHub project path ${opts.projectPath}` };
  }
  const baseUrl = opts.apiBase.replace(/\/$/, "");
  const octokit = new Octokit({
    auth: token,
    baseUrl: baseUrl === "https://api.github.com" ? undefined : baseUrl,
    userAgent: "agent-studio-bridge",
    request: { timeout: 30_000 },
  });

  try {
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
      draft: false,
    });
    const url = data.html_url || "";
    return { url, note: `opened GitHub PR: ${url}` };
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: number }).status)
        : 0;
    if (status === 422) {
      try {
        const list = await octokit.pulls.list({
          owner,
          repo,
          state: "open",
          head: `${owner}:${opts.head}`,
        });
        const existing = list.data[0];
        if (existing?.html_url) {
          return {
            url: existing.html_url,
            existing: true,
            note: `existing GitHub PR: ${existing.html_url}`,
          };
        }
      } catch {
        /* fall through */
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      note: `GitHub PR failed: ${msg.slice(0, 200)}`,
    };
  }
}

export async function openGitlabMergeRequest(opts: {
  apiBase: string;
  projectPath: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  description: string;
}): Promise<OpenMergeResult> {
  const token = gitlabToken();
  if (!token) {
    return {
      note: "PR/MR skipped: set GITLAB_TOKEN (or BRIDGE_GITLAB_TOKEN) in bridge .env",
    };
  }
  const host = opts.apiBase.replace(/\/$/, "").replace(/\/api\/v4$/i, "");
  const api = new Gitlab({
    host,
    token,
    camelize: false,
  });

  try {
    const mr = (await api.MergeRequests.create(
      opts.projectPath,
      opts.sourceBranch,
      opts.targetBranch,
      opts.title,
      {
        description: opts.description,
        removeSourceBranch: false,
      },
    )) as { web_url?: string; webUrl?: string };
    const url = String(mr.web_url || mr.webUrl || "");
    return { url, note: `opened GitLab MR: ${url}` };
  } catch (err) {
    try {
      const list = (await api.MergeRequests.all({
        projectId: opts.projectPath,
        sourceBranch: opts.sourceBranch,
        state: "opened",
      })) as Array<{ web_url?: string; webUrl?: string }>;
      const existing = list[0];
      const url = String(existing?.web_url || existing?.webUrl || "");
      if (url) {
        return {
          url,
          existing: true,
          note: `existing GitLab MR: ${url}`,
        };
      }
    } catch {
      /* fall through */
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      note: `GitLab MR failed: ${msg.slice(0, 200)}`,
    };
  }
}
