import "reflect-metadata";
process.env.WASSELNE_PROCESS = "api";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { configureApp } from "./app.setup";

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app, env);

  await app.listen(env.API_PORT);
  app.get(Logger).log(`api listening on :${env.API_PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("api failed to start", err);
  process.exit(1);
});
