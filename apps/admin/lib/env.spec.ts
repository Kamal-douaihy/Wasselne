import { describe, expect, it } from "vitest";
import { loadAdminEnv } from "./env";

describe("loadAdminEnv", () => {
  it("defaults API_BASE_URL to localhost:3000", () => {
    expect(loadAdminEnv({}).API_BASE_URL).toBe("http://localhost:3000");
  });

  it("rejects a non-URL API_BASE_URL", () => {
    expect(() => loadAdminEnv({ API_BASE_URL: "not-a-url" })).toThrow();
  });
});
