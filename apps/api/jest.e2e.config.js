/** E2E tests: real PostgreSQL + Redis, in an isolated per-run database and Redis key prefix. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  globalSetup: "<rootDir>/test/support/global-setup.ts",
  globalTeardown: "<rootDir>/test/support/global-teardown.ts",
  testTimeout: 30000,
};
