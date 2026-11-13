import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import demo from "@/features/demo/demo-graph.json";
import { useExplorerStore } from "@/features/explorer/store";
import { parseCodeGraph } from "@/lib/graph/schema";
import sample from "./__fixtures__/analysis-sample.json";
import { AnalysisExplorer } from "./AnalysisExplorer";
import { cycleSummary } from "./AnalysisOverview";
import { RepoInputForm } from "./RepoInputForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/features/city/LazyCityCanvas", () => ({
  LazyCityCanvas: () => <div data-testid="city-canvas" />,
}));

const SHA = "0123456789abcdef0123456789abcdef01234567";
const repository = sample.analysis.repository;

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(32),
    requested: "acme/web-app",
    status: "running",
    createdAt: "2026-01-01T00:00:00+00:00",
    progress: { stage: "parsing", filesTotal: 12, filesParsed: 5 },
    repository,
    cached: false,
    error: null,
    ...overrides,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** Answers requests in order: one queue per path. */
function mockApi(routes: Record<string, (() => Response)[]>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const key = Object.keys(routes).find((route) => path.endsWith(route));
    const queue = key ? routes[key] : undefined;
    if (!queue?.length) return json({ detail: "not mocked" }, 500);
    return (queue.length > 1 ? queue.shift()! : queue[0])();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  useExplorerStore.getState().reset();
  push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared schema", () => {
  it("accepts real analyzer output produced by the backend", () => {
    const graph = parseCodeGraph(sample);
    expect(graph.provenance.kind).toBe("analysis");
    expect(graph.analysis?.repository.fullName).toBe("acme/web-app");
    expect(graph.files.every((f) => f.metrics !== undefined)).toBe(true);
  });

  it("still accepts demo data, which has no metrics", () => {
    expect(parseCodeGraph(demo).analysis).toBeUndefined();
  });

  it("refuses an analysis summary on data labelled as a demo", () => {
    const forged = { ...sample, provenance: { ...sample.provenance, kind: "demo" } };
    expect(() => parseCodeGraph(forged)).toThrow(/only analysis output/);
  });
});

describe("RepoInputForm", () => {
  it("navigates to the repository's page for valid input", async () => {
    const user = userEvent.setup();
    render(<RepoInputForm />);
    await user.type(screen.getByRole("textbox"), "https://github.com/sindresorhus/ky");
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(push).toHaveBeenCalledWith("/explore/gh/sindresorhus/ky");
  });

  it("explains what's wrong and doesn't navigate for invalid input", async () => {
    const user = userEvent.setup();
    render(<RepoInputForm />);
    const input = screen.getByRole("textbox");
    await user.type(input, "https://gitlab.com/a/b");
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Only github.com");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("AnalysisExplorer", () => {
  it("shows progress, then the city built from the real analysis", async () => {
    mockApi({
      "/api/v1/analyses": [() => json(job({ status: "queued", progress: { stage: "queued", filesTotal: 0, filesParsed: 0 }, repository: null }), 202)],
      [`/api/v1/analyses/${"a".repeat(32)}`]: [
        () => json(job()),
        () => json(job({ status: "complete", progress: { stage: "complete", filesTotal: 12, filesParsed: 12 } })),
      ],
      "/graph": [() => json(sample)],
    });
    render(<AnalysisExplorer owner="acme" name="web-app" />);

    expect(await screen.findByText("Analyzing")).toBeInTheDocument();
    expect(await screen.findByText("5 / 12 files")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Files parsed" })).toHaveAttribute(
      "aria-valuenow",
      "5",
    );
    expect(screen.getByText(repository.description!)).toBeInTheDocument();

    expect(await screen.findByTestId("city-canvas", {}, { timeout: 4000 })).toBeInTheDocument();
    // Real analysis carries no demo banner.
    expect(screen.queryByText("DEMO MODE")).not.toBeInTheDocument();
    expect(screen.getByText(`@${SHA.slice(0, 7)}`)).toBeInTheDocument();
  });

  it("shows the analyzer's own message when the analysis fails", async () => {
    mockApi({
      "/api/v1/analyses": [() => json(job({ status: "queued" }), 202)],
      [`/api/v1/analyses/${"a".repeat(32)}`]: [
        () =>
          json(
            job({
              status: "failed",
              progress: { stage: "failed", filesTotal: 0, filesParsed: 0 },
              error: { code: "no_supported_files", message: "No JavaScript or TypeScript source files were found to analyze." },
            }),
          ),
      ],
    });
    render(<AnalysisExplorer owner="acme" name="web-app" />);
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(
      "No JavaScript or TypeScript source files",
    );
    expect(screen.getByText("Analysis failed")).toBeInTheDocument();
  });

  it("tells the user when they've been rate limited, and when to retry", async () => {
    mockApi({
      "/api/v1/analyses": [
        () => json({ detail: "Too many analysis requests. Wait a minute and try again." }, 429, { "Retry-After": "42" }),
      ],
    });
    render(<AnalysisExplorer owner="acme" name="web-app" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many analysis requests");
    expect(screen.getByText("You can try again in 42 seconds.")).toBeInTheDocument();
  });

  it("explains an unreachable API, and retries on request", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AnalysisExplorer owner="acme" name="web-app" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the GitVerse API");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("rejects a graph that doesn't match the shared schema", async () => {
    mockApi({
      "/api/v1/analyses": [() => json(job({ status: "complete" }), 202)],
      "/graph": [() => json({ ...sample, files: [{ id: "../x", path: "../x" }] })],
    });
    render(<AnalysisExplorer owner="acme" name="web-app" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't match the expected format");
  });
});

describe("analysis details in the inspector", () => {
  async function renderComplete() {
    mockApi({
      "/api/v1/analyses": [() => json(job({ status: "complete" }), 202)],
      "/graph": [() => json(sample)],
    });
    render(<AnalysisExplorer owner="acme" name="web-app" />);
    await screen.findByTestId("city-canvas");
    return screen.getByRole("complementary", { name: "Details" });
  }

  it("lists unresolved imports, packages and connected modules", async () => {
    const details = await renderComplete();
    expect(within(details).getByText("./missing")).toBeInTheDocument();
    expect(within(details).getByText("../../outside")).toBeInTheDocument();
    expect(within(details).getByText("react")).toBeInTheDocument();
    expect(within(details).getByText(/Node built-ins: fs, path/)).toBeInTheDocument();
    expect(within(details).getByText("No files depend on each other in a loop.")).toBeInTheDocument();
    expect(within(details).getByText(/1 files had syntax errors/)).toBeInTheDocument();
  });

  it("shows measured metrics for a selected file", async () => {
    const user = userEvent.setup();
    const details = await renderComplete();
    await user.click(within(details).getAllByRole("button", { name: "src/app.tsx" })[0]);
    expect(within(details).getByRole("heading", { name: "app.tsx" })).toBeInTheDocument();
    const value = (label: string) => within(details).getByText(label).nextElementSibling;
    expect(value("Functions")).toHaveTextContent("2");
    expect(value("Classes")).toHaveTextContent("1");
    expect(value("Total lines")).toHaveTextContent("15");
  });

  it("warns that a file with a syntax error may be incomplete", async () => {
    const user = userEvent.setup();
    const details = await renderComplete();
    const files = screen.getByRole("complementary", { name: "Files" });
    await user.click(within(files).getByRole("button", { name: /^broken\.ts/ }));
    expect(within(details).getByText(/has a syntax error/)).toBeInTheDocument();
  });
});

describe("cycleSummary", () => {
  it("only mentions the kinds of cycle that exist", () => {
    expect(cycleSummary(3, 0)).toBe("3 can affect load order at runtime.");
    expect(cycleSummary(0, 2)).toBe("2 only involve type imports.");
    expect(cycleSummary(1, 4)).toBe(
      "1 can affect load order at runtime, and 4 only involve type imports.",
    );
  });
});
