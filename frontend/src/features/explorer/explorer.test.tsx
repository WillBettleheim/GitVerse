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
  it("shows insights with real counts before anything is selected", () => {
    render(<ExplorerShell graph={graph} />);
    const details = screen.getByRole("complementary", { name: "Details" });
    expect(within(details).getByRole("heading", { name: "Insights" })).toBeInTheDocument();
    const stats = within(details.querySelector("dl")!);
    const stat = (label: string) => stats.getByText(label).nextElementSibling;
    expect(stat("Files analyzed")).toHaveTextContent(String(graph.files.length));
    expect(stat("Dependency edges")).toHaveTextContent(String(graph.edges.length));
    expect(stat("Dependency cycles")).toHaveTextContent("0");
    expect(within(details).getByText("From sample data")).toBeInTheDocument();
  });

  it("selecting a file shows its imports, and following one navigates there", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    const details = screen.getByRole("complementary", { name: "Details" });

    await user.click(within(files).getByRole("button", { name: /^useCart\.ts/ }));
    expect(within(details).getByText("src/hooks/useCart.ts")).toBeInTheDocument();

    await user.click(within(details).getByTitle("src/store/cartStore.ts"));
    expect(useExplorerStore.getState().selectedId).toBe("src/store/cartStore.ts");
    expect(within(details).getByRole("heading", { name: "cartStore.ts" })).toBeInTheDocument();
  });

  it("filters the file list and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    const input = screen.getByRole("searchbox", { name: "Search files" });

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
    expect(
      screen.getByText(/^Selected src\/hooks\/useCart\.ts\. Imports 1 files\./),
    ).toBeInTheDocument();
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
    await user.type(screen.getByRole("searchbox", { name: "Search files" }), "fr");
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
    await user.click(within(files).getByRole("button", { name: /^src\/api\/routes\/part0/ }));
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
    await user.type(screen.getByRole("searchbox", { name: "Search files" }), large.files[500].path);
    expect(within(files).getByTitle(large.files[500].path)).toBeInTheDocument();
  });
});

describe("groupFiles", () => {
  const city = generateCity(graph);

  it("keeps every file, folders in alphabetical order, without search results", () => {
    const groups = groupFiles(city, null);
    expect(groups.reduce((sum, g) => sum + g.buildings.length, 0)).toBe(graph.files.length);
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual([...labels].sort());
  });

  it("keeps only results, ordering folders and files by best match", () => {
    const results = [
      { id: "src/server/db/schema.ts" },
      { id: "src/app/page.tsx" },
      { id: "src/server/db/client.ts" },
    ];
    const groups = groupFiles(city, results);
    expect(groups.map((g) => g.id)).toEqual(["src/server/db", "src/app"]);
    expect(groups[0].buildings.map((b) => b.id)).toEqual([
      "src/server/db/schema.ts",
      "src/server/db/client.ts",
    ]);
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

describe("selection stays in sync everywhere", () => {
  it("a selection made in the city updates the list, inspector, breadcrumbs and announcer", () => {
    render(<ExplorerShell graph={graph} />);
    // The canvas selects through the store, exactly like this.
    act(() => useExplorerStore.getState().select("src/server/db/schema.ts"));

    const files = screen.getByRole("complementary", { name: "Files" });
    const details = screen.getByRole("complementary", { name: "Details" });
    expect(within(files).getByTitle("src/server/db/schema.ts")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(details).getByRole("heading", { name: "schema.ts" })).toBeInTheDocument();
    const crumbs = within(details).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByText("schema.ts")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/^Selected src\/server\/db\/schema\.ts\./)).toBeInTheDocument();
  });

  it("a selection made in the list reaches the store the city reads", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    await user.click(within(files).getByRole("button", { name: /^Header\.tsx/ }));
    expect(useExplorerStore.getState().selectedId).toBe("src/components/Header.tsx");
  });

  it("a selection made in the graph view updates the inspector", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("src/hooks/useCart.ts");
    useExplorerStore.getState().setMainView("graph");
    render(<ExplorerShell graph={graph} />);
    const view = screen.getByRole("region", { name: "Dependency graph" });
    await user.click(within(view).getByTitle("src/store/cartStore.ts"));
    expect(useExplorerStore.getState().selectedId).toBe("src/store/cartStore.ts");
    const details = screen.getByRole("complementary", { name: "Details" });
    expect(within(details).getByRole("heading", { name: "cartStore.ts" })).toBeInTheDocument();
  });
});

describe("file inspector", () => {
  const details = () => screen.getByRole("complementary", { name: "Details" });
  const stat = (label: string) => within(details()).getByText(label).nextElementSibling;

  it("shows the file's measured values and honest gaps for sample data", () => {
    useExplorerStore.getState().select("src/store/cartStore.ts");
    render(<ExplorerShell graph={graph} />);
    expect(within(details()).getByText("src/store/cartStore.ts")).toBeInTheDocument();
    expect(stat("Lines of code")).toHaveTextContent("168");
    expect(stat("Complexity")).toHaveTextContent("15");
    expect(stat("Imports")).toHaveTextContent("2");
    expect(stat("Imported by")).toHaveTextContent("2");
    // Sample data has no source, so these aren't measured and say so instead of guessing.
    expect(stat("Functions")).toHaveTextContent("—");
    expect(stat("Classes")).toHaveTextContent("—");
    expect(within(details()).getByText(/No source link: this is sample data/)).toBeInTheDocument();
  });

  it("breadcrumb folders narrow the search and return to the overview", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("src/server/db/schema.ts");
    render(<ExplorerShell graph={graph} />);
    const crumbs = within(details()).getByRole("navigation", { name: "Breadcrumb" });
    await user.click(within(crumbs).getByRole("button", { name: "server" }));
    expect(useExplorerStore.getState().selectedId).toBeNull();
    expect(useExplorerStore.getState().filters.folder).toBe("src/server");
    expect(within(details()).getByRole("heading", { name: "Insights" })).toBeInTheDocument();
    const files = screen.getByRole("complementary", { name: "Files" });
    expect(within(files).getByRole("status")).toHaveTextContent(/files match/);
    expect(within(files).queryByTitle("src/app/page.tsx")).not.toBeInTheDocument();
  });
});

describe("dependency explorer", () => {
  const details = () => screen.getByRole("complementary", { name: "Details" });

  it("lists direct imports and importers with their direction", () => {
    useExplorerStore.getState().select("src/hooks/useCart.ts");
    render(<ExplorerShell graph={graph} />);
    const section = within(details()).getByRole("region", { name: "Dependencies" });
    expect(within(section).getByRole("heading", { name: /Depends on/ })).toHaveTextContent("1");
    expect(within(section).getByTitle("src/store/cartStore.ts")).toHaveTextContent("→");
    expect(within(section).getByTitle("src/app/cart/page.tsx")).toHaveTextContent("←");
  });

  it("follows more hops when the depth is raised", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("src/hooks/useCart.ts");
    render(<ExplorerShell graph={graph} />);
    const section = within(details()).getByRole("region", { name: "Dependencies" });
    expect(within(section).queryByTitle("src/lib/format.ts")).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "2" }));
    expect(useExplorerStore.getState().depth).toBe(2);
    expect(within(section).getAllByText("2 hops").length).toBeGreaterThan(0);
    // useCart → cartStore → format
    expect(within(section).getByTitle("src/lib/format.ts")).toBeInTheDocument();
  });

  it("shows one direction only when asked", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("src/hooks/useCart.ts");
    render(<ExplorerShell graph={graph} />);
    const section = within(details()).getByRole("region", { name: "Dependencies" });
    await user.click(within(section).getByRole("button", { name: "Imports →" }));
    expect(
      within(section).queryByRole("heading", { name: /Depended on by/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the graph view and returns to the city", async () => {
    const user = userEvent.setup();
    useExplorerStore.getState().select("src/hooks/useCart.ts");
    render(<ExplorerShell graph={graph} />);
    await user.click(within(details()).getByRole("button", { name: "Open as graph" }));
    const view = screen.getByRole("region", { name: "Dependency graph" });
    expect(within(view).getByTitle("src/hooks/useCart.ts")).toHaveAttribute("aria-current", "true");
    await user.keyboard("{Escape}");
    expect(useExplorerStore.getState().mainView).toBe("city");
  });
});

describe("search and filters", () => {
  it("narrows the list by language and metrics, and counts the matches", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    await user.click(within(files).getByRole("button", { name: /^Filters( \(\d+\))? [▴▾]$/ }));
    await user.selectOptions(within(files).getByLabelText("Language"), "json");
    expect(within(files).getByRole("status")).toHaveTextContent(
      `1 of ${graph.files.length} files match`,
    );
    expect(within(files).getByTitle("package.json")).toBeInTheDocument();

    await user.selectOptions(within(files).getByLabelText("Language"), "__all");
    await user.type(within(files).getByLabelText("Min importers"), "6");
    const status = within(files).getByRole("status").textContent ?? "";
    expect(Number(status.split(" ")[0])).toBeGreaterThan(0);
    expect(within(files).getByTitle("src/components/Button.tsx")).toBeInTheDocument();

    await user.click(within(files).getByRole("button", { name: "Clear" }));
    expect(within(files).queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains an empty result for filters without a query", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const files = screen.getByRole("complementary", { name: "Files" });
    await user.click(within(files).getByRole("button", { name: /^Filters( \(\d+\))? [▴▾]$/ }));
    await user.type(within(files).getByLabelText("Min lines"), "99999");
    expect(within(files).getByText("No files match these filters.")).toBeInTheDocument();
  });
});

describe("insights dashboard", () => {
  it("ranks real files and lets you jump to one", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const details = screen.getByRole("complementary", { name: "Details" });
    expect(within(details).getByText("621 lines")).toBeInTheDocument();
    expect(within(details).getByText("67 paths")).toBeInTheDocument();
    await user.click(within(details).getAllByTitle("src/server/services/pricingEngine.ts")[0]);
    expect(useExplorerStore.getState().selectedId).toBe("src/server/services/pricingEngine.ts");
  });

  it("filters the city to an area from the folder distribution", async () => {
    const user = userEvent.setup();
    render(<ExplorerShell graph={graph} />);
    const details = screen.getByRole("complementary", { name: "Details" });
    await user.click(within(details).getByRole("button", { name: /^src\/server/ }));
    expect(useExplorerStore.getState().filters.folder).toBe("src/server");
  });
});
