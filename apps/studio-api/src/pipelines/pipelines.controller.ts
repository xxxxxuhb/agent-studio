import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type { PipelineCreate, PipelineUpdate } from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { DifyClientService } from "../dify/dify-client.service";
import { DifyConfigService } from "../dify/dify-config.service";
import { generateDifyWorkflowDsl } from "../dify/dify-dsl.generator";
import { DigitalHumansService } from "../digital-humans/digital-humans.service";
import { PipelinesService } from "./pipelines.service";

@Controller()
export class PipelinesController {
  constructor(
    @Inject(PipelinesService) private readonly pipelines: PipelinesService,
    @Inject(DigitalHumansService) private readonly humans: DigitalHumansService,
    @Inject(DifyConfigService) private readonly difyConfig: DifyConfigService,
    @Inject(DifyClientService) private readonly difyClient: DifyClientService,
  ) {}

  @Get("pipelines")
  async list(
    @CurrentUser() user: RequestUser,
    @Query("enabled") enabled?: "true" | "false" | "all",
    @Query("q") q?: string,
    @Query("team_id") team_id?: string,
  ) {
    const items = await this.pipelines.listForUser(user.id, {
      enabled,
      q,
      team_id,
    });
    return { items, total: items.length };
  }

  @Post("pipelines/compose")
  compose(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.pipelines.composeForUser(user.id, body);
  }

  @Post("seed/pipelines")
  seed(
    @CurrentUser() user: RequestUser,
    @Query("team_id") team_id?: string,
  ) {
    return this.pipelines.seedDefaultsForUser(user.id, team_id || "");
  }

  @Get("pipelines/:id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.pipelines.getPublicForUser(user.id, id);
  }

  @Get("pipelines/:id/dify-dsl")
  async difyDsl(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    const pipeline = await this.pipelines.getForUser(user.id, id);
    const agents = new Map(
      (await this.humans.list({ enabled: "all" })).map((h) => [h.id, h]),
    );
    const yaml = generateDifyWorkflowDsl({ pipeline, agents });
    return {
      pipeline_id: pipeline.id,
      filename: `${pipeline.id}.dify.yml`,
      yaml,
      hint: "下载后在 Dify 工作室「创建应用 → 导入 DSL」；导入后把 App Key 填回本流水线的 Dify 绑定。",
    };
  }

  @Post("pipelines/:id/dify-import")
  async difyImport(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body?: { overwrite?: boolean },
  ) {
    const pipeline = await this.pipelines.getForUser(user.id, id);
    const agents = new Map(
      (await this.humans.list({ enabled: "all" })).map((h) => [h.id, h]),
    );
    const yaml = generateDifyWorkflowDsl({ pipeline, agents });
    const overwrite = Boolean(body?.overwrite);
    const existingAppId = pipeline.dify?.app_id?.trim() || "";

    const imported = await this.difyClient.importDsl({
      yaml,
      name: pipeline.name,
      description: pipeline.description || undefined,
      app_id: overwrite && existingAppId ? existingAppId : undefined,
    });

    const appId = imported.app_id || existingAppId;
    let published: { ok: boolean; version?: string } | null = null;
    if (appId) {
      // App API 只跑已发布版本；导入仅改草稿，必须发布否则仍是旧图。
      published = await this.difyClient.publishWorkflow(appId);
    }

    let pipelinePublic = await this.pipelines.getPublicForUser(user.id, id);
    if (appId) {
      pipelinePublic = await this.pipelines.updateForUser(user.id, id, {
        dify: {
          ...(pipeline.dify || {}),
          enabled: pipeline.dify?.enabled ?? false,
          app_id: appId,
          note: `由 Studio 于 ${new Date().toISOString()} 导入并发布 DSL`,
        },
      });
    }

    return {
      ok: true,
      status: imported.status,
      app_id: appId || "",
      import_id: imported.import_id || "",
      published: Boolean(published?.ok),
      published_version: published?.version || "",
      pipeline: pipelinePublic,
      hint: appId
        ? published?.ok
          ? "DSL 已导入并发布。请确认本流水线已绑定该 App 的 API Key 并启用。"
          : "DSL 已导入，但发布结果未知；请到 Dify 工作室确认已发布。"
        : "DSL 已提交导入，但未返回 app_id；请到 Dify 工作室确认应用是否创建成功。",
    };
  }

  @Post("pipelines/:id/dify-health")
  async difyHealth(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    const pipeline = await this.pipelines.getForUser(user.id, id);
    try {
      const auth = this.difyConfig.resolveAuthForPipeline(pipeline);
      const parameters = await this.difyClient.getParameters(auth);
      return {
        ok: true,
        binding_source: auth.source,
        api_base: auth.api_base,
        app_id: auth.app_id || "",
        parameters,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  @Post("pipelines")
  create(@CurrentUser() user: RequestUser, @Body() body: PipelineCreate) {
    return this.pipelines.createForUser(user.id, body);
  }

  @Put("pipelines/:id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: PipelineUpdate,
  ) {
    return this.pipelines.updateForUser(user.id, id, body);
  }

  @Patch("pipelines/:id/enabled")
  setEnabled(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.pipelines.setEnabledForUser(user.id, id, Boolean(body?.enabled));
  }

  @Delete("pipelines/:id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.pipelines.removeForUser(user.id, id);
  }
}
