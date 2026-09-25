import { Global, Module } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        // Server-assigned correlation id (never taken from the client), echoed on every response
        // as X-Correlation-Id per the OpenAPI contract; pino uses it as the request id.
        genReqId: (_req, res) => {
          const id = randomUUID();
          res.setHeader("X-Correlation-Id", id);
          return id;
        },
        level: process.env.NODE_ENV === "test" ? "silent" : "info",
        redact: ["req.headers.authorization", "req.headers.cookie"],
        transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
        customProps: () => ({ service: process.env.WASSELNE_PROCESS ?? "api" }),
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
