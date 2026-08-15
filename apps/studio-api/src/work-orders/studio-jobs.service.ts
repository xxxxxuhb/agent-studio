import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { In, Repository } from "typeorm";
import { StudioJobEntity } from "./entities/studio-job.entity";
import type {
  StudioJobKind,
  StudioJobPayload,
} from "./studio-job.types";

@Injectable()
export class StudioJobsService {
  private readonly logger = new Logger(StudioJobsService.name);
  private wakeWaiters: Array<() => void> = [];

  constructor(
    @InjectRepository(StudioJobEntity)
    private readonly repo: Repository<StudioJobEntity>,
  ) {}

  /** Soft-wake pollers after enqueue (low latency without busy spin). */
  wake() {
    const waiters = this.wakeWaiters.splice(0);
    for (const w of waiters) w();
  }

  waitForWake(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeWaiters = this.wakeWaiters.filter((w) => w !== done);
        resolve();
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.wakeWaiters.push(done);
    });
  }

  async enqueue(input: {
    work_order_id: string;
    run_id: string;
    kind: StudioJobKind;
    payload: StudioJobPayload;
  }): Promise<StudioJobEntity> {
    const now = new Date().toISOString();
    const row = this.repo.create({
      id: randomUUID(),
      work_order_id: input.work_order_id,
      run_id: input.run_id,
      kind: input.kind,
      payload: input.payload as unknown as Record<string, unknown>,
      status: "pending",
      claimed_by: "",
      claimed_at: null,
      finished_at: null,
      error: null,
      created_at: now,
    });
    const saved = await this.repo.save(row);
    this.wake();
    return saved;
  }

  async hasActiveJob(workOrderId: string): Promise<boolean> {
    const n = await this.repo.count({
      where: {
        work_order_id: workOrderId,
        status: In(["pending", "running"]),
      },
    });
    return n > 0;
  }

  /**
   * Claim the oldest pending job that has no sibling running on the same work order.
   * Returns null when the queue is idle.
   */
  async claimNext(workerId: string): Promise<StudioJobEntity | null> {
    const pending = await this.repo
      .createQueryBuilder("j")
      .where("j.status = :status", { status: "pending" })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM studio_jobs r
          WHERE r.work_order_id = j.work_order_id AND r.status = 'running'
        )`,
      )
      .orderBy("j.created_at", "ASC")
      .addOrderBy("j.id", "ASC")
      .limit(8)
      .getMany();

    const now = new Date().toISOString();
    for (const row of pending) {
      const result = await this.repo.update(
        { id: row.id, status: "pending" },
        {
          status: "running",
          claimed_by: workerId,
          claimed_at: now,
        },
      );
      if ((result.affected || 0) > 0) {
        const claimed = await this.repo.findOne({ where: { id: row.id } });
        if (claimed) return claimed;
      }
    }
    return null;
  }

  async markDone(id: string): Promise<void> {
    await this.repo.update(
      { id },
      {
        status: "done",
        finished_at: new Date().toISOString(),
        error: null,
      },
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.repo.update(
      { id },
      {
        status: "failed",
        finished_at: new Date().toISOString(),
        error: error.slice(0, 4000),
      },
    );
  }

  /**
   * Requeue stuck running jobs after worker crash (claimed_at older than staleMs).
   */
  async reclaimStale(staleMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = await this.repo
      .createQueryBuilder("j")
      .where("j.status = :status", { status: "running" })
      .andWhere("j.claimed_at IS NOT NULL")
      .andWhere("j.claimed_at < :cutoff", { cutoff })
      .getMany();
    if (!rows.length) return 0;
    await this.repo.update(
      { id: In(rows.map((r) => r.id)) },
      {
        status: "pending",
        claimed_by: "",
        claimed_at: null,
      },
    );
    this.logger.warn(`reclaimed ${rows.length} stale studio job(s)`);
    return rows.length;
  }
}
