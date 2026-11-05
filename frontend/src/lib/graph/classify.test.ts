import { describe, expect, it } from "vitest";
import { classifyFile, type FileCategory } from "./classify";

const cases: [string, FileCategory][] = [
  ["src/server/index.ts", "source"],
  ["app/main.py", "source"],
  ["src/contest/runner.ts", "source"],
  ["tests/orderService.test.ts", "test"],
  ["src/a/__tests__/b.ts", "test"],
  ["src/a/b.spec.tsx", "test"],
  ["backend/test_api.py", "test"],
  ["pkg/thing_test.go", "test"],
  ["README.md", "docs"],
  ["docs/guide/intro.ts", "docs"],
  ["src/app/globals.css", "style"],
  ["src/theme.module.scss", "style"],
  ["package.json", "config"],
  ["frontend/tsconfig.json", "config"],
  ["next.config.ts", "config"],
  ["Dockerfile", "config"],
  [".github/workflows/ci.yml", "config"],
  ["src/data/users.json", "data"],
  ["migrations/001_init.sql", "data"],
];

describe("classifyFile", () => {
  it.each(cases)("%s is %s", (path, category) => {
    expect(classifyFile(path)).toBe(category);
  });
});
