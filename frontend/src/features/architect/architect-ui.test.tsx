import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import sample from "@/features/analysis/__fixtures__/analysis-sample.json";
import { AnalysisExplorer } from "@/features/analysis/AnalysisExplorer";
import { useExplorerStore } from "@/features/explorer/store";
import { useTimeTravelStore } from "@/features/timetravel/store";
import answerSample from "./__fixtures__/answer-sample.json";
import { useArchitectStore } from "./store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/city/LazyCityCanvas", () => ({
  LazyCityCanvas: () => <div data-testid="city-canvas" />,
}));

const SHA = sample.analysis.repository.commitSha;
const JOB = SHA.slice(0, 32);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const job = {
  id: JOB,
  requested: "acme/web-app",
  commit: null,
  status: "complete",
  createdAt: "2026-01-01T00:00:00+00:00",
  progress: { stage: "complete", filesTotal: 12, filesParsed: 12 },
  repository: sample.analysis.repository,
  cached: true,
  error: null,
};

/** The GitVerse API, with AI Architect replying with `reply` to every question. */
function mockApi(reply: () => Response = () => json(answerSample)) {
  const questions: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/architect/questions") {
        questions.push(JSON.parse(String(init?.body)));
        return reply();
      }
      if (url.pathname === "/api/v1/history") {
        return json({
          repository: "acme/web-app",
          defaultBranch: "main",
          page: 1,
          perPage: 30,
          hasMore: false,
          commits: [
            {
              sha: SHA,
              summary: "Release",
              message: "Release",
              author: "Ada",
              committedAt: "2026-01-01T00:00:00Z",
              parents: [],
            },
          ],
        });
      }
      if (url.pathname === "/api/v1/analyses") return json(job, 202);
      if (url.pathname === `/api/v1/analyses/${JOB}/graph`) return json(sample);
      if (url.pathname === `/api/v1/analyses/${JOB}`) return json(job);
      return json({ detail: "not mocked" }, 500);
    }),
  );
  return questions;
}

beforeEach(() => {
  useExplorerStore.getState().reset();
  useTimeTravelStore.getState().reset();
  useArchitectStore.getState().reset();
});

afterEach(() => vi.unstubAllGlobals());

async function openArchitect() {
  const user = userEvent.setup();
  render(<AnalysisExplorer owner="acme" name="web-app" />);
  await screen.findByTestId("city-canvas");
  await user.click(screen.getByRole("tab", { name: "AI Architect" }));
  return { user, panel: screen.getByRole("region", { name: "AI Architect" }) };
}

async function askFirstSuggestion() {
  const { user, panel } = await openArchitect();
  await user.click(
    within(panel).getByRole("button", { name: "Which files are central to the architecture?" }),
  );
  const answer = await within(panel).findByRole("article", { name: "Answer" });
  return { user, panel, answer };
}

describe("AI Architect", () => {
  it("sits beside the inspector, tied to the analyzed commit", async () => {
    mockApi();
    const { panel } = await openArchitect();
    expect(screen.getByRole("tab", { name: "AI Architect" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(panel).getByText(SHA.slice(0, 7))).toBeInTheDocument();
    expect(within(panel).getAllByRole("button").length).toBeGreaterThan(3);
  });

  it("asks the server, never the model directly, and shows a checked answer", async () => {
    const questions = mockApi();
    const { answer } = await askFirstSuggestion();
    expect(questions).toEqual([
      {
        repository: "acme/web-app",
        commit: SHA,
        question: "Which files are central to the architecture?",
        snapshots: [],
      },
    ]);
    expect(within(answer).getByText(/imported directly by three files/)).toBeInTheDocument();
    const claims = within(answer).getByRole("list", { name: "Claims" });
    expect(within(claims).getAllByText("Verified")).toHaveLength(1);
    expect(within(claims).getAllByText("Inferred")).toHaveLength(2);
    expect(within(answer).getByText("Uncertainty")).toBeInTheDocument();
    // What the server's checks removed is shown, not hidden.
    expect(within(answer).getByText(/src\/helpers\/missing\.ts/)).toBeInTheDocument();
  });

  it("links verified lines to the analyzed commit on GitHub", async () => {
    mockApi();
    const { answer } = await askFirstSuggestion();
    const lines = within(answer).getByRole("list", { name: "Lines in helper.ts" });
    expect(within(lines).getByRole("link", { name: "L1–13" })).toHaveAttribute(
      "href",
      `https://github.com/acme/web-app/blob/${SHA}/src/utils/helper.ts#L1-L13`,
    );
    const dependencies = within(answer).getByRole("list", { name: "Dependencies" });
    expect(within(dependencies).getAllByRole("link", { name: "line 1" })[0]).toHaveAttribute(
      "href",
      `https://github.com/acme/web-app/blob/${SHA}/src/app.tsx#L1`,
    );
  });

  it("highlights the answer's files and relationships in the city", async () => {
    mockApi();
    const { user, answer } = await askFirstSuggestion();
    const spotlight = useArchitectStore.getState().spotlight;
    expect(spotlight?.files).toEqual(["src/utils/helper.ts", "src/app.tsx", "src/utils/index.ts"]);
    expect(spotlight?.edges).toContainEqual({
      source: "src/app.tsx",
      target: "src/utils/helper.ts",
    });

    const toggle = within(answer).getByRole("button", { name: "Highlighted" });
    await user.click(toggle);
    expect(useArchitectStore.getState().spotlight).toBeNull();
    await user.click(within(answer).getByRole("button", { name: "Highlight" }));
    expect(useArchitectStore.getState().spotlight?.files).toHaveLength(3);
  });

  it("focuses the camera on the answer's files", async () => {
    mockApi();
    const { user, answer } = await askFirstSuggestion();
    await user.click(within(answer).getByRole("button", { name: "Focus camera" }));
    const command = useExplorerStore.getState().cameraCommand;
    expect(command.type).toBe("frame");
    expect(command.ids).toEqual(["src/utils/helper.ts", "src/app.tsx", "src/utils/index.ts"]);
  });

  it("opens a file in the inspector", async () => {
    mockApi();
    const { user, answer } = await askFirstSuggestion();
    await user.click(within(answer).getByRole("button", { name: "src/app.tsx" }));
    expect(useExplorerStore.getState().selectedId).toBe("src/app.tsx");
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  });

  it("sends the selected file as the subject of the question", async () => {
    const questions = mockApi();
    const { user, panel } = await openArchitect();
    useExplorerStore.getState().select("src/utils/helper.ts");
    const box = await within(panel).findByPlaceholderText(/Ask about helper\.ts/);
    await user.type(box, "What depends on this module?{Enter}");
    await within(panel).findByRole("article", { name: "Answer" });
    expect(questions[0]).toMatchObject({
      question: "What depends on this module?",
      focus: "src/utils/helper.ts",
    });
  });

  it("labels evidence-only answers when the server has no model", async () => {
    mockApi(() =>
      json({
        ...answerSample,
        mode: "evidence_only",
        answer: null,
        claims: [],
        uncertainty: null,
        model: null,
        notes: ["AI explanations are turned off on this server."],
      }),
    );
    const { answer } = await askFirstSuggestion();
    expect(
      within(answer).getByText("Evidence only: AI explanations are off on this server"),
    ).toBeInTheDocument();
    expect(within(answer).queryByRole("list", { name: "Claims" })).not.toBeInTheDocument();
    expect(within(answer).getByRole("button", { name: "src/utils/helper.ts" })).toBeInTheDocument();
  });

  it("says plainly when there's no evidence", async () => {
    mockApi(() =>
      json({
        ...answerSample,
        mode: "insufficient_evidence",
        answer: null,
        claims: [],
        files: [],
        relationships: [],
        evidence: [],
        notes: [],
        sufficientEvidence: false,
        uncertainty: "GitVerse found nothing in this analysis that relates to this question.",
        model: null,
      }),
    );
    const { answer } = await askFirstSuggestion();
    expect(within(answer).getByText("No matching evidence")).toBeInTheDocument();
    expect(within(answer).getByText("Not enough evidence")).toBeInTheDocument();
    expect(useArchitectStore.getState().spotlight).toBeNull();
  });

  it("shows the server's error, with the wait, and retries", async () => {
    let calls = 0;
    mockApi(() =>
      ++calls === 1
        ? json({ detail: "Too many questions. Wait a minute and try again." }, 429, {
            "Retry-After": "30",
          })
        : json(answerSample),
    );
    const { user, panel } = await openArchitect();
    await user.click(within(panel).getByRole("button", { name: /central to the architecture/ }));
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent("Too many questions.");
    await user.click(within(alert).getByRole("button", { name: "Retry (wait 30s)" }));
    await waitFor(() =>
      expect(within(panel).getByRole("article", { name: "Answer" })).toBeInTheDocument(),
    );
  });

  it("isn't offered for demo data", async () => {
    const { ExplorerShell } = await import("@/features/explorer/ExplorerShell");
    const demo = (await import("@/features/demo/demo-graph.json")).default;
    const { parseCodeGraph } = await import("@/lib/graph/schema");
    render(<ExplorerShell graph={parseCodeGraph(demo)} />);
    expect(screen.queryByRole("tab", { name: "AI Architect" })).not.toBeInTheDocument();
  });
});
