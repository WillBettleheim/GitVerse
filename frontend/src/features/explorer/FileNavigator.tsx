"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Building, CityLayout } from "@/lib/city/layout";
import { countFormat, useExplorerData } from "./explorer-data";
import { SearchFilters } from "./SearchFilters";
import { useExplorerStore } from "./store";
import { useSearchResults } from "./use-explorer-data";

/** Above this, folders start collapsed, so the list stays quick and navigable. */
const COLLAPSE_ABOVE_FILES = 300;

interface DistrictGroup {
  id: string;
  label: string;
  color: string;
  buildings: Building[];
}

/**
 * Groups files by district. With search results, keeps only matches and orders folders by their
 * best match. Without, every file, folders in alphabetical order.
 */
export function groupFiles(
  city: CityLayout,
  results: readonly { id: string }[] | null,
): DistrictGroup[] {
  const rank = results ? new Map(results.map((r, i) => [r.id, i])) : null;
  const byDistrict = new Map<string, Building[]>();
  for (const building of city.buildings) {
    if (rank && !rank.has(building.id)) continue;
    const list = byDistrict.get(building.districtId);
    if (list) list.push(building);
    else byDistrict.set(building.districtId, [building]);
  }
  const best = (group: DistrictGroup) =>
    Math.min(...group.buildings.map((b) => rank?.get(b.id) ?? 0));
  if (rank) {
    for (const list of byDistrict.values()) list.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }
  return city.districts
    .filter((district) => byDistrict.has(district.id))
    .map((district) => ({
      id: district.id,
      label: district.label,
      color: district.color,
      buildings: byDistrict.get(district.id)!,
    }))
    .sort((a, b) =>
      rank ? best(a) - best(b) : a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
    );
}

export function FileNavigator() {
  const { graph, city, adjacency } = useExplorerData();
  const query = useExplorerStore((s) => s.query);
  const setQuery = useExplorerStore((s) => s.setQuery);
  const clearSearch = useExplorerStore((s) => s.clearSearch);
  const selectedId = useExplorerStore((s) => s.selectedId);
  const search = useSearchResults(graph.files, adjacency);

  const groups = useMemo(
    () => groupFiles(city, search.active ? search.results : null),
    [city, search],
  );
  const collapsedByDefault = city.buildings.length > COLLAPSE_ABOVE_FILES;
  // Folders the user has flipped away from the default.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());

  const selectedDistrict = useMemo(
    () => city.buildings.find((b) => b.id === selectedId)?.districtId ?? null,
    [city.buildings, selectedId],
  );

  const isExpanded = (id: string) =>
    search.active || id === selectedDistrict || collapsedByDefault === flipped.has(id);

  const toggle = (id: string) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Selecting a building in the city brings its row into view in the list.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = list.current;
    // Only when the list scrolls by itself (wide screens). On phones it's part of the page, and
    // scrolling to it would pull the page away from the city and inspector.
    if (!selectedId || !container || container.scrollHeight <= container.clientHeight) return;
    container.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or path…"
          aria-label="Search files"
          className="h-9 w-full rounded border border-line bg-void px-3 text-sm placeholder:text-faint focus:border-cyan/60 focus:outline-none"
        />
        <SearchFilters />
        {search.active && (
          <p
            role="status"
            className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-muted"
          >
            <span>
              {countFormat.format(search.results.length)} of{" "}
              {countFormat.format(graph.files.length)} files match
            </span>
            <button type="button" onClick={clearSearch} className="text-cyan hover:text-text">
              Clear
            </button>
          </p>
        )}
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.length === 0 && (
          <p className="px-4 py-3 text-sm text-faint">
            No files match{query.trim() ? ` “${query.trim()}”` : " these filters"}.
          </p>
        )}
        {groups.map((group) => {
          const expanded = isExpanded(group.id);
          return (
            <section key={group.id} className="mb-1">
              <h3>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(group.id)}
                  className="flex w-full items-center gap-2 px-4 py-1 text-left font-mono text-[11px] text-faint transition-colors hover:text-text"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="tabular-nums">{group.buildings.length}</span>
                </button>
              </h3>
              {expanded && (
                <ul className="mb-2">
                  {group.buildings.map((building) => (
                    <FileRow
                      key={building.id}
                      id={building.id}
                      name={building.name}
                      path={building.path}
                      landmark={building.landmark}
                      active={building.id === selectedId}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface FileRowProps {
  id: string;
  name: string;
  path: string;
  landmark: boolean;
  active: boolean;
}

/** On phones the list sits below the details, so show what was just selected. */
function revealDetailsOnNarrowScreens() {
  if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document
    .querySelector('aside[aria-label="Details"]')
    ?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** Memoized, so changing the selection re-renders two rows and not the whole list. */
const FileRow = memo(function FileRow({ id, name, path, landmark, active }: FileRowProps) {
  const select = useExplorerStore((s) => s.select);
  const hover = useExplorerStore((s) => s.hover);
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        title={path}
        onClick={() => {
          select(active ? null : id);
          if (!active) revealDetailsOnNarrowScreens();
        }}
        onPointerEnter={() => hover(id)}
        onPointerLeave={() => hover(null)}
        onFocus={() => hover(id)}
        onBlur={() => hover(null)}
        className={`flex w-full items-center gap-2 px-4 py-1 pl-8 text-left text-[13px] transition-colors ${
          active ? "bg-raised text-cyan" : "text-muted hover:bg-panel hover:text-text"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {landmark && (
          <span title="Key module" className="shrink-0 text-[10px] text-cyan">
            <span aria-hidden="true">◆</span>
            <span className="sr-only">, key module</span>
          </span>
        )}
      </button>
    </li>
  );
});
