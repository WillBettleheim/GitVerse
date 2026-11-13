import { describe, expect, it } from "vitest";
import { parseRepoInput } from "./repo-input";

describe("parseRepoInput", () => {
  it.each([
    "vercel/next.js",
    "  vercel/next.js  ",
    "https://github.com/vercel/next.js",
    "https://github.com/vercel/next.js/",
    "https://github.com/vercel/next.js.git",
    "https://www.github.com/vercel/next.js",
  ])("accepts %s", (input) => {
    expect(parseRepoInput(input)).toEqual({ ok: true, repo: { owner: "vercel", name: "next.js" } });
  });

  // The same rejection cases the backend tests, so the two stay in agreement.
  it.each([
    "",
    "justoneword",
    "a/b/c",
    "https://github.com/vercel/next.js/tree/canary",
    "https://gitlab.com/vercel/next.js",
    "https://github.com.evil.example/vercel/next.js",
    "https://token@github.com/vercel/next.js",
    "https://github.com:8443/vercel/next.js",
    "https://github.com/vercel/next.js?x=1",
    "http://github.com/vercel/next.js",
    "git@github.com:vercel/next.js.git",
    "../etc",
    "vercel/..",
    "vercel/.git",
    "vercel/-oProxyCommand=x",
    "-owner/repo",
    "own--er/repo",
    "vercel/next.js;rm",
    "vercel/next js",
    "vercel\\next.js",
    `${"a".repeat(40)}/repo`,
    `owner/${"a".repeat(101)}`,
  ])("rejects %s with a message", (input) => {
    const result = parseRepoInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(5);
  });
});
