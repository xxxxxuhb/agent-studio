import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import type { WorkOrderCreate, WorkOrderUpdate } from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { WorkOrdersService } from "./work-orders.service";

@Controller()
export class WorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
  ) {}

  @Get("work-orders")
  async list(
    @CurrentUser() user: RequestUser,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("team_id") team_id?: string,
  ) {
    const items = await this.workOrders.listForUser(user.id, {
      status,
      q,
      team_id,
    });
    return { items, total: items.length };
  }

  @Get("work-orders/:id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.workOrders.getForUser(user.id, id);
  }

  @Post("work-orders")
  create(@CurrentUser() user: RequestUser, @Body() body: WorkOrderCreate) {
    return this.workOrders.createForUser(user.id, body);
  }

  @Put("work-orders/:id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: WorkOrderUpdate,
  ) {
    return this.workOrders.updateForUser(user.id, id, body);
  }

  @Delete("work-orders/:id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.workOrders.removeForUser(user.id, id);
  }

  @Post("work-orders/:id/start")
  start(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.workOrders.startForUser(user.id, id, body);
  }

  @Post("work-orders/:id/restart")
  restart(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.workOrders.restartForUser(user.id, id, body);
  }

  @Post("work-orders/:id/resume")
  resume(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.workOrders.resumeForUser(user.id, id, body);
  }

  @Post("work-orders/:id/run-step")
  async runStep(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.workOrders.requireWritableWorkOrder(user.id, id);
    return this.workOrders.runCurrentStep(id);
  }

  @Post("work-orders/:id/cancel")
  cancel(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { feedback?: string },
  ) {
    return this.workOrders.rejectAndEndForUser(
      user.id,
      id,
      body?.feedback || "手动结束运行",
    );
  }

  @Post("work-orders/:id/decision")
  decide(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.workOrders.decideForUser(user.id, id, body);
  }

  @Post("work-orders/:id/clarify")
  clarify(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { note?: string },
  ) {
    return this.workOrders.clarifyForUser(user.id, id, body?.note || "");
  }

  @Get("work-orders/:id/agent-chat")
  getAgentChat(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.workOrders.getAgentChatForUser(user.id, id);
  }

  @Post("work-orders/:id/agent-chat")
  postAgentChat(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.workOrders.postAgentChatForUser(user.id, id, body);
  }

  @Post("work-orders/:id/rework")
  rework(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: { step_id?: string; feedback?: string },
  ) {
    return this.workOrders.reworkForUser(
      user.id,
      id,
      body?.step_id || "",
      body?.feedback || "",
    );
  }
}
