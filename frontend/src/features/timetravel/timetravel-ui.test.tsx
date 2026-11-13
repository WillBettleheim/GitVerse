import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import sample from "@/features/analysis/__fixtures__/analysis-sample.json";
import { AnalysisExplorer } from "@/features/analysis/AnalysisExplorer";
import { useExplorerStore } from "@/features/explorer/store";
import diffSample from "./__fixtures__/diff-sample.json";
import { useTimeTravelStore } from "./store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/city/LazyCityCanvas", () => ({
  LazyCityCanvas: () => <div data-testid="city-canvas" />,
}));

const LATEST = sample.analysis.repository.commitSha;
const sha = (n: number) => n.toString(16).padStart(40, "a");
// Ten commits, newest first, with the analyzed latest at the top.
const COMMITS = [LATEST, ...Array.from({ length: 9 }, (_, i) => sha(i + 1))].map((s, i) => ({
  sha: s,
  summary: i === 0 ? "Release" : `Change number ${i}`,
  message: i === 0 ? "Release" : `Change number ${i}\n\nBody`,
  author: "Ada",
  committedAt: `2026-0${9 - Math.min(i, 8)}-0${(i % 9) + 1}T00:00:00Z`,
  parents: [],
}));

function graphAt(commit: string) {
  const repository = { ...sample.analysis.repository, commitSha: commit };
  return {
    ...sample,
    provenance: { ...sample.provenance, note: `Static analysis of commit ${commit.slice(0, 7)}.` },
    analysis: { ...sample.analysis, repository },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function job(id: string, commit: string | null, status = "complete") {
  return {
    id,
    requested: "acme/web-app",
    commit,
    status,
    createdAt: "2026-01-01T00:00:00+00:00",
    progress: {
      stage: status === "complete" ? "complete" : "queued",
      filesTotal: 12,
      filesParsed: 12,
    },
    repository: { ...sample.analysis.repository, commitSha: commit ?? LATEST },
    cached: false,
    error: null,
  };
}

interface Api {
  posts: (string | null)[];
  deletes: string[];
  compares: string[];
}

/** A small fake of the GitVerse API, enough for time travel. */
function mockApi(options: { queueSnapshots?: boolean } = {}): Api {
  const api: Api = { posts: [], deletes: [], compares: [] };
  const idFor = (commit: string | null) => (commit ?? LATEST).slice(0, 32);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.pathname === "/api/v1/history") {
        return json({
          repository: "acme/web-app",
          defaultBranch: "main",
          page: 1,
          perPage: 30,
          hasMore: false,
          commits: COMMITS,
        });
      }
      if (url.pathname === "/api/v1/compare") {
        api.compares.push(`${url.searchParams.get("base")}..${url.searchParams.get("head")}`);
        return json({
          ...diffSample,
          base: { ...diffSample.base, sha: url.searchParams.get("base") },
          head: { ...diffSample.head, sha: url.searchParams.get("head") },
        });
      }
      if (url.pathname === "/api/v1/analyses" && method === "POST") {
        const { commit = null } = JSON.parse(String(init?.body));
        api.posts.push(commit);
        const queued = options.queueSnapshots && commit !== null;
        return json(job(idFor(commit), commit, queued ? "queued" : "complete"), 202);
      }
      const graphMatch = url.pathname.match(/^\/api\/v1\/analyses\/([0-9a-f]{32})\/graph$/);
      if (graphMatch) {
        const commit = COMMITS.find((c) => c.sha.startsWith(graphMatch[1]))?.sha ?? LATEST;
        return json(graphAt(commit));
      }
      const jobMatch = url.pathname.match(/^\/api\/v1\/analyses\/([0-9a-f]{32})$/);
      if (jobMatch && method === "DELETE") {
        api.deletes.push(jobMatch[1]);
        return json(job(jobMatch[1], null, "failed"));
      }
      if (jobMatch) {
        const commit = COMMITS.find((c) => c.sha.startsWith(jobMatch[1]))?.sha ?? LATEST;
        const queued = options.queueSnapshots && commit !== LATEST;
        return json(
          job(jobMatch[1], commit === LATEST ? null : commit, queued ? "queued" : "complete"),
        );
      }
      return json({ detail: "not mocked" }, 500);
    }),
  );
  return api;
}

const timeline = () => screen.getByRole("region", { name: "Time travel" });
const option = (n: number) =>
  within(timeline())
    .getAllByRole("option")
    .find((o) => o.getAttribute("data-sha") === COMMITS[n].sha)!;
const analyzed = (n: number) => option(n).getAttribute("aria-label")?.endsWith("analyzed.");

beforeEach(() => {
  useExplorerStore.getState().reset();
  useTimeTravelStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderLoaded(options?: { queueSnapshots?: boolean }) {
  const api = mockApi(options);
  const view = render(<AnalysisExplorer owner="acme" name="web-app" />);
  await screen.findByTestId("city-canvas");
  await waitFor(() => expect(within(timeline()).getAllByRole("option")).toHaveLength(10));
  return { api, view };
}

describe("time travel timeline", () => {
  it("lists real history oldest to newest, with the latest commit on show", async () => {
    await renderLoaded();
    const options = within(timeline()).getAllByRole("option");
    expect(options[0].getAttribute("data-sha")).toBe(COMMITS[9].sha);
    expect(options[9].getAttribute("data-sha")).toBe(LATEST);
    expect(options[9]).toHaveAttribute("aria-selected", "true");
    expect(within(timeline()).getByText(/“Release”/)).toBeInTheDocument();
  });

  it("analyzes a handful of representative commits, not all of them", async () => {
    const { api } = await renderLoaded();
    await waitFor(() => expect(analyzed(9)).toBe(true));
    await waitFor(() => expect(api.posts.filter((c) => c !== null).length).toBe(5));
    // Six picked across ten commits; the latest was already analyzed, so five requests.
    const requested = new Set(api.posts.filter(Boolean));
    expect(requested.has(COMMITS[9].sha)).toBe(true);
    expect(requested.size).toBe(5);
  });

  it("shows a selected commit with its changes and its own message", async () => {
    const user = userEvent.setup();
    const { api } = await renderLoaded();
    await waitFor(() => expect(analyzed(9)).toBe(true));
    await user.click(option(9));

    await waitFor(() => expect(screen.getByText(/· historical/)).toBeInTheDocument());
    expect(api.compares).toEqual([`${LATEST}..${COMMITS[9].sha}`]);
    const panel = screen.getByRole("region", { name: "Snapshot" });
    expect(within(panel).getByRole("heading", { name: "Historical snapshot" })).toBeInTheDocument();
    // Exactly as written in the commit, labelled as the author's words.
    expect(
      within(panel)
        .getByText(/Commit message:/)
        .closest("p"),
    ).toHaveTextContent("Commit message: “Change number 9”");
    expect(within(panel).getByText("Renamed").previousElementSibling).toHaveTextContent("1");
    expect(within(panel).getByText(/Renames come from|identical content/)).toBeInTheDocument();
  });

  it("returns to the latest commit", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await waitFor(() => expect(analyzed(9)).toBe(true));
    await user.click(option(9));
    await waitFor(() => expect(screen.getByText(/· historical/)).toBeInTheDocument());

    await user.click(within(timeline()).getByRole("button", { name: "Latest" }));
    await waitFor(() => expect(screen.queryByText(/· historical/)).not.toBeInTheDocument());
    expect(within(timeline()).getByRole("button", { name: "Latest" })).toBeDisabled();
  });

  it("analyzes a commit on demand when it's selected", async () => {
    const user = userEvent.setup();
    const { api } = await renderLoaded();
    await waitFor(() => expect(api.posts.filter(Boolean).length).toBe(5));
    const unanalyzed = COMMITS.findIndex((c, i) => i > 0 && !api.posts.includes(c.sha));
    await user.click(option(unanalyzed));
    await waitFor(() => expect(api.posts).toContain(COMMITS[unanalyzed].sha));
    await waitFor(() =>
      expect(
        screen.getByText(new RegExp(`@${COMMITS[unanalyzed].sha.slice(0, 7)}`)),
      ).toBeInTheDocument(),
    );
  });

  it("compares two chosen commits, marking them A and B", async () => {
    const user = userEvent.setup();
    const { api } = await renderLoaded();
    await waitFor(() => expect(analyzed(9) && analyzed(5)).toBe(true));
    await user.click(within(timeline()).getByRole("button", { name: "Compare" }));
    expect(within(timeline()).getByText(/select the first commit \(A\)/)).toBeInTheDocument();

    await user.click(option(9));
    await waitFor(() =>
      expect(
        within(timeline()).getByText(/now select the second commit \(B\)/),
      ).toBeInTheDocument(),
    );
    await user.click(option(5));
    await waitFor(() => expect(api.compares).toContain(`${COMMITS[9].sha}..${COMMITS[5].sha}`));
    expect(within(timeline()).getByText("A")).toBeInTheDocument();
    expect(within(timeline()).getByText("B")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Comparison" })).toBeInTheDocument();
  });

  it("steps through commits with the arrow keys", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    option(9).focus();
    await user.keyboard("{ArrowLeft}");
    expect(useTimeTravelStore.getState().pending ?? useTimeTravelStore.getState().viewing).toBe(
      COMMITS[1].sha,
    );
  });

  it("only offers playback with at least two analyzed commits, and plays at the chosen speed", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const play = within(timeline()).getByRole("button", { name: "Play" });
    await waitFor(() => expect(play).toBeEnabled());
    await user.click(within(timeline()).getByRole("button", { name: "2×" }));
    expect(useTimeTravelStore.getState().speed).toBe(2);
    await user.click(play);
    // Playback starts from the oldest analyzed commit.
    await waitFor(() => expect(useTimeTravelStore.getState().viewing).toBe(COMMITS[9].sha));
    await user.click(within(timeline()).getByRole("button", { name: "Pause" }));
    expect(useTimeTravelStore.getState().playing).toBe(false);
  });

  it("cancels analyses that haven't started when leaving", async () => {
    const { api, view } = await renderLoaded({ queueSnapshots: true });
    await waitFor(() => expect(api.posts.filter(Boolean).length).toBeGreaterThan(0));
    await act(async () => view.unmount());
    expect(api.deletes.length).toBeGreaterThan(0);
  });
});
