import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { BootstrapService } from "./database/bootstrap.service";
import { DigitalHumansService } from "./digital-humans/digital-humans.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const teamId = await app.get(BootstrapService).resolveDefaultTeamId();
  const result = await app.get(DigitalHumansService).seedDefaults(teamId);
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}

main();
