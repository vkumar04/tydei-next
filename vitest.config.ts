import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Playwright suites use .spec.ts; vitest cannot parse them (the
    // Playwright `test` fixture has a different signature). Also
    // exclude the visual-regression suite that imports
    // @playwright/test directly. Vitest covers .test.ts(x).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.claude/**",
      "**/.worktrees/**",
      "**/*.spec.ts",
      "tests/visual/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
})
