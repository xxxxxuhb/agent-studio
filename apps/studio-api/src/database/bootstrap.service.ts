import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";
import { Repository } from "typeorm";
import { ProjectSchema, RunLogEntrySchema, RunLogMetaSchema, WorkOrderSchema, type ProjectRepo } from "@agent-studio/agent-schema";
import { AuthService } from "../auth/auth.service";
import { ProjectEntity } from "../projects/entities/project.entity";
import { RunLogsService } from "../run-logs/run-logs.service";
import { TeamEntity } from "../teams/entities/team.entity";
import { TeamMemberEntity } from "../teams/entities/team-member.entity";
import { WorkOrderEntity } from "../work-orders/entities/work-order.entity";

export const DEFAULT_TEAM_SLUG = "default";

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly auth: AuthService,
    @InjectRepository(TeamEntity)
    private readonly teams: Repository<TeamEntity>,
    @InjectRepository(TeamMemberEntity)
    private readonly members: Repository<TeamMemberEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(WorkOrderEntity)
    private readonly workOrders: Repository<WorkOrderEntity>,
    private readonly runLogs: RunLogsService,
  ) {}

  async onModuleInit() {
    const admin = await this.ensureAdmin();
    const team = await this.ensureDefaultTeam(admin.id);
    await this.migrateYamlProjects(team.id);
    await this.migrateYamlWorkOrders(team.id);
    await this.migrateFileRunLogs(team.id);
    this.stampEmptyYamlTeamIds(team.id);
  }

  async resolveDefaultTeamId(): Promise<string> {
    const team =
      (await this.teams.findOne({ where: { slug: DEFAULT_TEAM_SLUG } })) ||
      (await this.teams.find({ take: 1 }))[0];
    return team?.id || "";
  }

  /** Stamp empty/missing team_id on YAML resources under data/{pipelines,agents,bridges}. */
  stampEmptyYamlTeamIds(defaultTeamId: string) {
    const dirs = [
      process.env.STUDIO_PIPELINE_DIR ||
        path.join(process.cwd(), "data", "pipelines"),
      process.env.STUDIO_DATA_DIR || path.join(process.cwd(), "data", "agents"),
      process.env.STUDIO_BRIDGE_DIR || path.join(process.cwd(), "data", "bridges"),
    ];
    let stamped = 0;
    for (const dir of dirs) {
      const resolved = path.resolve(dir);
      if (!fs.existsSync(resolved)) continue;
      for (const file of fs.readdirSync(resolved)) {
        if (!file.endsWith(".yaml") || file.startsWith("_")) continue;
        const fp = path.join(resolved, file);
        try {
          const raw = YAML.parse(fs.readFileSync(fp, "utf8")) as Record<
            string,
            unknown
          > | null;
          if (!raw || typeof raw !== "object") continue;
          const tid = String(raw.team_id ?? "").trim();
          if (tid) continue;
          raw.team_id = defaultTeamId;
          const header = fs.readFileSync(fp, "utf8").match(/^#.*\n/)?.[0] || "";
          fs.writeFileSync(
            fp,
            `${header || "# Agent Studio\n"}${YAML.stringify(raw, { lineWidth: 100 })}`,
            "utf8",
          );
          stamped += 1;
        } catch (err) {
          this.logger.warn(
            `stamp team_id ${fp}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    if (stamped) {
      this.logger.log(
        `stamped team_id=${defaultTeamId} on ${stamped} YAML resource file(s)`,
      );
    }
  }

  private async ensureAdmin() {
    const count = await this.auth.countUsers();
    if (count > 0) {
      const username =
        process.env.STUDIO_ADMIN_USER?.trim() || "admin";
      let existing = await this.auth.findByUsername(username);
      if (!existing) existing = await this.auth.findByUsername("admin");
      if (existing) {
        return this.auth.ensureAdminFlag(existing);
      }
      const created = await this.auth.createUser({
        username: `admin-${randomUUID().slice(0, 6)}`,
        password: randomUUID(),
        display_name: "Admin",
        is_admin: true,
      });
      this.logger.warn(
        `no admin username match; created placeholder ${created.username}`,
      );
      return created;
    }

    const username = process.env.STUDIO_ADMIN_USER?.trim() || "admin";
    const password =
      process.env.STUDIO_ADMIN_PASSWORD?.trim() || "admin123";
    const user = await this.auth.createUser({
      username,
      password,
      display_name: "Admin",
      is_admin: true,
    });
    this.logger.log(
      `bootstrapped admin user «${username}» (change STUDIO_ADMIN_PASSWORD in production)`,
    );
    return user;
  }

  private async ensureDefaultTeam(ownerUserId: string) {
    let team = await this.teams.findOne({ where: { slug: DEFAULT_TEAM_SLUG } });
    if (!team) {
      team = await this.teams.save(
        this.teams.create({
          id: randomUUID(),
          slug: DEFAULT_TEAM_SLUG,
          name: "默认团队",
        }),
      );
      this.logger.log(`created default team ${team.id}`);
    }
    const membership = await this.members.findOne({
      where: { team_id: team.id, user_id: ownerUserId },
    });
    if (!membership) {
      await this.members.save(
        this.members.create({
          team_id: team.id,
          user_id: ownerUserId,
          role: "owner",
        }),
      );
    }
    return team;
  }

  private yamlProjectsDir() {
    return path.resolve(
      process.env.STUDIO_PROJECT_DIR ||
        path.join(process.cwd(), "data", "projects"),
    );
  }

  private async migrateYamlProjects(defaultTeamId: string) {
    const dir = this.yamlProjectsDir();
    if (!fs.existsSync(dir)) return;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
    let imported = 0;
    for (const file of files) {
      try {
        const raw = YAML.parse(
          fs.readFileSync(path.join(dir, file), "utf8"),
        ) as Record<string, unknown>;
        const id = String(raw.id || "").trim();
        if (!id) continue;
        const exists = await this.projects.findOne({ where: { id } });
        if (exists) continue;
        const parsed = ProjectSchema.safeParse({
          ...raw,
          team_id: defaultTeamId,
        });
        if (!parsed.success) {
          this.logger.warn(
            `skip yaml project ${file}: ${parsed.error.message}`,
          );
          continue;
        }
        const p = parsed.data;
        await this.projects.save(
          this.projects.create({
            id: p.id,
            team_id: p.team_id,
            name: p.name,
            description: p.description || "",
            clone_root: p.clone_root || "",
            repos: (p.repos || []) as ProjectRepo[],
            enabled: p.enabled !== false,
            tags: p.tags || [],
            created_at: p.created_at ? new Date(p.created_at) : undefined,
            updated_at: p.updated_at ? new Date(p.updated_at) : undefined,
          }),
        );
        imported += 1;
      } catch (err) {
        this.logger.warn(
          `migrate ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (imported) {
      this.logger.log(
        `migrated ${imported} YAML project(s) into MySQL (default team); source files kept`,
      );
    }
  }

  private yamlWorkOrdersDir() {
    return path.resolve(
      process.env.STUDIO_WORKORDER_DIR ||
        path.join(process.cwd(), "data", "work-orders"),
    );
  }

  private async migrateYamlWorkOrders(defaultTeamId: string) {
    const dir = this.yamlWorkOrdersDir();
    if (!fs.existsSync(dir)) return;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") && !f.startsWith("_"));
    let imported = 0;
    for (const file of files) {
      try {
        const raw = YAML.parse(
          fs.readFileSync(path.join(dir, file), "utf8"),
        ) as Record<string, unknown>;
        const id = String(raw.id || "").trim();
        if (!id) continue;
        const exists = await this.workOrders.findOne({ where: { id } });
        if (exists) continue;

        let teamId = String(raw.team_id || "").trim();
        const projectId = String(raw.project_id || "").trim();
        if (!teamId && projectId) {
          const project = await this.projects.findOne({
            where: { id: projectId },
          });
          teamId = project?.team_id || "";
        }
        if (!teamId) teamId = defaultTeamId;

        const parsed = WorkOrderSchema.safeParse({
          ...raw,
          team_id: teamId,
        });
        if (!parsed.success) {
          this.logger.warn(
            `skip yaml work order ${file}: ${parsed.error.message}`,
          );
          continue;
        }
        const wo = parsed.data;
        await this.workOrders.save(
          this.workOrders.create({
            id: wo.id,
            team_id: wo.team_id || teamId,
            project_id: wo.project_id || "",
            title: wo.title,
            requirement: wo.requirement,
            status: wo.status || "draft",
            pipeline_id: wo.pipeline_id || "",
            category: wo.category || "requirement",
            priority: wo.priority || "medium",
            tags: wo.tags || [],
            clarifications: wo.clarifications || [],
            run: wo.run ?? null,
            created_at: wo.created_at ? new Date(wo.created_at) : undefined,
            updated_at: wo.updated_at ? new Date(wo.updated_at) : undefined,
          }),
        );
        imported += 1;
      } catch (err) {
        this.logger.warn(
          `migrate work order ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (imported) {
      this.logger.log(
        `migrated ${imported} YAML work order(s) into MySQL; source files kept`,
      );
    }
  }

  private yamlRunLogsDir() {
    return path.resolve(
      process.env.STUDIO_RUN_LOG_DIR ||
        path.join(process.cwd(), "data", "run-logs"),
    );
  }

  private async migrateFileRunLogs(defaultTeamId: string) {
    const dir = this.yamlRunLogsDir();
    if (!fs.existsSync(dir)) return;
    const runDirs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    let imported = 0;
    let entryCount = 0;
    for (const runId of runDirs) {
      try {
        const metaFp = path.join(dir, runId, "meta.yaml");
        if (!fs.existsSync(metaFp)) continue;
        const raw = YAML.parse(fs.readFileSync(metaFp, "utf8")) as Record<
          string,
          unknown
        >;
        let teamId = String(raw.team_id || "").trim();
        const workOrderId = String(raw.work_order_id || "").trim();
        if (!teamId && workOrderId) {
          const wo = await this.workOrders.findOne({
            where: { id: workOrderId },
          });
          teamId = wo?.team_id || "";
        }
        if (!teamId) teamId = defaultTeamId;

        const metaParsed = RunLogMetaSchema.safeParse({
          ...raw,
          run_id: String(raw.run_id || runId),
          team_id: teamId,
        });
        if (!metaParsed.success) {
          this.logger.warn(
            `skip run log ${runId}: ${metaParsed.error.message}`,
          );
          continue;
        }

        const eventsFp = path.join(dir, runId, "events.jsonl");
        const entries = [];
        if (fs.existsSync(eventsFp)) {
          for (const line of fs
            .readFileSync(eventsFp, "utf8")
            .split("\n")
            .filter(Boolean)) {
            try {
              const parsed = RunLogEntrySchema.safeParse(JSON.parse(line));
              if (parsed.success) entries.push(parsed.data);
            } catch {
              /* skip */
            }
          }
        }

        const ok = await this.runLogs.importFromFiles(metaParsed.data, entries);
        if (ok) {
          imported += 1;
          entryCount += entries.length;
        }
      } catch (err) {
        this.logger.warn(
          `migrate run log ${runId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (imported) {
      this.logger.log(
        `migrated ${imported} run log(s) (${entryCount} entries) into MySQL; source files kept`,
      );
    }
  }
}
