import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { ENV } from "../config/env.module";
import { Env } from "../config/env";
import { Database } from "./schema-types";

export const DB = Symbol("DB");
export const PG_POOL = Symbol("PG_POOL");

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (env: Env) => new Pool({ connectionString: env.DATABASE_URL, max: 10 }),
      inject: [ENV],
    },
    {
      provide: DB,
      useFactory: (pool: Pool) => new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }),
      inject: [PG_POOL],
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
