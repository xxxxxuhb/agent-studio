import {
  Injectable,
  OnModuleInit,
} from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  StudioConfigSchema,
  type StudioConfig,
  type StudioLanguage,
} from "@agent-studio/agent-schema";

@Injectable()
export class StudioConfigService implements OnModuleInit {
  private filePath = "";
  private teamDir = "";
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
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.mkdirSync(this.teamDir, { recursive: true });
    this.reload();
  }

  private teamFilePath(teamId: string) {
    const safe = teamId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.teamDir, `${safe}.yaml`);
  }

  private loadFile(filePath: string): Partial<StudioConfig> {
    if (!fs.existsSync(filePath)) return {};
    return YAML.parse(fs.readFileSync(filePath, "utf8")) || {};
  }

  private globalDefaults(): StudioConfig {
    const fromEnv: Partial<StudioConfig> = {};
    if (process.env.STUDIO_LANGUAGE === "zh" || process.env.STUDIO_LANGUAGE === "en") {
      fromEnv.language = process.env.STUDIO_LANGUAGE;
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
    return StudioConfigSchema.parse({
      ...globals,
      ...fromTeam,
      team_id: tid,
    });
  }

  languageForTeam(teamId: string): StudioLanguage {
    return this.getForTeam(teamId).language;
  }

  update(patch: Partial<StudioConfig>) {
    const next = StudioConfigSchema.parse({
      ...this.config,
      ...patch,
      team_id: "",
    });
    this.config = next;
    fs.writeFileSync(
      this.filePath,
      `# Agent Studio settings\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    return this.config;
  }

  updateForTeam(teamId: string, patch: Partial<StudioConfig>) {
    const tid = (teamId || "").trim();
    const current = this.getForTeam(tid);
    const next = StudioConfigSchema.parse({
      ...current,
      ...patch,
      team_id: tid,
    });
    fs.mkdirSync(this.teamDir, { recursive: true });
    fs.writeFileSync(
      this.teamFilePath(tid),
      `# Agent Studio team settings (${tid})\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    return next;
  }
}
