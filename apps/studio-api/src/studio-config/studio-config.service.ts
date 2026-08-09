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
  private config: StudioConfig = StudioConfigSchema.parse({});

  onModuleInit() {
    this.filePath = path.resolve(
      process.env.STUDIO_CONFIG ||
        path.join(process.cwd(), "data", "studio-config.yaml"),
    );
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.reload();
  }

  reload() {
    const fromEnv: Partial<StudioConfig> = {};
    if (process.env.STUDIO_LANGUAGE === "zh" || process.env.STUDIO_LANGUAGE === "en") {
      fromEnv.language = process.env.STUDIO_LANGUAGE;
    }
    let fromFile: Partial<StudioConfig> = {};
    if (fs.existsSync(this.filePath)) {
      fromFile = YAML.parse(fs.readFileSync(this.filePath, "utf8")) || {};
    }
    this.config = StudioConfigSchema.parse({
      ...fromFile,
      ...fromEnv,
    });
    return this.config;
  }

  get(): StudioConfig {
    return this.config;
  }

  language(): StudioLanguage {
    return this.config.language;
  }

  update(patch: Partial<StudioConfig>) {
    const next = StudioConfigSchema.parse({
      ...this.config,
      ...patch,
    });
    this.config = next;
    fs.writeFileSync(
      this.filePath,
      `# Agent Studio settings\n${YAML.stringify(next, { lineWidth: 100 })}`,
      "utf8",
    );
    return this.config;
  }
}
