import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { hostname } from "os";
import { StudioJobEntity } from "./entities/studio-job.entity";
import { StudioJobsService } from "./studio-jobs.service";
import { shouldRunStudioJobs } from "./studio-job.types";
import { WorkOrderStudioRunner } from "./work-order-studio-runner.service";

@Injectable()
export class StudioJobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StudioJobWorkerService.name);
  private readonly workerId = `${hostname().slice(0, 24)}-${process.pid}`;
  private stopped = false;
  private loop?: Promise<void>;

  constructor(
    private readonly jobs: StudioJobsService,
    private readonly runner: WorkOrderStudioRunner,
  ) {}

  onModuleInit() {
    if (!shouldRunStudioJobs()) {
      this.logger.log(
        `studio job worker idle (mode/role does not run jobs; workerId=${this.workerId})`,
      );
      return;
    }
    this.logger.log(`studio job worker starting (workerId=${this.workerId})`);
    this.loop = this.runLoop();
  }

  async onModuleDestroy() {
    this.stopped = true;
    this.jobs.wake();
    await this.loop;
  }

  private async runLoop() {
    const pollMs = Number(process.env.STUDIO_JOB_POLL_MS || 1000);
    const staleMs = Number(process.env.STUDIO_JOB_STALE_MS || 30 * 60_000);
    let lastReclaim = 0;

    while (!this.stopped) {
      try {
        const now = Date.now();
        if (now - lastReclaim > Math.min(staleMs, 60_000)) {
          await this.jobs.reclaimStale(staleMs);
          lastReclaim = now;
        }

        const job = await this.jobs.claimNext(this.workerId);
        if (!job) {
          await this.jobs.waitForWake(pollMs);
          continue;
        }
        await this.executeClaimed(job);
      } catch (err) {
        this.logger.error(
          `job loop error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await this.jobs.waitForWake(pollMs);
      }
    }
  }

  private async executeClaimed(job: StudioJobEntity) {
    this.logger.log(
      `claim ${job.kind} ${job.id} wo=${job.work_order_id} run=${job.run_id}`,
    );
    try {
      await this.runner.executeQueuedJob(job);
      await this.jobs.markDone(job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `job ${job.id} failed: ${msg}`,
      );
      await this.jobs.markFailed(job.id, msg);
      // Runner already persists work-order failure for unexpected throws.
    }
  }
}
