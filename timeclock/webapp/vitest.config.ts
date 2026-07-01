import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Integration suites share one Postgres and reset the schema in beforeAll —
    // parallel files would race (duplicate pg_extension). Serial is cheap here.
    fileParallelism: false,
  },
});
