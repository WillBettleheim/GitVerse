import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadDemoGraph } from "@/features/demo/load-demo-graph";
import { generateCity } from "@/lib/city/layout";
import type { CodeGraph } from "@/lib/graph/schema";
import { ApiStatus } from "./ApiStatus";
import { DemoBanner } from "./DemoBanner";
import { ExplorerShell } from "./ExplorerShell";
import { groupFiles } from "./FileNavigator";
import { useExplorerStore } from "./store";

// WebGL doesn't exist in jsdom. The scene is verified in a real browser; these cover the UI.
vi.mock("@/features/city/LazyCityCanvas", () => ({
  LazyCityCanvas: () => <div data-testid="city-canvas" />,
}));

const graph = loadDemoGraph();

beforeEach(() => {
  useExplorerStore.getState().reset();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo labelling", () => {
  it("labels demo data", () => {
    render(<DemoBanner provenance={graph.provenance} />);
    expect(screen.getByRole("status")).toHaveTextContent("DEMO MODE");
    expect(screen.getByRole("status")).toHaveTextContent(/not the result of analyzing/i);
  });

  it("doesn't label real analysis as a demo", () => {
    const { container } = render(
      <DemoBanner provenance={{ kind: "analysis", repository: "a/b", note: "" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("always shows the banner in the explorer for demo graphs", () => {
    render(<ExplorerShell graph={graph} />);
    expect(screen.getByText("DEMO MODE")).toBeInTheDocument();
    expect(screen.getByText("sample/lumen-store")).toBeInTheDocument();
  });

  it("leaves the banner out of the explorer for analysis graphs", () => {
    const analysed: CodeGraph = {
      ...graph,
      provenance: { kind: "analysis", repository: "owner/repo", note: "" },
    };
    render(<ExplorerShell graph={analysed} />);
    expect(screen.queryByText("DEMO MODE")).not.toBeInTheDocument();
  });
});

describe("explorer interaction", () => {
  it("shows a city overview with real counts before anything is selected", () => {
    render(<ExplorerShell graph={graph} />);
    const details = screen.getByRole("complementary", { name: "Details" });
    expect(within(details).getByText("City overview")).toBeInTheDocument();
    expect(within(details).getByText(String(graph.files.length))).toBeInTheDocument();
    expect(within(details).getByText(String(graph.edges.length))).toBeInTheDocument();
  });

  it("selecting a file shows its imports, and following one navigates there", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    const details = screen.getByRole("complementary", { name: "Details" });

    await user.click(within(files).getByRole("button", { name: "useCart.ts" }));
    expect(within(details).getByText("src/hooks/useCart.ts")).toBeInTheDocument();

    await user.click(within(details).getByRole("button", { name: "src/store/cartStore.ts" }));
    expect(useExplorerStore.getState().selectedId).toBe("src/store/cartStore.ts");
    expect(within(details).getByRole("heading", { name: "cartStore.ts" })).toBeInTheDocument();
  });

  it("filters the file list and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    const input = screen.getByRole("searchbox", { name: "Filter files" });

    await user.type(input, "pricing");
    expect(within(files).getByRole("button", { name: "pricingEngine.ts" })).toBeInTheDocument();
    expect(within(files).queryByRole("button", { name: "Header.tsx" })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "zzz-no-match");
    expect(within(files).getByText(/No files match/)).toBeInTheDocument();
  });

  it("toggles connections and clears the selection on reset view", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("package.json");
    render(<ExplorerShell graph={graph} />);

    const toggle = screen.getByRole("button", { name: "Connections" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(useExplorerStore.getState().selectedId).toBeNull();
    expect(useExplorerStore.getState().cameraResetCount).toBe(1);
  });
});

describe("groupFiles", () => {
  const city = generateCity(graph);

  it("keeps every file when there is no query", () => {
    const total = groupFiles(city, "").reduce((sum, g) => sum + g.buildings.length, 0);
    expect(total).toBe(graph.files.length);
  });

  it("matches case-insensitively on the whole path", () => {
    const groups = groupFiles(city, "SERVER/DB");
    expect(groups.map((g) => g.id)).toEqual(["src/server/db"]);
  });
});

describe("ApiStatus", () => {
  it("reports online when the health check succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<ApiStatus />);
    await waitFor(() => expect(screen.getByText("API online")).toBeInTheDocument());
  });

  it("reports offline when the request fails", async () => {
    render(<ApiStatus />);
    await waitFor(() => expect(screen.getByText("API offline")).toBeInTheDocument());
  });

  it("reports offline on an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<ApiStatus />);
    await waitFor(() => expect(screen.getByText("API offline")).toBeInTheDocument());
  });
});
