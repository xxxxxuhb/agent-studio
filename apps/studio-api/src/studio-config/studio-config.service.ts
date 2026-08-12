import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  StudioConfigPublicSchema,
  StudioConfigSchema,
  TeamSecretsSchema,
  type StudioConfig,
  type StudioConfigPublic,
  type StudioLanguage,
  type TeamSecrets,
} from "@agent-studio/agent-schema";

@Injectable()
export class StudioConfigService implements OnModuleInit {
  private filePath = "";
  private teamDir = "";
  private teamSecretsDir = "";
  private legacyDifyConfigPath = "";
  private config: StudioConfig = StudioConfigSchema.parse({});

  onModuleInit() {
    this.filePath = path.resolve(
      process.env.STUDIO_CONFIG ||
        path.join(process.cwd(), "data", "studio-config.yaml"),
    );
    this.teamDir = path.resolve(
      process.env.STUDIO_TEAM_SETTINGS_DIR ||
        path.join(process.cwd(), "data", "team-settings"),
    );
    this.teamSecretsDir = path.resolve(
      process.env.STUDIO_TEAM_SECRETS_DIR ||
        path.join(process.cwd(), "data", "team-secrets"),
    );
    this.legacyDifyConfigPath = path.resolve(
      process.env.STUDIO_DIFY_CONFIG ||
        path.join(process.cwd(), "data", "dify-config.yaml"),
    );
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.mkdirSync(this.teamDir, { recursive: true });
    fs.mkdirSync(this.teamSecretsDir, { recursive: true });
    this.reload();
    this.migrateFromLegacyDifyConfigIfNeeded();
  }

  private teamFilePath(teamId: string) {
    const safe = teamId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.teamDir, `${safe}.yaml`);
  }

  private teamSecretsPath(teamId: string) {
    const safe = teamId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.teamSecretsDir, `${safe}.yaml`);
  }

  private loadFile(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) return {};
    return (YAML.parse(fs.readFileSync(filePath, "utf8")) || {}) as Record<
      string,
      unknown
    >;
  }

  private writePublic(cfg: StudioConfig) {
    fs.writeFileSync(
      this.filePath,
      `# Agent Studio settings\n${YAML.stringify(cfg, { lineWidth: 100 })}`,
      "utf8",
    );
  }

  private writeTeamSecretsFile(teamId: string, secrets: TeamSecrets) {
    fs.mkdirSync(this.teamSecretsDir, { recursive: true });
    const fp = this.teamSecretsPath(teamId);
    const body = `# Team secrets (${teamId}) — do not commit
${YAML.stringify(secrets, { lineWidth: 100 })}`;
    fs.writeFileSync(fp, body, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(fp, 0o600);
    } catch {
      /* ignore */
    }
  }

  /** One-time: copy bridge_base_url / agents_md_path from legacy dify-config.yaml. */
  private migrateFromLegacyDifyConfigIfNeeded() {
    if (!fs.existsSync(this.legacyDifyConfigPath)) return;
    const legacy = this.loadFile(this.legacyDifyConfigPath);
    const patch: Partial<StudioConfig> = {};
    if (
      !this.config.bridge_base_url?.trim() ||
      this.config.bridge_base_url.includes("host.docker.internal")
    ) {
      const url = String(legacy.bridge_base_url || "").trim();
      if (url) patch.bridge_base_url = url;
    }
    if (!this.config.agents_md_path?.trim() || this.config.agents_md_path === "auto") {
      const md = String(legacy.agents_md_path || "").trim();
      if (md) patch.agents_md_path = md;
    }
    if (Object.keys(patch).length) {
      this.update(patch);
    }
  }

  private globalDefaults(): StudioConfig {
    const fromEnv: Partial<StudioConfig> = {};
    if (process.env.STUDIO_LANGUAGE === "zh" || process.env.STUDIO_LANGUAGE === "en") {
      fromEnv.language = process.env.STUDIO_LANGUAGE;
    }
    if (process.env.STUDIO_BRIDGE_BASE_URL?.trim()) {
      fromEnv.bridge_base_url = process.env.STUDIO_BRIDGE_BASE_URL.trim();
    } else if (process.env.DIFY_BRIDGE_BASE_URL?.trim()) {
      fromEnv.bridge_base_url = process.env.DIFY_BRIDGE_BASE_URL.trim();
    }
    if (process.env.STUDIO_AGENTS_MD_PATH?.trim()) {
      fromEnv.agents_md_path = process.env.STUDIO_AGENTS_MD_PATH.trim();
    } else if (process.env.DIFY_AGENTS_MD_PATH?.trim()) {
      fromEnv.agents_md_path = process.env.DIFY_AGENTS_MD_PATH.trim();
    }
    return StudioConfigSchema.parse({
      ...this.loadFile(this.filePath),
      ...fromEnv,
    });
  }

  reload() {
    this.config = this.globalDefaults();
    return this.config;
  }

  get(): StudioConfig {
    return this.config;
  }

  language(): StudioLanguage {
    return this.config.language;
  }

  getForTeam(teamId: string): StudioConfig {
    const tid = (teamId || "").trim();
    const globals = this.globalDefaults();
    if (!tid) return globals;
    const fromTeam = this.loadFile(this.teamFilePath(tid));
    const secrets = this.getTeamSecrets(tid);
    return StudioConfigSchema.parse({
      ...globals,
      ...fromTeam,
      bridge_base_url:
        secrets.bridge_base_url?.trim() ||
        String(fromTeam.bridge_base_url || "").trim() ||
        globals.bridge_base_url,
      agents_md_path:
        secrets.agents_md_path?.trim() ||
        String(fromTeam.agents_md_path || "").trim() ||
        globals.agents_md_path,
      git_ssh_key_path:
        secrets.git_ssh_key_path?.trim() ||
        String(fromTeam.git_ssh_key_path || "").trim() ||
        globals.git_ssh_key_path ||
        "",
      git_prefer_ssh:
        secrets.git_prefer_ssh !== undefined
          ? secrets.git_prefer_ssh
          : fromTeam.git_prefer_ssh !== undefined
            ? Boolean(fromTeam.git_prefer_ssh)
            : globals.git_prefer_ssh,
      git_ssh_port:
        secrets.git_ssh_port !== undefined
          ? secrets.git_ssh_port
          : typeof fromTeam.git_ssh_port === "number"
            ? fromTeam.git_ssh_port
            : globals.git_ssh_port,
      git_ssh_user:
        secrets.git_ssh_user?.trim() ||
        String(fromTeam.git_ssh_user || "").trim() ||
        globals.git_ssh_user ||
        "",
      team_id: tid,
    });
  }

  languageForTeam(teamId: string): StudioLanguage {
    return this.getForTeam(teamId).language;
  }

  /** Effective Bridge / agents / git settings for a team. */
  getEffectiveForTeam(teamId: string): StudioConfig & {
    bridge_base_url: string;
    agents_md_path: string;
  } {
    const cfg = this.getForTeam(teamId);
    return {
      ...cfg,
      bridge_base_url: cfg.bridge_base_url?.trim() || "http://127.0.0.1:8787",
      agents_md_path: cfg.agents_md_path?.trim() || "auto",
    };
  }

  getPublic(teamId?: string): StudioConfigPublic {
    const cfg = teamId?.trim()
      ? this.getEffectiveForTeam(teamId)
      : this.getEffectiveForTeam("");
    return StudioConfigPublicSchema.parse({
      ...cfg,
      git_ssh_key_path_set: Boolean(cfg.git_ssh_key_path?.trim()),
    });
  }

  getTeamSecrets(teamId: string): TeamSecrets {
    const tid = (teamId || "").trim();
    if (!tid) return TeamSecretsSchema.parse({});
    const raw = this.loadFile(this.teamSecretsPath(tid));
    return TeamSecretsSchema.parse({ ...raw, team_id: tid });
  }

  update(patch: Partial<StudioConfig>) {
    const next = StudioConfigSchema.parse({
      ...this.config,
      ...patch,
      team_id: "",
    });
    this.config = next;
    this.writePublic(next);
    return this.config;
  }

  updateForTeam(teamId: string, patch: Partial<StudioConfig>) {
    const tid = (teamId || "").trim();
    if (!tid) throw new BadRequestException("team_id is required");
    const current = this.getForTeam(tid);
    const next = StudioConfigSchema.parse({
      ...current,
      ...patch,
      team_id: tid,
    });
    fs.mkdirSync(this.teamDir, { recursive: true });
    fs.writeFileSync(
      this.teamFilePath(tid),
      `# Agent Studio team settings (${tid})\n${YAML.stringify(
        {
          language: next.language,
          bridge_base_url: next.bridge_base_url,
          agents_md_path: next.agents_md_path,
          team_id: tid,
        },
        { lineWidth: 100 },
      )}`,
      "utf8",
    );

    const secrets = this.getTeamSecrets(tid);
    const nextSecrets = TeamSecretsSchema.parse({
      ...secrets,
      team_id: tid,
      bridge_base_url: next.bridge_base_url,
      agents_md_path: next.agents_md_path,
      git_ssh_key_path:
        patch.git_ssh_key_path === undefined || patch.git_ssh_key_path === ""
          ? secrets.git_ssh_key_path || ""
          : patch.git_ssh_key_path,
      git_prefer_ssh:
        patch.git_prefer_ssh !== undefined
          ? patch.git_prefer_ssh
          : secrets.git_prefer_ssh,
      git_ssh_port:
        patch.git_ssh_port !== undefined ? patch.git_ssh_port : secrets.git_ssh_port,
      git_ssh_user:
        patch.git_ssh_user === undefined || patch.git_ssh_user === ""
          ? secrets.git_ssh_user || ""
          : patch.git_ssh_user,
    });
    this.writeTeamSecretsFile(tid, nextSecrets);
    return next;
  }
}
