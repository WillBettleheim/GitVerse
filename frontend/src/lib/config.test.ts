import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./config";

describe("resolveApiUrl", () => {
  it("uses a valid URL and strips trailing slashes", () => {
    expect(resolveApiUrl("https://api.example.com/")).toBe("https://api.example.com");
  });

  it.each([undefined, "", "not a url", "javascript:alert(1)", "ftp://example.com"])(
    "falls back to localhost for %s",
    (value) => {
      expect(resolveApiUrl(value)).toBe("http://localhost:8000");
    },
  );
});
