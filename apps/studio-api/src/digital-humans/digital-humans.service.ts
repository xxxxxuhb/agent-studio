import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  DigitalHumanCreateSchema,
  DigitalHumanSchema,
  DigitalHumanUpdateSchema,
  type DigitalHuman,
  type DigitalHumanCreate,
  type DigitalHumanUpdate,
} from "@agent-studio/agent-schema";
import { TeamsService } from "../teams/teams.service";
import { DEFAULT_DIGITAL_HUMANS } from "./defaults";

@Injectable()
export class DigitalHumansService {
  private dataDir = path.resolve(
    process.env.STUDIO_DATA_DIR || path.join(process.cwd(), "data", "agents"),
  );

  constructor(private readonly teams: TeamsService) {}

  getDataDir() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    return this.dataDir;
  }

  private filePath(id: string) {
    return path.join(this.getDataDir(), `${id}.yaml`);
  }

  private nowIso() {
    return new Date().toISOString();
  }

  private inScopedTeams(teamId: string | undefined, scoped: string[]) {
    const tid = (teamId || "").trim();
    if (!tid) return false;
    return scoped.includes(tid);
  }

  private async assertReadable(userId: string, agent: DigitalHuman) {
    const tid = (agent.team_id || "").trim();
    if (!tid) {
      throw new NotFoundException(`not found: ${agent.id}`);
    }
    await this.teams.requireMember(tid, userId);
  }

  list(filters?: { enabled?: "true" | "false" | "all"; role?: string; q?: string }) {
    const dir = this.getDataDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
    let items = files.map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      return DigitalHumanSchema.parse(YAML.parse(raw));
    });

    const enabled = filters?.enabled ?? "all";
    if (enabled === "true") items = items.filter((a) => a.enabled);
    if (enabled === "false") items = items.filter((a) => !a.enabled);
    if (filters?.role) items = items.filter((a) => a.role === filters.role);
    if (filters?.q?.trim()) {
      const needle = filters.q.trim().toLowerCase();
      items = items.filter(
        (a) =>
          a.id.includes(needle) ||
          a.name.toLowerCase().includes(needle) ||
          (a.description || "").toLowerCase().includes(needle) ||
          a.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  async listForUser(
    userId: string,
    filters?: {
      enabled?: "true" | "false" | "all";
      role?: string;
      q?: string;
      team_id?: string;
    },
  ) {
    const scoped = await this.teams.resolveScopedTeamIds(
      userId,
      filters?.team_id,
    );
    if (!scoped.length) return [];
    return this.list(filters).filter((a) =>
      this.inScopedTeams(a.team_id, scoped),
    );
  }

  get(id: string): DigitalHuman {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`not found: ${id}`);
    return DigitalHumanSchema.parse(YAML.parse(fs.readFileSync(fp, "utf8")));
  }

  async getForUser(userId: string, id: string): Promise<DigitalHuman> {
    const agent = this.get(id);
    await this.assertReadable(userId, agent);
    return agent;
  }

  create(input: DigitalHumanCreate): DigitalHuman {
    let body: DigitalHumanCreate;
    try {
      body = DigitalHumanCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    if (fs.existsSync(this.filePath(body.id))) {
      throw new ConflictException(`already exists: ${body.id}`);
    }
    return this.write(body as DigitalHuman);
  }

  async createForUser(
    userId: string,
    input: DigitalHumanCreate,
  ): Promise<DigitalHuman> {
    let body: DigitalHumanCreate;
    try {
      body = DigitalHumanCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
    const teamId = (body.team_id || "").trim();
    if (!teamId) {
      throw new BadRequestException("team_id is required");
    }
    await this.teams.requireWritableMember(teamId, userId);
    return this.create({ ...body, team_id: teamId });
  }

  update(id: string, patch: DigitalHumanUpdate): DigitalHuman {
    const current = this.get(id);
    try {
      const parsed = DigitalHumanUpdateSchema.parse(patch);
      const merged = DigitalHumanSchema.parse({
        ...current,
        ...parsed,
        id,
        team_id: current.team_id,
        permissions: {
          ...current.permissions,
          ...(parsed.permissions || {}),
        },
      });
      return this.write(merged);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  async updateForUser(
    userId: string,
    id: string,
    patch: DigitalHumanUpdate,
  ): Promise<DigitalHuman> {
    const current = this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.update(id, patch);
  }

  setEnabled(id: string, enabled: boolean): DigitalHuman {
    return this.write({ ...this.get(id), enabled });
  }

  async setEnabledForUser(
    userId: string,
    id: string,
    enabled: boolean,
  ): Promise<DigitalHuman> {
    const current = this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.setEnabled(id, enabled);
  }

  remove(id: string) {
    const fp = this.filePath(id);
    if (!fs.existsSync(fp)) throw new NotFoundException(`not found: ${id}`);
    fs.unlinkSync(fp);
    return { ok: true as const, id };
  }

  async removeForUser(userId: string, id: string) {
    const current = this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.remove(id);
  }

  seedDefaults(teamId = "") {
    const imported: string[] = [];
    const skipped: string[] = [];
    const upgraded: string[] = [];
    for (const item of DEFAULT_DIGITAL_HUMANS) {
      if (!fs.existsSync(this.filePath(item.id))) {
        this.write(DigitalHumanSchema.parse({ ...item, team_id: teamId || "" }));
        imported.push(item.id);
        continue;
      }
      const current = this.get(item.id);
      const currentTeam = (current.team_id || "").trim();
      if (teamId && currentTeam && currentTeam !== teamId) {
        skipped.push(item.id);
        continue;
      }
      // Soft-upgrade built-in agents when new permission fields appear (e.g. may_commit).
      if (item.id === "code_review") {
        const stillBridgeCommits =
          /由 Bridge (commit|提交)/.test(current.description || "") ||
          current.prompt_hints.some((h) =>
            /由 Bridge commit|允许 Bridge commit|Bridge commit \+ push/.test(h),
          );
        const needsCommit =
          stillBridgeCommits ||
          current.permissions.may_commit !== true ||
          !current.commands.includes("commit") ||
          !current.prompt_hints.some((h) => /push|远端|commit-record/.test(h)) ||
          !current.prompt_hints.some((h) => /PR|MR|合并/.test(h)) ||
          !/PR|MR|合并|commit-record/.test(current.description || "");
        if (needsCommit) {
          this.write(
            DigitalHumanSchema.parse({
              ...current,
              team_id: currentTeam || teamId || "",
              description: item.description,
              responsibilities: item.responsibilities,
              permissions: {
                ...current.permissions,
                may_commit: true,
              },
              outputs: item.outputs,
              commands: item.commands,
              prompt_hints: item.prompt_hints,
            }),
          );
          upgraded.push(item.id);
          continue;
        }
      }
      if (item.id === "fullstack_dev") {
        const needsBranch =
          !current.prompt_hints.some((h) => /开发分支|checkout/.test(h)) ||
          !current.prompt_hints.some((h) => /灌流/.test(h));
        if (needsBranch) {
          this.write(
            DigitalHumanSchema.parse({
              ...current,
              team_id: currentTeam || teamId || "",
              description: item.description,
              responsibilities: item.responsibilities,
              permissions: {
                ...current.permissions,
                may_commit: false,
              },
              prompt_hints: item.prompt_hints,
            }),
          );
          upgraded.push(item.id);
          continue;
        }
      }
      skipped.push(item.id);
    }
    return {
      imported,
      skipped,
      upgraded,
      total: this.list().length,
      dataDir: this.dataDir,
    };
  }

  async seedDefaultsForUser(userId: string, teamId: string) {
    const tid = (teamId || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireWritableMember(tid, userId);
    return this.seedDefaults(tid);
  }

  private write(agent: DigitalHuman): DigitalHuman {
    const stamp = this.nowIso();
    const existing = fs.existsSync(this.filePath(agent.id)) ? this.get(agent.id) : null;
    const next = DigitalHumanSchema.parse({
      ...agent,
      created_at: agent.created_at || existing?.created_at || stamp,
      updated_at: stamp,
    });
    fs.writeFileSync(
      this.filePath(next.id),
      `# Agent Studio digital human\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    return next;
  }
}
