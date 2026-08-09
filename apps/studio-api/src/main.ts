import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
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

  const humans = app.get(DigitalHumansService);
  const seeded = humans.seedDefaults();
  if (seeded.imported.length) {
    console.log(`seeded/imported digital humans: ${seeded.imported.join(", ")}`);
  }
  if (seeded.upgraded.length) {
    console.log(`upgraded digital humans: ${seeded.upgraded.join(", ")}`);
  }

  const pipelines = app.get(PipelinesService);
  if (pipelines.list().length === 0) {
    const seeded = pipelines.seedDefaults();
    console.log(`seeded ${seeded.imported.length} pipelines`);
  }

  const port = Number(process.env.STUDIO_API_PORT || 8790);
  await app.listen(port, process.env.STUDIO_API_HOST || "0.0.0.0");
  console.log(`studio-api http://127.0.0.1:${port}`);
}

bootstrap();
