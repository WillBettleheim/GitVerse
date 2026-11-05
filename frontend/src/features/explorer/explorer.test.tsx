import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadDemoGraph } from "@/features/demo/load-demo-graph";
import { generateSyntheticGraph } from "@/features/demo/synthetic-graph";
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

    await user.click(within(files).getByRole("button", { name: /^useCart\.ts/ }));
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
    expect(within(files).getByRole("button", { name: /^pricingEngine\.ts/ })).toBeInTheDocument();
    expect(within(files).queryByRole("button", { name: /^Header\.tsx/ })).not.toBeInTheDocument();

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
    expect(useExplorerStore.getState().cameraCommand).toEqual({ type: "reset", count: 1 });
  });

  it("keeps the selection when fitting to the city", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("package.json");
    render(<ExplorerShell graph={graph} />);

    await user.click(screen.getByRole("button", { name: "Fit to city" }));
    expect(useExplorerStore.getState().selectedId).toBe("package.json");
    expect(useExplorerStore.getState().cameraCommand).toEqual({ type: "fit", count: 1 });
  });

  it("announces selections for screen readers", () => {
    render(<ExplorerShell graph={graph} />);
    act(() => useExplorerStore.getState().select("src/hooks/useCart.ts"));
    expect(screen.getByText(/^Selected src\/hooks\/useCart\.ts\. Imports 1 files\./)).toBeInTheDocument();
  });

  it("marks key modules in the file list", () => {
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    expect(within(files).getAllByText(", key module").length).toBeGreaterThan(0);
  });
});

describe("reduced motion", () => {
  const original = window.matchMedia;

  afterEach(() => {
    window.matchMedia = original;
  });

  it("turns off the cinematic flight and says why", () => {
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes("reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList;
    render(<ExplorerShell graph={graph} />);
    const button = screen.getByRole("button", { name: "Cinematic" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/reduced motion/i));
  });

  it("offers it otherwise", () => {
    render(<ExplorerShell graph={graph} />);
    expect(screen.getByRole("button", { name: "Cinematic" })).toBeEnabled();
  });
});

describe("keyboard shortcuts", () => {
  it("clears the selection, fits and resets", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("package.json");
    render(<ExplorerShell graph={graph} />);

    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().selectedId).toBeNull();
    await user.keyboard("f");
    expect(useExplorerStore.getState().cameraCommand.type).toBe("fit");
    await user.keyboard("r");
    expect(useExplorerStore.getState().cameraCommand.type).toBe("reset");
  });

  it("doesn't fire while typing in the filter", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    await user.type(screen.getByRole("searchbox", { name: "Filter files" }), "fr");
    expect(useExplorerStore.getState().cameraCommand.count).toBe(0);
  });
});

describe("explorer store", () => {
  const state = () => useExplorerStore.getState();

  it("doesn't notify subscribers when hover hasn't changed", () => {
    const listener = vi.fn();
    const unsubscribe = useExplorerStore.subscribe(listener);
    state().hover("a");
    state().hover("a");
    state().hover("a");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ends the cinematic flight when a file is selected", () => {
    state().toggleCinematic();
    expect(state().cinematic).toBe(true);
    state().select("a");
    expect(state().cinematic).toBe(false);
  });

  it("clears the selection when a cinematic flight starts", () => {
    state().select("a");
    state().toggleCinematic();
    expect(state().selectedId).toBeNull();
  });

  it("ends the cinematic flight on fit and reset", () => {
    state().toggleCinematic();
    state().fitCamera();
    expect(state().cinematic).toBe(false);
    state().toggleCinematic();
    state().resetCamera();
    expect(state().cinematic).toBe(false);
  });

  it("counts repeated commands, so each one takes effect", () => {
    state().resetCamera();
    state().resetCamera();
    expect(state().cameraCommand.count).toBe(2);
  });
});

describe("large file lists", () => {
  const large = generateSyntheticGraph(1000);

  it("starts folders collapsed, and still lists every folder", () => {
    render(<ExplorerShell graph={large} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    expect(within(files).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(files).getAllByRole("button", { expanded: false }).length).toBeGreaterThan(10);
  });

  it("expands a folder on request", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={large} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    await user.click(within(files).getAllByRole("button", { expanded: false })[0]);
    expect(within(files).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("opens the selected file's folder, so a selection made in the city is visible", () => {
    render(<ExplorerShell graph={large} />);
    const target = large.files[500];
    act(() => useExplorerStore.getState().select(target.id));
    const files = screen.getByRole("complementary", { name: "Files" });
    expect(within(files).getByTitle(target.path)).toHaveAttribute("aria-current", "true");
  });

  it("finds files across collapsed folders by filtering", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={large} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    await user.type(screen.getByRole("searchbox", { name: "Filter files" }), large.files[500].path);
    expect(within(files).getByTitle(large.files[500].path)).toBeInTheDocument();
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
