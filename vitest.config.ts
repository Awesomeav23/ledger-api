import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Point the app at the test database, never the main one.
    // GitHub Actions will set TEST_DATABASE_URL; locally the default is used.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://ledger:ledger@localhost:5440/ledger_test",
    },
    // The integration tests share one database, so run test files one at a
    // time to keep them from clearing each other's data mid-test.
    fileParallelism: false,
    // Test files live in /tests and end in .test.ts.
    include: ["tests/**/*.test.ts"],
  },
});
