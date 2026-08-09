import {
  BadRequestException,
  Injectable,
  OnModuleInit,
} from "@nestjs/common";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  DifyConfigPublicSchema,
  DifyConfigSchema,
  type DifyConfig,
  type DifyConfigPublic,
  type Pipeline,
} from "@agent-studio/agent-schema";

export type DifyAuth = {
  api_base: string;
  api_key: string;
  source: "pipeline" | "global";
  app_id?: string;
  workflow_id?: string;
};

type DifySecretsFile = {
  api_key?: string;
  console_token?: string;
  console_csrf?: string;
};

const SECRET_KEYS = ["api_key", "console_token", "console_csrf"] as const;

@Injectable()
export class DifyConfigService implements OnModuleInit {
  private filePath = "";
  private secretsPath = "";
  private config: DifyConfig = DifyConfigSchema.parse({});

  onModuleInit() {
    this.filePath = path.resolve(
      process.env.STUDIO_DIFY_CONFIG ||
        path.join(process.cwd(), "data", "dify-config.yaml"),
    );
    this.secretsPath = path.resolve(
      process.env.STUDIO_DIFY_SECRETS ||
        path.join(path.dirname(this.filePath), "dify-secrets.yaml"),
    );
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.reload();
    this.migrateLegacySecretsIfNeeded();
  }

  private readYamlFile(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) return {};
    return (YAML.parse(fs.readFileSync(file, "utf8")) || {}) as Record<
      string,
      unknown
    >;
  }

  private writeSecrets(secrets: DifySecretsFile) {
    const body = `# Dify secrets for Agent Studio — do not commit
# Prefer DIFY_API_KEY / DIFY_CONSOLE_TOKEN in .env when possible.
${YAML.stringify(secrets, { lineWidth: 100 })}`;
    fs.writeFileSync(this.secretsPath, body, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(this.secretsPath, 0o600);
    } catch {
      /* ignore on unsupported FS */
    }
  }

  private writePublicConfig(cfg: DifyConfig) {
    const publicOnly: Record<string, unknown> = { ...cfg };
    for (const k of SECRET_KEYS) delete publicOnly[k];
    fs.writeFileSync(
      this.filePath,
      `# Dify connection for Agent Studio (non-secret fields)
# Secrets: ${path.basename(this.secretsPath)} or DIFY_* env vars
${YAML.stringify(publicOnly, { lineWidth: 100 })}`,
      "utf8",
    );
  }

  private persist(cfg: DifyConfig) {
    this.writePublicConfig(cfg);
    // Prefer env for secrets: do not write values that are already provided by env.
    const secrets: DifySecretsFile = {};
    if (!process.env.DIFY_API_KEY?.trim() && cfg.api_key?.trim()) {
      secrets.api_key = cfg.api_key;
    }
    if (!process.env.DIFY_CONSOLE_TOKEN?.trim() && cfg.console_token?.trim()) {
      secrets.console_token = cfg.console_token;
    }
    if (!process.env.DIFY_CONSOLE_CSRF?.trim() && cfg.console_csrf?.trim()) {
      secrets.console_csrf = cfg.console_csrf;
    }
    this.writeSecrets(secrets);
  }

  /** Move secrets out of legacy combined dify-config.yaml once. */
  private migrateLegacySecretsIfNeeded() {
    if (!fs.existsSync(this.filePath)) return;
    const raw = this.readYamlFile(this.filePath);
    const hasInline =
      Boolean(String(raw.api_key || "").trim()) ||
      Boolean(String(raw.console_token || "").trim()) ||
      Boolean(String(raw.console_csrf || "").trim());
    if (!hasInline) return;
    this.persist(this.config);
  }

  reload() {
    const fromEnv: Partial<DifyConfig> = {
      enabled:
        process.env.DIFY_ENABLED === undefined
          ? undefined
          : process.env.DIFY_ENABLED === "1" ||
            process.env.DIFY_ENABLED === "true",
      api_base: process.env.DIFY_API_BASE,
      api_key: process.env.DIFY_API_KEY,
      bridge_base_url: process.env.DIFY_BRIDGE_BASE_URL,
      agents_md_path: process.env.DIFY_AGENTS_MD_PATH,
      response_mode: process.env.DIFY_RESPONSE_MODE as DifyConfig["response_mode"],
      console_base: process.env.DIFY_CONSOLE_BASE,
      console_email: process.env.DIFY_CONSOLE_EMAIL,
      console_token: process.env.DIFY_CONSOLE_TOKEN,
      console_csrf: process.env.DIFY_CONSOLE_CSRF,
    };
    const fromFile = this.readYamlFile(this.filePath);
    const fromSecrets = this.readYamlFile(this.secretsPath) as DifySecretsFile;

    // Merge: public file → secrets file → env (env wins)
    this.config = DifyConfigSchema.parse({
      ...fromFile,
      api_key: fromSecrets.api_key || fromFile.api_key || "",
      console_token: fromSecrets.console_token || fromFile.console_token || "",
      console_csrf: fromSecrets.console_csrf || fromFile.console_csrf || "",
      ...Object.fromEntries(
        Object.entries(fromEnv).filter(([, v]) => v !== undefined && v !== ""),
      ),
    });
    return this.config;
  }

  get(): DifyConfig {
    return this.config;
  }

  getPublic(): DifyConfigPublic {
    const c = this.get();
    return DifyConfigPublicSchema.parse({
      enabled: c.enabled,
      api_base: c.api_base,
      bridge_base_url: c.bridge_base_url,
      agents_md_path: c.agents_md_path,
      response_mode: c.response_mode,
      console_base: c.console_base || this.deriveConsoleBase(c.api_base),
      console_email: c.console_email || "",
      api_key_set: Boolean(c.api_key?.trim()),
      console_token_set: Boolean(c.console_token?.trim()),
    });
  }

  update(
    patch: Partial<DifyConfig> & {
      api_key?: string;
      console_token?: string;
      console_csrf?: string;
    },
  ) {
    const next = DifyConfigSchema.parse({
      ...this.config,
      ...patch,
      api_key:
        patch.api_key === undefined || patch.api_key === ""
          ? this.config.api_key
          : patch.api_key,
      console_token:
        patch.console_token === undefined || patch.console_token === ""
          ? this.config.console_token
          : patch.console_token,
      console_csrf:
        patch.console_csrf !== undefined && patch.console_csrf !== ""
          ? patch.console_csrf
          : patch.console_token !== undefined && patch.console_token !== ""
            ? ""
            : this.config.console_csrf,
    });
    this.config = next;
    this.persist(next);
    return this.getPublic();
  }

  /** Persist console session from login (overwrites token/csrf). */
  setConsoleSession(opts: {
    console_base?: string;
    console_email?: string;
    console_token: string;
    console_csrf?: string;
  }) {
    const next = DifyConfigSchema.parse({
      ...this.config,
      ...(opts.console_base !== undefined
        ? { console_base: opts.console_base }
        : {}),
      ...(opts.console_email !== undefined
        ? { console_email: opts.console_email }
        : {}),
      console_token: opts.console_token,
      console_csrf: opts.console_csrf ?? "",
    });
    this.config = next;
    this.persist(next);
    return this.getPublic();
  }

  assertReady() {
    const c = this.get();
    if (!c.enabled) {
      throw new BadRequestException("Dify 未启用：请在设置中打开 DIFY，或设置 DIFY_ENABLED=1");
    }
    if (!c.api_base?.trim()) {
      throw new BadRequestException("缺少 Dify api_base");
    }
    if (!c.api_key?.trim()) {
      throw new BadRequestException("缺少 Dify api_key（应用 API Key）");
    }
    return c;
  }

  /**
   * Resolve credentials for a Studio pipeline.
   * Pipeline binding (enabled + api_key) wins; otherwise global default App.
   */
  resolveAuthForPipeline(pipeline?: Pipeline | null): DifyAuth {
    const global = this.get();
    if (!global.enabled) {
      throw new BadRequestException("Dify 未启用：请在设置中打开 DIFY");
    }

    const binding = pipeline?.dify;
    if (binding?.enabled) {
      const api_key = binding.api_key?.trim() || "";
      const api_base = (binding.api_base?.trim() || global.api_base).replace(
        /\/$/,
        "",
      );
      if (!api_base) {
        throw new BadRequestException(
          `流水线「${pipeline!.id}」已绑定 Dify，但缺少 api_base（流水线或全局设置）`,
        );
      }
      if (!api_key) {
        throw new BadRequestException(
          `流水线「${pipeline!.id}」已启用 Dify 绑定，请填写该流水线的 Workflow App API Key`,
        );
      }
      return {
        api_base,
        api_key,
        source: "pipeline",
        app_id: binding.app_id || undefined,
        workflow_id: binding.workflow_id || undefined,
      };
    }

    this.assertReady();
    return {
      api_base: global.api_base.replace(/\/$/, ""),
      api_key: global.api_key,
      source: "global",
    };
  }

  deriveConsoleBase(apiBase?: string): string {
    const raw = (apiBase || this.config.api_base || "").trim();
    try {
      const u = new URL(raw);
      return `${u.origin}/console/api`;
    } catch {
      return "http://localhost/console/api";
    }
  }

  assertConsoleReady() {
    const c = this.get();
    const console_base = (c.console_base?.trim() || this.deriveConsoleBase(c.api_base)).replace(
      /\/$/,
      "",
    );
    const console_token = c.console_token?.trim() || "";
    const console_csrf = c.console_csrf?.trim() || "";
    if (!console_token) {
      throw new BadRequestException(
        "缺少 Dify Console 会话：请在设置中用邮箱密码登录 Console，或手动粘贴 access_token",
      );
    }
    return { console_base, console_token, console_csrf };
  }
}
