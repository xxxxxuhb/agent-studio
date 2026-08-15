import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  DigitalHumanCreateSchema,
  DigitalHumanSchema,
  DigitalHumanUpdateSchema,
  bridgeBindingFromLegacy,
  digitalHumanFromRow,
  type DigitalHuman,
  type DigitalHumanCreate,
  type DigitalHumanUpdate,
} from "@agent-studio/agent-schema";
import { TeamsService } from "../teams/teams.service";
import { DEFAULT_DIGITAL_HUMANS } from "./defaults";
import { DigitalHumanEntity } from "./entities/digital-human.entity";

@Injectable()
export class DigitalHumansService {
  constructor(
    @InjectRepository(DigitalHumanEntity)
    private readonly repo: Repository<DigitalHumanEntity>,
    private readonly teams: TeamsService,
  ) {}

  private nowIso() {
    return new Date().toISOString();
  }

  private toDigitalHuman(entity: DigitalHumanEntity): DigitalHuman {
    return digitalHumanFromRow({
      id: entity.id,
      team_id: entity.team_id || "",
      name: entity.name,
      role: entity.role,
      description: entity.description || "",
      responsibilities: entity.responsibilities || [],
      permissions: entity.permissions || {},
      inputs: entity.inputs || [],
      outputs: entity.outputs || [],
      commands: entity.commands || [],
      human_gate_default: entity.human_gate_default !== false,
      prompt_hints: entity.prompt_hints || [],
      enabled: entity.enabled !== false,
      avatar_label: entity.avatar_label || "",
      tags: entity.tags || [],
      bridge: entity.bridge || {},
      created_at: entity.created_at?.toISOString?.() || undefined,
      updated_at: entity.updated_at?.toISOString?.() || undefined,
    });
  }

  private toEntityFields(agent: DigitalHuman): Partial<DigitalHumanEntity> {
    return {
      id: agent.id,
      team_id: (agent.team_id || "").trim(),
      name: agent.name,
      role: agent.role,
      description: agent.description || "",
      responsibilities: agent.responsibilities || [],
      permissions: agent.permissions as Record<string, unknown>,
      inputs: agent.inputs || [],
      outputs: agent.outputs || [],
      commands: agent.commands || [],
      human_gate_default: agent.human_gate_default !== false,
      prompt_hints: agent.prompt_hints || [],
      enabled: agent.enabled !== false,
      avatar_label: agent.avatar_label || "",
      tags: agent.tags || [],
      bridge: bridgeBindingFromLegacy(agent.bridge) as Record<string, unknown>,
      created_at: agent.created_at ? new Date(agent.created_at) : undefined,
      updated_at: agent.updated_at ? new Date(agent.updated_at) : undefined,
    };
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

  async list(filters?: {
    enabled?: "true" | "false" | "all";
    role?: string;
    q?: string;
  }) {
    let items = (await this.repo.find()).map((e) => this.toDigitalHuman(e));

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
    return (await this.list(filters)).filter((a) =>
      this.inScopedTeams(a.team_id, scoped),
    );
  }

  async get(id: string): Promise<DigitalHuman> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`not found: ${id}`);
    return this.toDigitalHuman(entity);
  }

  async getForUser(userId: string, id: string): Promise<DigitalHuman> {
    const agent = await this.get(id);
    await this.assertReadable(userId, agent);
    return agent;
  }

  async create(input: DigitalHumanCreate): Promise<DigitalHuman> {
    let body: DigitalHumanCreate;
    try {
      body = DigitalHumanCreateSchema.parse(input);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const exists = await this.repo.findOne({ where: { id: body.id } });
    if (exists) throw new ConflictException(`already exists: ${body.id}`);
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
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const teamId = (body.team_id || "").trim();
    if (!teamId) {
      throw new BadRequestException("team_id is required");
    }
    await this.teams.requireWritableMember(teamId, userId);
    return this.create({ ...body, team_id: teamId });
  }

  async update(id: string, patch: DigitalHumanUpdate): Promise<DigitalHuman> {
    const current = await this.get(id);
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
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async updateForUser(
    userId: string,
    id: string,
    patch: DigitalHumanUpdate,
  ): Promise<DigitalHuman> {
    const current = await this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.update(id, patch);
  }

  async setEnabled(id: string, enabled: boolean): Promise<DigitalHuman> {
    return this.write({ ...(await this.get(id)), enabled });
  }

  async setEnabledForUser(
    userId: string,
    id: string,
    enabled: boolean,
  ): Promise<DigitalHuman> {
    const current = await this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.setEnabled(id, enabled);
  }

  async remove(id: string) {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`not found: ${id}`);
    await this.repo.remove(entity);
    return { ok: true as const, id };
  }

  async removeForUser(userId: string, id: string) {
    const current = await this.get(id);
    await this.assertReadable(userId, current);
    await this.teams.requireWritableMember(current.team_id, userId);
    return this.remove(id);
  }

  async seedDefaults(teamId = "") {
    const imported: string[] = [];
    const skipped: string[] = [];
    const upgraded: string[] = [];
    for (const item of DEFAULT_DIGITAL_HUMANS) {
      const existing = await this.repo.findOne({ where: { id: item.id } });
      if (!existing) {
        await this.write(
          DigitalHumanSchema.parse({ ...item, team_id: teamId || "" }),
        );
        imported.push(item.id);
        continue;
      }
      const current = this.toDigitalHuman(existing);
      const currentTeam = (current.team_id || "").trim();
      if (teamId && currentTeam && currentTeam !== teamId) {
        skipped.push(item.id);
        continue;
      }
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
          await this.write(
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
          await this.write(
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
      total: (await this.list()).length,
    };
  }

  async seedDefaultsForUser(userId: string, teamId: string) {
    const tid = (teamId || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    await this.teams.requireWritableMember(tid, userId);
    return this.seedDefaults(tid);
  }

  private async write(agent: DigitalHuman): Promise<DigitalHuman> {
    const stamp = this.nowIso();
    const existing = await this.repo.findOne({ where: { id: agent.id } });
    const next = DigitalHumanSchema.parse({
      ...agent,
      created_at:
        agent.created_at ||
        existing?.created_at?.toISOString?.() ||
        stamp,
      updated_at: stamp,
    });
    const fields = this.toEntityFields(next);
    if (existing) {
      Object.assign(existing, fields, {
        created_at: existing.created_at,
        updated_at: new Date(stamp),
      });
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create(fields));
    }
    return this.get(next.id);
  }
}
