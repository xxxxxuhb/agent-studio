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
import { PipelinesService } from "./pipelines.service";

@Controller()
export class PipelinesController {
  constructor(
    @Inject(PipelinesService) private readonly pipelines: PipelinesService,
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
