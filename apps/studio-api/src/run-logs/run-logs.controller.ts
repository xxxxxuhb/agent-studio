import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { RunLogsService } from "./run-logs.service";

@Controller("run-logs")
export class RunLogsController {
  constructor(@Inject(RunLogsService) private readonly logs: RunLogsService) {}

  @Get()
  list(
    @Query("q") q?: string,
    @Query("work_order_id") work_order_id?: string,
    @Query("limit") limit?: string,
  ) {
    return this.logs.list({
      q,
      work_order_id,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":runId")
  get(
    @Param("runId") runId: string,
    @Query("source") source?: string,
    @Query("level") level?: string,
  ) {
    return this.logs.get(runId, { source, level });
  }
}
