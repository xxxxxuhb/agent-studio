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
import { ManagerChatService } from "./manager-chat.service";
import { WorkOrdersService } from "./work-orders.service";

@Controller()
export class WorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(ManagerChatService) private readonly managerChat: ManagerChatService,
  ) {}

  @Get("work-orders")
  list(@Query("status") status?: string, @Query("q") q?: string) {
    const items = this.workOrders.list({ status, q });
    return { items, total: items.length };
  }

  @Get("work-orders/:id/chat")
  getChat(@Param("id") id: string) {
    return this.managerChat.getThread(id);
  }

  @Post("work-orders/:id/chat")
  postChat(@Param("id") id: string, @Body() body: unknown) {
    return this.managerChat.chat(id, body);
  }

  @Get("work-orders/:id")
  get(@Param("id") id: string) {
    return this.workOrders.get(id);
  }

  @Post("work-orders")
  create(@Body() body: WorkOrderCreate) {
    return this.workOrders.create(body);
  }

  @Put("work-orders/:id")
  update(@Param("id") id: string, @Body() body: WorkOrderUpdate) {
    return this.workOrders.update(id, body);
  }

  @Delete("work-orders/:id")
  remove(@Param("id") id: string) {
    return this.workOrders.remove(id);
  }

  @Post("work-orders/:id/start")
  start(@Param("id") id: string, @Body() body: unknown) {
    return this.workOrders.start(id, body);
  }

  @Post("work-orders/:id/restart")
  restart(@Param("id") id: string, @Body() body: unknown) {
    return this.workOrders.restart(id, body);
  }

  @Post("work-orders/:id/sync-dify")
  syncDify(@Param("id") id: string) {
    return this.workOrders.syncDify(id);
  }

  @Post("work-orders/:id/run-step")
  runStep(@Param("id") id: string) {
    return this.workOrders.runCurrentStep(id);
  }

  @Post("work-orders/:id/cancel")
  cancel(@Param("id") id: string, @Body() body: { feedback?: string }) {
    return this.workOrders.rejectAndEnd(id, body?.feedback || "手动结束运行");
  }

  @Post("work-orders/:id/decision")
  decide(@Param("id") id: string, @Body() body: unknown) {
    return this.workOrders.decide(id, body);
  }

  @Post("work-orders/:id/clarify")
  clarify(@Param("id") id: string, @Body() body: { note?: string }) {
    return this.workOrders.clarify(id, body?.note || "");
  }

  @Post("work-orders/:id/rework")
  rework(
    @Param("id") id: string,
    @Body() body: { step_id?: string; feedback?: string },
  ) {
    return this.workOrders.rework(id, body?.step_id || "", body?.feedback || "");
  }
}
