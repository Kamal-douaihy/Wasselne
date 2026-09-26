import { defineConfig } from "@playwright/test";

// Run through e2e/orchestrate.ts, which provides an isolated database, API, and console.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.pw\.ts/,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: process.env.CONSOLE_URL ?? "http://127.0.0.1:3001", trace: "off" },
});
