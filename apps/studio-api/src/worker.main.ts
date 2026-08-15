import "reflect-metadata";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/studio-api/.env") });

process.env.STUDIO_PROCESS_ROLE = "worker";
// Prefer worker mode when this entrypoint is used (API should set MODE=worker too).
if (!process.env.STUDIO_ORCHESTRATOR_MODE?.trim()) {
  process.env.STUDIO_ORCHESTRATOR_MODE = "worker";
}

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { BootstrapService } from "./database/bootstrap.service";
import { orchestratorMode, processRole } from "./work-orders/studio-job.types";

async function bootstrap() {
  const log = new Logger("studio-worker");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });

  const boot = app.get(BootstrapService);
  await boot.runBootstrap();

  log.log(
    `studio-worker ready (role=${processRole()} mode=${orchestratorMode()})`,
  );

  // Keep process alive; StudioJobWorkerService poll loop started onModuleInit.
  await new Promise<void>((resolve) => {
    const shutdown = async (signal: string) => {
      log.log(`shutting down (${signal})…`);
      await app.close();
      resolve();
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
