import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { Repository } from "typeorm";
import {
  WORK_ORDER_ATTACHMENT_MAX_BYTES,
  WORK_ORDER_ATTACHMENT_MAX_COUNT,
  WORK_ORDER_ATTACHMENT_MAX_TOTAL_BYTES,
  isAllowedAttachmentContentType,
  sanitizeAttachmentFilename,
  type WorkOrderAttachment,
  type WorkOrderAttachmentList,
} from "@agent-studio/agent-schema";
import { WorkOrderAttachmentEntity } from "./entities/work-order-attachment.entity";

function toPublic(row: WorkOrderAttachmentEntity): WorkOrderAttachment {
  return {
    id: row.id,
    team_id: row.team_id,
    work_order_id: row.work_order_id,
    filename: row.filename,
    content_type: row.content_type,
    bytes: row.bytes,
    created_by: row.created_by || "",
    created_at: row.created_at,
  };
}

@Injectable()
export class WorkOrderAttachmentsService {
  constructor(
    @InjectRepository(WorkOrderAttachmentEntity)
    private readonly repo: Repository<WorkOrderAttachmentEntity>,
  ) {}

  async list(workOrderId: string): Promise<WorkOrderAttachmentList> {
    const rows = await this.repo.find({
      where: { work_order_id: workOrderId },
      order: { created_at: "ASC" },
      select: [
        "id",
        "team_id",
        "work_order_id",
        "filename",
        "content_type",
        "bytes",
        "created_by",
        "created_at",
      ],
    });
    const total_bytes = rows.reduce((s, r) => s + (r.bytes || 0), 0);
    return { items: rows.map(toPublic), total_bytes };
  }

  async getWithContent(
    workOrderId: string,
    attachmentId: string,
  ): Promise<WorkOrderAttachmentEntity> {
    const row = await this.repo.findOne({
      where: { id: attachmentId, work_order_id: workOrderId },
    });
    if (!row) throw new NotFoundException("附件不存在");
    return row;
  }

  async listWithContent(
    workOrderId: string,
  ): Promise<WorkOrderAttachmentEntity[]> {
    return this.repo.find({
      where: { work_order_id: workOrderId },
      order: { created_at: "ASC" },
    });
  }

  /** Files for Bridge inbox inject (basename + base64). */
  async toInboxFiles(workOrderId: string): Promise<
    Array<{ name: string; content_base64: string; content_type: string }>
  > {
    const rows = await this.listWithContent(workOrderId);
    const used = new Set<string>();
    return rows.map((r) => {
      let name = sanitizeAttachmentFilename(r.filename);
      if (used.has(name)) {
        const i = name.lastIndexOf(".");
        const stem = i > 0 ? name.slice(0, i) : name;
        const ext = i > 0 ? name.slice(i) : "";
        name = `${stem}_${r.id.slice(0, 6)}${ext}`;
      }
      used.add(name);
      const buf = Buffer.isBuffer(r.content)
        ? r.content
        : Buffer.from(r.content as unknown as string);
      return {
        name,
        content_base64: buf.toString("base64"),
        content_type: r.content_type || "application/octet-stream",
      };
    });
  }

  async create(input: {
    team_id: string;
    work_order_id: string;
    filename: string;
    content_type: string;
    buffer: Buffer;
    created_by?: string;
  }): Promise<WorkOrderAttachment> {
    const filename = sanitizeAttachmentFilename(input.filename);
    const content_type = (input.content_type || "").trim() || "application/octet-stream";
    const buffer = input.buffer;
    if (!buffer?.length) {
      throw new BadRequestException("空文件");
    }
    if (buffer.length > WORK_ORDER_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(
        `单文件不能超过 ${WORK_ORDER_ATTACHMENT_MAX_BYTES / 1024 / 1024}MB`,
      );
    }
    if (!isAllowedAttachmentContentType(content_type, filename)) {
      throw new BadRequestException(
        "不支持的文件类型（允许：图片、PDF、文本/日志/JSON/CSV/YAML）",
      );
    }

    const existing = await this.list(input.work_order_id);
    if (existing.items.length >= WORK_ORDER_ATTACHMENT_MAX_COUNT) {
      throw new BadRequestException(
        `每个工单最多 ${WORK_ORDER_ATTACHMENT_MAX_COUNT} 个附件`,
      );
    }
    if (
      existing.total_bytes + buffer.length >
      WORK_ORDER_ATTACHMENT_MAX_TOTAL_BYTES
    ) {
      throw new BadRequestException(
        `工单附件总量不能超过 ${WORK_ORDER_ATTACHMENT_MAX_TOTAL_BYTES / 1024 / 1024}MB`,
      );
    }

    const row = this.repo.create({
      id: randomUUID(),
      team_id: input.team_id,
      work_order_id: input.work_order_id,
      filename,
      content_type,
      bytes: buffer.length,
      content: buffer,
      created_by: (input.created_by || "").trim(),
      created_at: new Date().toISOString(),
    });
    const saved = await this.repo.save(row);
    return toPublic(saved);
  }

  async remove(workOrderId: string, attachmentId: string): Promise<void> {
    const row = await this.repo.findOne({
      where: { id: attachmentId, work_order_id: workOrderId },
    });
    if (!row) throw new NotFoundException("附件不存在");
    await this.repo.remove(row);
  }
}
