// Re-exports the OpenAPI-generated types and a thin typed fetch client for TS consumers
// (currently apps/admin). Run `pnpm --filter @wasselne/contracts run generate` after any
// change to docs/phase-2/openapi.yaml; ./generated/openapi-types.ts is build output, not
// hand-edited.
import createClient from "openapi-fetch";
import type { paths } from "./generated/openapi-types";

export type { paths, components } from "./generated/openapi-types";

export function createWasselneClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}
