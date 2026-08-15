import os from "node:os";
import Fastify from "fastify";
import { z } from "zod";
import {
  describeActiveDriver,
  ensureCursorAuth,
  hasCursorCredentials,
  listAgentDriverIds,
  resolveAgentDriver,
} from "@agent-studio/agent-runtime";
import {
  approveStage,
  createRun,
  executeStage,
  getRun,
  listRuns,
} from "./orchestrator.js";
import { managerSelectRepos } from "./managerSelect.js";
import { composePipelineWithAgent } from "./pipelineCompose.js";
import { connectStudioLink, type StudioLink } from "./studioLink.js";
import { StageSchema } from "./types.js";
import { bridgeHttpToken, requireBridgeHttpAuth } from "./httpAuth.js";
import {
  bridgeReposRoot,
  ensureWorkspaceOnBridge,
} from "./workspaceEnsure.js";

export type StartBridgeOptions = {
  port?: number;
  host?: string;
  /** Force AGENT_DRIVER before resolve (cursor | openai | trae | qoder | auto | …) */
  driver?: string;
  /** Display name for Studio registration */
  name?: string;
  /** Studio API base, e.g. http://127.0.0.1:8790 */
  studioUrl?: string;
  /** Shared token for register/heartbeat */
  studioToken?: string;
  /** URL Studio should call (defaults to http://host:port when host is public) */
  publicUrl?: string;
  /** Open browser Cursor.auth.login when no CURSOR_API_KEY */
  login?: boolean;
};

export type BridgeServerInfo = {
  port: number;
  host: string;
  publicUrl: string;
  driver: ReturnType<typeof describeActiveDriver>;
  availableDrivers: string[];
  name: string;
  studioLink?: StudioLink;
};

let studioLink: StudioLink | undefined;
let activeRuns = 0;

/** Test-only: force admit-control state without a long-running stage. */
export function __testSetActiveRuns(n: number) {
  activeRuns = Math.max(0, Math.floor(n));
}

export function __testGetActiveRuns() {
  return activeRuns;
}

function applyDriverEnv(driver?: string) {
  if (!driver?.trim()) return;
  process.env.AGENT_DRIVER = driver.trim().toLowerCase();
  resolveAgentDriver();
}

function trackBusy<T>(runId: string, work: () => Promise<T>): Promise<T> {
  activeRuns += 1;
  studioLink?.setBusy(runId);
  return work().finally(() => {
    activeRuns = Math.max(0, activeRuns - 1);
    if (activeRuns === 0) studioLink?.setBusy(null);
  });
}

export function createBridgeApp() {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", requireBridgeHttpAuth);

  app.setErrorHandler((err, _req, reply) => {
    if (err && typeof err === "object" && "name" in err && err.name === "ZodError") {
      return reply.code(400).send({
        error: "validation_error",
        message: err instanceof Error ? err.message : "invalid request",
      });
    }
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode?: number }).statusCode) || 500
        : 500;
    reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_error" : "request_error",
      message: err instanceof Error ? err.message : String(err),
    });
  });

  app.get("/health", async () => {
    const driver = describeActiveDriver();
    return {
      ok: true,
      service: "agent-studio-bridge",
      dryRun: driver.dryRun,
      driver: driver.id,
      driverLabel: driver.label,
      model: driver.model || null,
      availableDrivers: listAgentDriverIds(),
      name: process.env.BRIDGE_NAME || os.hostname(),
      platform: process.platform,
      status: activeRuns > 0 ? "busy" : "online",
      activeRuns,
      reposRoot: bridgeReposRoot(),
    };
  });

  app.get("/runs", async () => ({ runs: listRuns() }));

  app.get("/runs/:id", async (req) => {
    const { id } = req.params as { id: string };
    return getRun(id);
  });

  app.get("/runs/:id/artifacts", async (req) => {
    const { id } = req.params as { id: string };
    const { listRunArtifacts } = await import("./artifacts.js");
    return listRunArtifacts(id);
  });

  app.get("/runs/:id/artifacts/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    try {
      const { readRunArtifact } = await import("./artifacts.js");
      return readRunArtifact(id, decodeURIComponent(name));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(message)) {
        return reply.code(404).send({ error: "not_found", message });
      }
      if (/path|name|unsupported|required|escapes|traversal/i.test(message)) {
        return reply.code(400).send({ error: "bad_request", message });
      }
      throw err;
    }
  });

  /** Human → Agent inbox files under docs/runs/{id}/inbox/. */
  app.post("/runs/:id/inbox", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        files: z
          .array(
            z.object({
              name: z.string().min(1),
              content_base64: z.string().min(1),
              content_type: z.string().optional(),
            }),
          )
          .max(20),
      })
      .parse(req.body ?? {});
    try {
      const { writeRunInboxFiles } = await import("./artifacts.js");
      const result = writeRunInboxFiles(id, body.files);
      return reply.code(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "bad_request", message });
    }
  });

  /** Opt-in disk GC (auth required). Default dry-run unless body.apply=true. */
  app.post("/admin/gc", async (req) => {
    const body = z
      .object({
        apply: z.boolean().optional().default(false),
        dry_run: z.boolean().optional(),
        prompt_hours: z.number().nonnegative().optional(),
        artifact_days: z.number().nonnegative().optional(),
        runs_json_days: z.number().nonnegative().optional(),
      })
      .parse(req.body ?? {});
    const { resolveGcOptionsFromEnv, runBridgeGc } = await import("./gc.js");
    const dryRun =
      body.dry_run === true ? true : body.apply ? false : undefined;
    const protectedRunIds = listRuns()
      .filter(
        (r) =>
          r.status !== "completed" &&
          r.status !== "rejected" &&
          r.status !== "failed",
      )
      .map((r) => r.id);
    return runBridgeGc(
      resolveGcOptionsFromEnv({
        dryRun,
        promptMaxAgeMs:
          body.prompt_hours != null ? body.prompt_hours * 3600_000 : undefined,
        artifactMaxAgeMs:
          body.artifact_days != null
            ? body.artifact_days * 86_400_000
            : undefined,
        runsJsonMaxAgeMs:
          body.runs_json_days != null
            ? body.runs_json_days * 86_400_000
            : undefined,
        protectedRunIds,
      }),
    );
  });

  app.post("/workspace/ensure", async (req) => {
    const body = z
      .object({
        project_id: z.string().min(1),
        project_name: z.string().optional(),
        repos: z
          .array(
            z
              .object({
                id: z.string().min(1),
                remote_url: z.string().optional().default(""),
                local_path: z.string().optional().default(""),
                name: z.string().optional(),
                role: z.string().optional(),
                default_branch: z.string().optional(),
                note: z.string().optional(),
                agents_md: z.string().optional(),
              })
              .superRefine((repo, ctx) => {
                if (
                  !(repo.remote_url || "").trim() &&
                  !(repo.local_path || "").trim()
                ) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "remote_url or local_path is required",
                    path: ["remote_url"],
                  });
                }
              }),
          )
          .min(1),
      })
      .parse(req.body);
    return trackBusy("workspace-ensure", () =>
      ensureWorkspaceOnBridge({
        project_id: body.project_id,
        project_name: body.project_name,
        repos: body.repos,
      }),
    );
  });

  app.post("/routing/select", async (req) => {
    const body = z
      .object({
        requirement: z.string().min(1),
        project_name: z.string().optional(),
        repos: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              role: z.string().default("unknown"),
              local_path: z.string(),
              agents_md_path: z.string(),
              remote_url: z.string().optional(),
              note: z.string().optional(),
            }),
          )
          .min(1),
      })
      .parse(req.body);
    return trackBusy("routing-select", () =>
      managerSelectRepos({
        requirement: body.requirement,
        projectName: body.project_name,
        repos: body.repos,
      }),
    );
  });

  app.post("/compose/pipeline", async (req) => {
    const body = z
      .object({
        prompt: z.string().min(1),
        agents: z
          .array(
            z.object({
              id: z.string().min(1),
              name: z.string().min(1),
              role: z.string().default("unknown"),
              description: z.string().optional().default(""),
            }),
          )
          .min(1),
      })
      .parse(req.body);
    return trackBusy("pipeline-compose", () =>
      composePipelineWithAgent({
        prompt: body.prompt,
        agents: body.agents,
      }),
    );
  });

  app.post("/runs", async (req, reply) => {
    if (activeRuns > 0) {
      return reply.code(503).send({
        error: "bridge_busy",
        message: "Bridge is busy with another run; retry later or use「重新执行」after it finishes",
        activeRuns,
      });
    }
    const body = z
      .object({
        agents_md_path: z.string().optional().default("auto"),
        raw_requirement: z.string().min(1),
        routing_mode: z.enum(["auto", "explicit"]).optional().default("auto"),
      })
      .parse(req.body);
    const run = createRun({
      agentsMdPath: body.agents_md_path,
      rawRequirement: body.raw_requirement,
      routingMode: body.routing_mode,
    });
    const manager = await trackBusy(run.id, () => executeStage(run.id, "manager"));
    return reply.code(201).send({
      run: getRun(run.id),
      manager,
      routing: getRun(run.id).routing,
    });
  });

  app.post("/runs/:id/:stage", async (req) => {
    const { id, stage } = req.params as { id: string; stage: string };
    const parsedStage = StageSchema.parse(stage);
    const body = z
      .object({
        feedback: z.string().optional().default(""),
      })
      .parse(req.body ?? {});
    return trackBusy(id, () => executeStage(id, parsedStage, body.feedback));
  });

  app.post("/runs/:id/decision", async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        decision: z.enum(["approve", "reject"]),
        feedback: z.string().optional().default(""),
      })
      .parse(req.body);
    return approveStage(id, body.decision, body.feedback);
  });

  return app;
}

export async function startBridge(
  options: StartBridgeOptions = {},
): Promise<BridgeServerInfo> {
  if (options.driver?.trim()) {
    process.env.AGENT_DRIVER = options.driver.trim().toLowerCase();
  }
  const driverId = (process.env.AGENT_DRIVER || "auto").trim().toLowerCase();
  if (driverId === "cursor") {
    const how = await ensureCursorAuth({ login: Boolean(options.login) });
    console.log(`Cursor auth: ${how}`);
  } else if (driverId === "auto" && (options.login || hasCursorCredentials())) {
    const how = await ensureCursorAuth({ login: Boolean(options.login) });
    console.log(`Cursor auth: ${how}`);
  }

  applyDriverEnv(options.driver);

  const gitId = (await import("./gitIdentity.js")).applyBridgeGitIdentity();
  console.log(
    `git bot identity: ${gitId.author || "(unset)"}; ssh_key=${gitId.ssh}; prefer_ssh=${gitId.preferSsh}`,
  );

  const port = options.port ?? Number(process.env.BRIDGE_PORT || 8787);
  const host = options.host ?? process.env.BRIDGE_HOST ?? "0.0.0.0";
  const name =
    options.name?.trim() ||
    process.env.BRIDGE_NAME?.trim() ||
    `${process.platform}-${os.hostname()}`;
  process.env.BRIDGE_NAME = name;

  const app = createBridgeApp();
  await app.listen({ port, host });

  const httpToken = bridgeHttpToken();
  console.log(
    httpToken
      ? "http auth: enabled (Bearer / X-Bridge-Token; /health public)"
      : "http auth: disabled (set BRIDGE_HTTP_TOKEN or STUDIO_BRIDGE_TOKEN to require auth)",
  );

  const publicUrl =
    (options.publicUrl || process.env.BRIDGE_PUBLIC_URL || "").trim() ||
    `http://127.0.0.1:${port}`;

  const driver = describeActiveDriver();
  const info: BridgeServerInfo = {
    port,
    host,
    publicUrl,
    driver,
    availableDrivers: listAgentDriverIds(),
    name,
  };

  console.log(`agent-studio-bridge listening on http://${host}:${port}`);
  console.log(`public url (for Studio): ${publicUrl}`);
  console.log(
    `agent driver: ${driver.id} (${driver.label})`,
  );
  console.log(`available drivers: ${info.availableDrivers.join(", ")}`);

  const studioUrl = (options.studioUrl || process.env.STUDIO_URL || "").trim();
  const studioToken = (
    options.studioToken ||
    process.env.STUDIO_BRIDGE_TOKEN ||
    process.env.BRIDGE_TOKEN ||
    ""
  ).trim();

  if (studioUrl && studioToken) {
    try {
      studioLink = await connectStudioLink({
        studioUrl,
        token: studioToken,
        name,
        publicUrl,
      });
      info.studioLink = studioLink;
      const shutdown = () => {
        studioLink?.close();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    } catch (err) {
      console.warn(
        `Studio WS link failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    console.log(
      "tip: pass --studio-url and --token (or STUDIO_URL + STUDIO_BRIDGE_TOKEN) to link this executor via WebSocket",
    );
  }

  return info;
}

/** Local-dev helper: load env then start with process env defaults. */
export async function startBridgeFromEnv() {
  const { loadDotEnv } = await import("./env.js");
  loadDotEnv();
  return startBridge({
    driver: process.env.AGENT_DRIVER,
    name: process.env.BRIDGE_NAME,
    studioUrl: process.env.STUDIO_URL,
    studioToken: process.env.STUDIO_BRIDGE_TOKEN || process.env.BRIDGE_TOKEN,
    publicUrl: process.env.BRIDGE_PUBLIC_URL,
  });
}
