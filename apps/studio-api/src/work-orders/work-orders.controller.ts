import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import type { WorkOrderCreate, WorkOrderUpdate } from "@agent-studio/agent-schema";
import {
  WORK_ORDER_ATTACHMENT_MAX_BYTES,
} from "@agent-studio/agent-schema";
import { CurrentUser, type RequestUser } from "../auth/current-user.decorator";
import { WorkOrdersService } from "./work-orders.service";
import { WorkOrderAttachmentsService } from "./work-order-attachments.service";

@Controller()
export class WorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    private readonly attachments: WorkOrderAttachmentsService,
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
    return this.workOrders.decideForUser(
      user.id,
      id,
      body,
      user.display_name || user.username,
    );
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

  @Get("work-orders/:id/comments")
  listComments(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.workOrders.listComments(id, user.id);
  }

  @Post("work-orders/:id/comments")
  postComment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.workOrders.postComment(id, user, body);
  }

  @Get("work-orders/:id/attachments")
  async listAttachments(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
  ) {
    await this.workOrders.getForUser(user.id, id);
    return this.attachments.list(id);
  }

  @Post("work-orders/:id/attachments")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: WORK_ORDER_ATTACHMENT_MAX_BYTES },
    }),
  )
  async uploadAttachment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @UploadedFile()
    file:
      | { originalname: string; mimetype: string; buffer: Buffer; size: number }
      | undefined,
  ) {
    const order = await this.workOrders.requireWritableWorkOrder(user.id, id);
    if (!file?.buffer?.length) {
      throw new BadRequestException("请选择文件（字段名 file）");
    }
    return this.attachments.create({
      team_id: order.team_id || "",
      work_order_id: order.id,
      filename: file.originalname || "file",
      content_type: file.mimetype || "application/octet-stream",
      buffer: file.buffer,
      created_by: user.id,
    });
  }

  @Get("work-orders/:id/attachments/:attachmentId")
  async downloadAttachment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ) {
    await this.workOrders.getForUser(user.id, id);
    const row = await this.attachments.getWithContent(id, attachmentId);
    res.setHeader(
      "Content-Type",
      row.content_type || "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    );
    const buf = Buffer.isBuffer(row.content)
      ? row.content
      : Buffer.from(row.content as unknown as string);
    res.send(buf);
  }

  @Delete("work-orders/:id/attachments/:attachmentId")
  async removeAttachment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    await this.workOrders.requireWritableWorkOrder(user.id, id);
    await this.attachments.remove(id, attachmentId);
    return { ok: true };
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
