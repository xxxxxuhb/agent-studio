import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { Repository } from "typeorm";
import { AuditLogEntity } from "./entities/audit-log.entity";

export type AuditRecordInput = {
  team_id?: string;
  actor_user_id?: string;
  actor_name?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  summary?: string;
  detail?: Record<string, unknown> | null;
};

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  private nowIso() {
    return new Date().toISOString();
  }

  async record(input: AuditRecordInput): Promise<AuditLogEntity> {
    const row: AuditLogEntity = {
      id: randomUUID(),
      at: this.nowIso(),
      team_id: (input.team_id || "").trim(),
      actor_user_id: (input.actor_user_id || "").trim(),
      actor_name: (input.actor_name || "").trim().slice(0, 128),
      action: (input.action || "").trim().slice(0, 64),
      resource_type: (input.resource_type || "").trim().slice(0, 64),
      resource_id: (input.resource_id || "").trim().slice(0, 128),
      summary: (input.summary || "").trim().slice(0, 512),
      detail: input.detail || null,
    };
    await this.repo.save(row);
    return row;
  }

  async list(params: {
    team_id?: string;
    actor_user_id?: string;
    action?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const qb = this.repo
      .createQueryBuilder("a")
      .orderBy("a.at", "DESC")
      .take(limit);
    if (params.team_id) {
      qb.andWhere("a.team_id = :team_id", { team_id: params.team_id });
    }
    if (params.actor_user_id) {
      qb.andWhere("a.actor_user_id = :actor_user_id", {
        actor_user_id: params.actor_user_id,
      });
    }
    if (params.action) {
      qb.andWhere("a.action = :action", { action: params.action });
    }
    const items = await qb.getMany();
    return { items, total: items.length };
  }
}
