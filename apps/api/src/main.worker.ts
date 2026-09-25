import "reflect-metadata";
process.env.WASSELNE_PROCESS = "worker";

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { WorkerModule } from "./worker/worker.module";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  loadEnv(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  logger.log("worker started (Phase 3 scaffold: DB/Redis connectivity only, no jobs yet)");

  const heartbeat = setInterval(() => logger.log("worker heartbeat"), 30_000);
  const shutdown = async () => {
    clearInterval(heartbeat);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("worker failed to start", err);
  process.exit(1);
});
