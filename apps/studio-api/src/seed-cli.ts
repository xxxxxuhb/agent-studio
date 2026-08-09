import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DigitalHumansService } from "./digital-humans/digital-humans.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const result = app.get(DigitalHumansService).seedDefaults();
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}

main();
