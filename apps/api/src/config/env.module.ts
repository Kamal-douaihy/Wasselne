import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Env, loadEnv } from "./env";

export const ENV = Symbol("ENV");

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv(process.env) }],
  exports: [ENV],
})
export class EnvModule {}
