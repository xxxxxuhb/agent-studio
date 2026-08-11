import "reflect-metadata";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Load apps/studio-api/.env whether started from monorepo root or package cwd
loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/studio-api/.env") });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { BootstrapService } from "./database/bootstrap.service";
import { DigitalHumansService } from "./digital-humans/digital-humans.service";
import { PipelinesService } from "./pipelines/pipelines.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      process.env.STUDIO_WEB_ORIGIN || "",
    ].filter(Boolean),
  });

  const boot = app.get(BootstrapService);
  const defaultTeamId = await boot.resolveDefaultTeamId();

  const humans = app.get(DigitalHumansService);
  const seeded = await humans.seedDefaults(defaultTeamId);
  if (seeded.imported.length) {
    console.log(`seeded/imported digital humans: ${seeded.imported.join(", ")}`);
  }
  if (seeded.upgraded.length) {
    console.log(`upgraded digital humans: ${seeded.upgraded.join(", ")}`);
  }

  const pipelines = app.get(PipelinesService);
  if ((await pipelines.list()).length === 0) {
    const seededPipes = await pipelines.seedDefaults(defaultTeamId);
    console.log(`seeded ${seededPipes.imported.length} pipelines`);
  }

  const port = Number(process.env.STUDIO_API_PORT || 8790);
  await app.listen(port, process.env.STUDIO_API_HOST || "0.0.0.0");
  console.log(`studio-api http://127.0.0.1:${port}`);
}

bootstrap();
