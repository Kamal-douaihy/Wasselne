import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { Kysely, sql } from "kysely";
import type Redis from "ioredis";
import { DB } from "../../db/db.module";
import { REDIS } from "../../redis/redis.module";
import { Database } from "../../db/schema-types";

interface HealthReport {
  status: "ok" | "degraded";
  checks: Record<"database" | "redis", "ok" | "error">;
}

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    const [database, redisStatus] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const report: HealthReport = {
      status: database === "ok" && redisStatus === "ok" ? "ok" : "degraded",
      checks: { database, redis: redisStatus },
    };
    if (report.status === "degraded") {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }

  private async checkDatabase(): Promise<"ok" | "error"> {
    try {
      await sql`select 1`.execute(this.db);
      return "ok";
    } catch {
      return "error";
    }
  }

  private async checkRedis(): Promise<"ok" | "error"> {
    try {
      const pong = await this.redis.ping();
      return pong === "PONG" ? "ok" : "error";
    } catch {
      return "error";
    }
  }
}
