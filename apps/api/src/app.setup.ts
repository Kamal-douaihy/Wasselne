import { INestApplication } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { Env } from "./config/env";

// Shared by main.api.ts and the e2e tests so both run the same HTTP configuration.
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  if (env.TRUST_PROXY_HOPS > 0) {
    express.set("trust proxy", env.TRUST_PROXY_HOPS);
  }
  app.use(helmet());
  app.enableShutdownHooks();
}
