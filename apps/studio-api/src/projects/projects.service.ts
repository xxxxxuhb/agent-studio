import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { In, Repository } from "typeorm";
import {
  ProjectCreateSchema,
  ProjectRepoSchema,
  ProjectSchema,
  ProjectUpdateSchema,
  type Project,
  type ProjectRepo,
} from "@agent-studio/agent-schema";
import {
  ensureLocalOriginSsh,
  resolveCloneRemoteUrl,
  studioGitEnv,
} from "./git-remote";
import { ProjectEntity } from "./entities/project.entity";
import { TeamsService } from "../teams/teams.service";

const execFileAsync = promisify(execFile);

/** OS-specific default for cloned git repos (outside the Studio monorepo). */
export function defaultStudioReposRoot(): string {
  const fromEnv = (process.env.STUDIO_REPOS_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (process.platform === "win32") {
    return path.resolve("C:\\.agent-studio");
  }
  return path.join(os.homedir(), "AgentStudio");
}

@Injectable()
export class ProjectsService implements OnModuleInit {
  private defaultReposRoot = "";

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly repo: Repository<ProjectEntity>,
    private readonly teams: TeamsService,
  ) {}

  onModuleInit() {
    this.defaultReposRoot = defaultStudioReposRoot();
    fs.mkdirSync(this.defaultReposRoot, { recursive: true });
  }

  getDefaultReposRoot() {
    return this.defaultReposRoot;
  }

  private nowIso() {
    return new Date().toISOString();
  }

  private toProject(entity: ProjectEntity): Project {
    return ProjectSchema.parse({
      id: entity.id,
      team_id: entity.team_id,
      name: entity.name,
      description: entity.description || "",
      clone_root: entity.clone_root || "",
      repos: entity.repos || [],
      enabled: entity.enabled !== false,
      tags: entity.tags || [],
      created_at: entity.created_at?.toISOString?.() || undefined,
      updated_at: entity.updated_at?.toISOString?.() || undefined,
    });
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

  async listTeamIdsForUser(userId: string) {
    return this.teams.listTeamIdsForUser(userId);
  }

  async assertCanAccessProject(userId: string, projectId: string): Promise<Project> {
    const project = await this.getRaw(projectId);
    await this.teams.assertTeamAccess(project.team_id, userId);
    return project;
  }

  async userCanAccessProject(userId: string, projectId: string): Promise<boolean> {
    try {
      await this.assertCanAccessProject(userId, projectId);
      return true;
    } catch {
      return false;
    }
  }

  async list(
    userId: string,
    filters?: { q?: string; enabled?: string; team_id?: string },
  ) {
    const teamIds = await this.teams.listTeamIdsForUser(userId);
    if (!teamIds.length) return [];
    let scoped = teamIds;
    if (filters?.team_id) {
      if (!teamIds.includes(filters.team_id)) {
        throw new ForbiddenException("你不是该团队成员");
      }
      scoped = [filters.team_id];
    }
    let items = await this.repo.find({ where: { team_id: In(scoped) } });
    let projects = items.map((e) => this.toProject(e));
    if (filters?.enabled === "true") projects = projects.filter((p) => p.enabled);
    if (filters?.enabled === "false") projects = projects.filter((p) => !p.enabled);
    if (filters?.q?.trim()) {
      const n = filters.q.trim().toLowerCase();
      projects = projects.filter(
        (p) =>
          p.id.includes(n) ||
          p.name.toLowerCase().includes(n) ||
          (p.description || "").toLowerCase().includes(n),
      );
    }
    return projects
      .map((p) => this.withResolvedPaths(p))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async getForUser(userId: string, id: string): Promise<Project> {
    const project = await this.assertCanAccessProject(userId, id);
    return this.withResolvedPaths(project);
  }

  /** Load project by id without ACL (server-side orchestration). */
  async getById(id: string): Promise<Project> {
    return this.withResolvedPaths(await this.getRaw(id));
  }

  /** @deprecated use getForUser / getById */
  async get(idOrUserId: string, maybeId?: string): Promise<Project> {
    if (maybeId !== undefined) return this.getForUser(idOrUserId, maybeId);
    return this.getById(idOrUserId);
  }

  private async getRaw(id: string): Promise<Project> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`project not found: ${id}`);
    return this.toProject(entity);
  }

  private async save(project: Project): Promise<Project> {
    const next = ProjectSchema.parse({
      ...project,
      updated_at: this.nowIso(),
      created_at: project.created_at || this.nowIso(),
    });
    await this.repo.save({
      id: next.id,
      team_id: next.team_id,
      name: next.name,
      description: next.description || "",
      clone_root: next.clone_root || "",
      repos: next.repos || [],
      enabled: next.enabled !== false,
      tags: next.tags || [],
      created_at: next.created_at ? new Date(next.created_at) : new Date(),
      updated_at: new Date(next.updated_at || Date.now()),
    });
    return this.withResolvedPaths(next);
  }

  async create(userId: string, input: unknown): Promise<Project> {
    const body = ProjectCreateSchema.parse(input);
    await this.teams.requireWritableMember(body.team_id, userId);
    const exists = await this.repo.findOne({ where: { id: body.id } });
    if (exists) {
      throw new ConflictException(`project already exists: ${body.id}`);
    }
    return this.save({
      ...body,
      repos: (body.repos || []).map((r) =>
        ProjectRepoSchema.parse({ ...r, clone_status: r.clone_status || "pending" }),
      ),
      created_at: this.nowIso(),
    });
  }

  async update(userId: string, id: string, patch: unknown): Promise<Project> {
    const current = await this.assertCanAccessProject(userId, id);
    await this.teams.requireWritableMember(current.team_id, userId);
    const parsed = ProjectUpdateSchema.parse(patch);
    return this.save(
      ProjectSchema.parse({
        ...current,
        ...parsed,
        id,
        team_id: current.team_id,
        repos: parsed.repos ?? current.repos,
      }),
    );
  }

  async remove(userId: string, id: string) {
    const project = await this.assertCanAccessProject(userId, id);
    await this.teams.requireOwner(project.team_id, userId);
    await this.repo.delete({ id });
    return { ok: true as const, id };
  }

  async addRepo(userId: string, projectId: string, input: unknown): Promise<Project> {
    const project = await this.assertCanAccessProject(userId, projectId);
    await this.teams.requireWritableMember(project.team_id, userId);
    const repo = ProjectRepoSchema.parse({
      ...(typeof input === "object" && input ? input : {}),
      clone_status: "pending",
      clone_error: "",
    });
    if (project.repos.some((r) => r.id === repo.id)) {
      throw new ConflictException(`repo already exists: ${repo.id}`);
    }
    project.repos.push(repo);
    return this.save(project);
  }

  async removeRepo(
    userId: string,
    projectId: string,
    repoId: string,
  ): Promise<Project> {
    const project = await this.assertCanAccessProject(userId, projectId);
    await this.teams.requireWritableMember(project.team_id, userId);
    const next = project.repos.filter((r) => r.id !== repoId);
    if (next.length === project.repos.length) {
      throw new NotFoundException(`repo not found: ${repoId}`);
    }
    project.repos = next;
    return this.save(project);
  }

  async ensureCloned(
    userId: string | null,
    projectId: string,
    repoIds?: string[],
  ): Promise<Project> {
    const project =
      userId == null
        ? await this.getRaw(projectId)
        : await this.assertCanAccessProject(userId, projectId);
    if (userId != null) {
      await this.teams.requireWritableMember(project.team_id, userId);
    }
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
          ["clone", "--branch", branch, "--single-branch", cloneUrl, local],
          { timeout: 120_000, env: gitEnv },
        ).catch(async (err) => {
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

    return this.save(project);
  }

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

  async catalogForManager(userId: string | null, projectId: string) {
    const project =
      userId == null
        ? await this.getById(projectId)
        : await this.getForUser(userId, projectId);
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
