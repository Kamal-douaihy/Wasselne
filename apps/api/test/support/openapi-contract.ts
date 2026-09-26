import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

// Validates real HTTP responses against docs/phase-2/openapi.yaml: the status must be declared
// for the operation, the body must match the declared schema, and declared required headers
// (plus Retry-After on 429) must be present. This is what "aligned with OpenAPI" means in tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
const spec: any = parse(readFileSync(join(__dirname, "../../../../docs/phase-2/openapi.yaml"), "utf8"));

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "openapi", components: spec.components });

function resolve(node: any): any {
  if (node?.$ref) {
    return node.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce((o: any, k: string) => o[k], spec);
  }
  return node;
}

export interface ContractResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export function assertMatchesContract(method: string, path: string, res: ContractResponse): void {
  const operation = spec.paths[path]?.[method.toLowerCase()];
  if (!operation) throw new Error(`Contract has no operation ${method} ${path}`);

  const declared = operation.responses[String(res.status)];
  if (!declared) {
    throw new Error(
      `Contract violation: ${method} ${path} returned ${res.status}; declared: ${Object.keys(operation.responses).join(", ")}. Body: ${JSON.stringify(res.body)}`,
    );
  }
  const response = resolve(declared);

  for (const [name, headerRef] of Object.entries<any>(response.headers ?? {})) {
    const header = resolve(headerRef);
    if (header.required && res.headers[name.toLowerCase()] === undefined) {
      throw new Error(`Contract violation: ${method} ${path} ${res.status} is missing required header ${name}`);
    }
  }
  if (res.status === 429 && res.headers["retry-after"] === undefined) {
    throw new Error(`Contract violation: ${method} ${path} 429 without Retry-After`);
  }
  const corr = res.headers["x-correlation-id"];
  if (corr !== undefined && !/^[0-9a-f-]{36}$/i.test(String(corr))) {
    throw new Error(`X-Correlation-Id is not a UUID: ${corr}`);
  }

  const schema = response.content?.["application/json"]?.schema;
  if (schema) {
    // Inline schemas (e.g. `type: array, items: {$ref}`) are compiled against a root that carries
    // the components, so their internal #/components/... refs resolve.
    const validate = schema.$ref
      ? ajv.compile({ $ref: "openapi#" + schema.$ref.slice(1) })
      : ajv.compile({ ...schema, components: spec.components });
    if (!validate(res.body)) {
      throw new Error(
        `Contract violation: ${method} ${path} ${res.status} body does not match ${schema.$ref}: ${ajv.errorsText(validate.errors)}. Body: ${JSON.stringify(res.body)}`,
      );
    }
  } else if (res.body && Object.keys(res.body as object).length > 0 && res.status !== 204) {
    throw new Error(`Contract violation: ${method} ${path} ${res.status} has a body but no declared content`);
  }
}
