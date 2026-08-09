import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";
import {
  ProjectCreateSchema,
  ProjectRepoSchema,
  ProjectSchema,
  ProjectUpdateSchema,
  type Project,
  type ProjectCreate,
  type ProjectRepo,
  type ProjectUpdate,
} from "@agent-studio/agent-schema";
import {
  ensureLocalOriginSsh,
  resolveCloneRemoteUrl,
  studioGitEnv,
} from "./git-remote";

const execFileAsync = promisify(execFile);

/** OS-specific default for cloned git repos (outside the Studio monorepo). */
export function defaultStudioReposRoot(): string {
  const fromEnv = (process.env.STUDIO_REPOS_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  // Windows: C:\.agent-studio
  // macOS/Linux: ~/AgentStudio (under home, Finder-visible; avoid clashing with ~/agent-studio monorepo)
  if (process.platform === "win32") {
    return path.resolve("C:\\.agent-studio");
  }
  return path.join(os.homedir(), "AgentStudio");
}

@Injectable()
export class ProjectsService implements OnModuleInit {
  private dataDir = "";
  private defaultReposRoot = "";

  onModuleInit() {
    this.dataDir = path.resolve(
      process.env.STUDIO_PROJECT_DIR ||
        path.join(process.cwd(), "data", "projects"),
    );
    this.defaultReposRoot = defaultStudioReposRoot();
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.defaultReposRoot, { recursive: true });
  }

  /** Absolute default clone root (STUDIO_REPOS_DIR or OS default). */
  getDefaultReposRoot() {
    return this.defaultReposRoot;
  }

  private filePath(id: string) {
    return path.join(this.dataDir, `${id}.yaml`);
  }

  private nowIso() {
    return new Date().toISOString();
  }

  resolveCloneRoot(project: Project): string {
    const raw = (project.clone_root || "").trim();
    if (raw) return path.resolve(raw);
    return path.join(this.defaultReposRoot, project.id);
  }

  resolveRepoLocalPath(project: Project, repo: ProjectRepo): string {
    const raw = (repo.local_path || "").trim();
    if (raw) {
      return path.isAbsolute(raw)
        ? raw
        : path.resolve(this.resolveCloneRoot(project), raw);
    }
    return path.join(this.resolveCloneRoot(project), repo.id);
  }

  resolveAgentsMdPath(project: Project, repo: ProjectRepo): string {
    const local = this.resolveRepoLocalPath(project, repo);
    const rel = (repo.agents_md || "AGENTS.md").trim() || "AGENTS.md";
    return path.isAbsolute(rel) ? rel : path.join(local, rel);
  }

  list(filters?: { q?: string; enabled?: string }) {
    const files = fs
      .readdirSync(this.dataDir)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
    let items = files.map((file) =>
      ProjectSchema.parse(
        YAML.parse(fs.readFileSync(path.join(this.dataDir, file), "utf8")),
      ),
    );
    if (filters?.enabled === "true") items = items.filter((p) => p.enabled);
    if (filters?.enabled === "false") items = items.filter((p) => !p.enabled);
    if (filters?.q?.trim()) {
      const n = filters.q.trim().toLowerCase();
      items = items.filter(
        (p) =>
          p.id.includes(n) ||
          p.name.toLowerCase().includes(n) ||
          (p.description || "").toLowerCase().includes(n),
      );
    }
    return items
      .map((p) => this.withResolvedPaths(p))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): Project {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`project not found: ${id}`);
    return this.withResolvedPaths(
      ProjectSchema.parse(YAML.parse(fs.readFileSync(fp, "utf8"))),
    );
  }

  private withResolvedPaths(project: Project): Project {
    const clone_root = this.resolveCloneRoot(project);
    return {
      ...project,
      clone_root,
      repos: project.repos.map((r) => ({
        ...r,
        local_path: this.resolveRepoLocalPath(project, r),
      })),
    };
  }

  private write(project: Project): Project {
    const next = ProjectSchema.parse({
      ...project,
      updated_at: this.nowIso(),
      created_at: project.created_at || this.nowIso(),
    });
    // Persist relative preference: store user-provided clone_root/local_path as given in YAML
    fs.writeFileSync(
      this.filePath(next.id),
      `# Project ${next.id}\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    return this.withResolvedPaths(next);
  }

  create(input: unknown): Project {
    const body = ProjectCreateSchema.parse(input);
    if (fs.existsSync(this.filePath(body.id))) {
      throw new ConflictException(`project already exists: ${body.id}`);
    }
    return this.write({
      ...body,
      repos: (body.repos || []).map((r) =>
        ProjectRepoSchema.parse({ ...r, clone_status: r.clone_status || "pending" }),
      ),
      created_at: this.nowIso(),
    });
  }

  update(id: string, patch: unknown): Project {
    const current = this.getRaw(id);
    const parsed = ProjectUpdateSchema.parse(patch);
    return this.write(
      ProjectSchema.parse({
        ...current,
        ...parsed,
        id,
        repos: parsed.repos ?? current.repos,
      }),
    );
  }

  private getRaw(id: string): Project {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`project not found: ${id}`);
    return ProjectSchema.parse(YAML.parse(fs.readFileSync(fp, "utf8")));
  }

  remove(id: string) {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`project not found: ${id}`);
    fs.unlinkSync(fp);
    return { ok: true, id };
  }

  addRepo(projectId: string, input: unknown): Project {
    const project = this.getRaw(projectId);
    const repo = ProjectRepoSchema.parse({
      ...(typeof input === "object" && input ? input : {}),
      clone_status: "pending",
      clone_error: "",
    });
    if (project.repos.some((r) => r.id === repo.id)) {
      throw new ConflictException(`repo already exists: ${repo.id}`);
    }
    project.repos.push(repo);
    return this.write(project);
  }

  removeRepo(projectId: string, repoId: string): Project {
    const project = this.getRaw(projectId);
    const next = project.repos.filter((r) => r.id !== repoId);
    if (next.length === project.repos.length) {
      throw new NotFoundException(`repo not found: ${repoId}`);
    }
    project.repos = next;
    return this.write(project);
  }

  /**
   * Ensure each repo exists locally:
   * - path exists + .git → ready (skip clone)
   * - path missing → git clone into clone_root/repo.id
   * - path exists but not git → error
   */
  async ensureCloned(projectId: string, repoIds?: string[]): Promise<Project> {
    const project = this.getRaw(projectId);
    const cloneRoot = this.resolveCloneRoot(project);
    fs.mkdirSync(cloneRoot, { recursive: true });

    const targets = repoIds?.length
      ? project.repos.filter((r) => repoIds.includes(r.id))
      : project.repos;

    for (const repo of targets) {
      const local = this.resolveRepoLocalPath(project, repo);
      const idx = project.repos.findIndex((r) => r.id === repo.id);
      if (idx < 0) continue;
      try {
        if (fs.existsSync(local)) {
          if (fs.existsSync(path.join(local, ".git"))) {
            ensureLocalOriginSsh(local);
            this.ensureAgentsMdForLocal(project, repo, local);
            project.repos[idx] = {
              ...project.repos[idx],
              local_path: project.repos[idx].local_path || "",
              clone_status: "ready",
              clone_error: "",
              last_synced_at: this.nowIso(),
            };
            continue;
          }
          throw new Error(
            `路径已存在但不是 git 仓库: ${local}（请清空或改 local_path / clone_root）`,
          );
        }

        fs.mkdirSync(path.dirname(local), { recursive: true });
        const branch = repo.default_branch || "main";
        const cloneUrl = resolveCloneRemoteUrl(repo.remote_url);
        const gitEnv = studioGitEnv();
        await execFileAsync(
          "git",
          [
            "clone",
            "--branch",
            branch,
            "--single-branch",
            cloneUrl,
            local,
          ],
          { timeout: 120_000, env: gitEnv },
        ).catch(async (err) => {
          // branch may not exist remotely — retry without --branch
          const msg = err instanceof Error ? err.message : String(err);
          if (/Remote branch|not found|did not match/i.test(msg)) {
            await execFileAsync("git", ["clone", cloneUrl, local], {
              timeout: 120_000,
              env: gitEnv,
            });
            return;
          }
          throw err;
        });

        ensureLocalOriginSsh(local);
        this.ensureAgentsMdForLocal(project, repo, local);

        project.repos[idx] = {
          ...project.repos[idx],
          clone_status: "ready",
          clone_error: "",
          last_synced_at: this.nowIso(),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        project.repos[idx] = {
          ...project.repos[idx],
          clone_status: "error",
          clone_error: msg,
          last_synced_at: this.nowIso(),
        };
      }
    }

    return this.write(project);
  }

  /**
   * Ensure AGENTS.md exists and project.repo_path points at this clone.
   * Remote AGENTS.md often ships with a machine-specific absolute repo_path;
   * without rewrite, Bridge writes docs/dify-runs into the wrong tree.
   */
  private ensureAgentsMdForLocal(
    project: Project,
    repo: ProjectRepo,
    local: string,
  ) {
    const agentsMd = this.resolveAgentsMdPath(project, {
      ...repo,
      local_path: local,
    });
    if (!fs.existsSync(agentsMd)) {
      this.writeMinimalAgentsMd(agentsMd, project, repo, local);
      return;
    }
    this.syncAgentsMdRepoPath(agentsMd, local);
  }

  /** Rewrite frontmatter `repo_path:` to the actual local clone path. */
  private syncAgentsMdRepoPath(agentsMdPath: string, localRepoPath: string) {
    const raw = fs.readFileSync(agentsMdPath, "utf8");
    if (!/^repo_path:\s*.+$/m.test(raw)) return;
    const next = raw.replace(/^(\s*repo_path:\s*).+$/m, `$1${localRepoPath}`);
    if (next !== raw) {
      fs.writeFileSync(agentsMdPath, next, "utf8");
    }
  }

  private writeMinimalAgentsMd(
    agentsMdPath: string,
    project: Project,
    repo: ProjectRepo,
    local: string,
  ) {
    const content = `---
project:
  name: ${repo.name}
  repo_path: ${local}
  default_branch: ${repo.default_branch || "main"}
  role: ${repo.role || "unknown"}

pipeline:
  runs_dir: docs/dify-runs/{run_id}
  requirement_doc: docs/dify-runs/{run_id}/requirement.md
  plan_doc: docs/dify-runs/{run_id}/plan.md
  dev_summary: docs/dify-runs/{run_id}/dev-summary.md
  review_doc: docs/dify-runs/{run_id}/review-report.md
  test_report: docs/dify-runs/{run_id}/test-report.md
  release_notes: docs/dify-runs/{run_id}/release-notes-test.md
  status_doc: docs/dify-runs/{run_id}/run-status.md

commands:
  install: ""
  test: ""
  lint: ""
  deploy_staging: ""
  smoke_staging: ""

release:
  target: staging
  production: disabled

constraints:
  require_human_approval_each_stage: true
  forbidden_paths:
    - .git/
---

# AGENTS

Auto-generated for Studio project \`${project.id}\` / repo \`${repo.id}\`.
`;
    fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
    fs.writeFileSync(agentsMdPath, content, "utf8");
  }

  catalogForManager(projectId: string) {
    const project = this.get(projectId);
    return {
      project_id: project.id,
      project_name: project.name,
      clone_root: this.resolveCloneRoot(project),
      repos: project.repos.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        remote_url: r.remote_url,
        local_path: this.resolveRepoLocalPath(project, r),
        agents_md_path: this.resolveAgentsMdPath(project, r),
        clone_status: r.clone_status,
        default_branch: r.default_branch,
        note: r.note,
      })),
    };
  }
}
