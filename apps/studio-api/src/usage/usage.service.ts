import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { Repository } from "typeorm";
import { UsageEventEntity } from "./entities/usage-event.entity";

export type UsageRecordInput = {
  team_id?: string;
  work_order_id?: string;
  run_id?: string;
  bridge_run_id?: string;
  step_id?: string;
  stage?: string;
  driver?: string;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
  dry_run?: boolean;
  detail?: Record<string, unknown> | null;
};

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(UsageEventEntity)
    private readonly repo: Repository<UsageEventEntity>,
  ) {}

  private nowIso() {
    return new Date().toISOString();
  }

  async record(input: UsageRecordInput): Promise<UsageEventEntity> {
    const prompt =
      typeof input.prompt_tokens === "number" ? input.prompt_tokens : null;
    const completion =
      typeof input.completion_tokens === "number"
        ? input.completion_tokens
        : null;
    let total =
      typeof input.total_tokens === "number" ? input.total_tokens : null;
    if (total == null && (prompt != null || completion != null)) {
      total = (prompt || 0) + (completion || 0);
    }
    const row: UsageEventEntity = {
      id: randomUUID(),
      at: this.nowIso(),
      team_id: (input.team_id || "").trim(),
      work_order_id: (input.work_order_id || "").trim(),
      run_id: (input.run_id || "").trim(),
      bridge_run_id: (input.bridge_run_id || "").trim(),
      step_id: (input.step_id || "").trim(),
      stage: (input.stage || "").trim(),
      driver: (input.driver || "").trim(),
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      cost_usd:
        typeof input.cost_usd === "number" && Number.isFinite(input.cost_usd)
          ? input.cost_usd.toFixed(6)
          : null,
      dry_run: input.dry_run ? 1 : 0,
      detail: input.detail || null,
    };
    await this.repo.save(row);
    return row;
  }

  async list(params: {
    team_id?: string;
    work_order_id?: string;
    driver?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const qb = this.repo
      .createQueryBuilder("u")
      .orderBy("u.at", "DESC")
      .take(limit);
    if (params.team_id) {
      qb.andWhere("u.team_id = :team_id", { team_id: params.team_id });
    }
    if (params.work_order_id) {
      qb.andWhere("u.work_order_id = :work_order_id", {
        work_order_id: params.work_order_id,
      });
    }
    if (params.driver) {
      qb.andWhere("u.driver = :driver", { driver: params.driver });
    }
    const items = await qb.getMany();
    return { items, total: items.length };
  }

  async summarize(params: { team_id: string }) {
    const teamId = (params.team_id || "").trim();
    const rows = await this.repo.find({
      where: { team_id: teamId },
      order: { at: "DESC" },
      take: 5000,
    });
    const by_driver: Record<
      string,
      { events: number; total_tokens: number; cost_usd: number }
    > = {};
    let total_tokens = 0;
    let cost_usd = 0;
    for (const r of rows) {
      const driver = r.driver || "(unknown)";
      const tok = r.total_tokens || 0;
      const cost = r.cost_usd ? Number(r.cost_usd) : 0;
      total_tokens += tok;
      cost_usd += Number.isFinite(cost) ? cost : 0;
      if (!by_driver[driver]) {
        by_driver[driver] = { events: 0, total_tokens: 0, cost_usd: 0 };
      }
      by_driver[driver]!.events += 1;
      by_driver[driver]!.total_tokens += tok;
      by_driver[driver]!.cost_usd += Number.isFinite(cost) ? cost : 0;
    }
    return {
      team_id: teamId,
      events: rows.length,
      total_tokens,
      cost_usd: Number(cost_usd.toFixed(6)),
      by_driver,
    };
  }
}
