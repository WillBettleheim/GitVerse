"use client";

import { useMemo } from "react";
import type { Building, CityLayout } from "@/lib/city/layout";
import { useExplorerStore } from "./store";

interface DistrictGroup {
  id: string;
  label: string;
  color: string;
  buildings: Building[];
}

/** Groups by district alphabetically, keeping only files whose path matches the query. */
export function groupFiles(city: CityLayout, query: string): DistrictGroup[] {
  const needle = query.trim().toLowerCase();
  return city.districts
    .map((district) => ({
      id: district.id,
      label: district.label,
      color: district.color,
      buildings: city.buildings.filter(
        (b) => b.districtId === district.id && b.path.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.buildings.length > 0)
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

export function FileNavigator({ city }: { city: CityLayout }) {
  const query = useExplorerStore((s) => s.query);
  const setQuery = useExplorerStore((s) => s.setQuery);
  const selectedId = useExplorerStore((s) => s.selectedId);
  const select = useExplorerStore((s) => s.select);
  const hover = useExplorerStore((s) => s.hover);

  const groups = useMemo(() => groupFiles(city, query), [city, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter files…"
          aria-label="Filter files"
          className="h-9 w-full rounded border border-line bg-void px-3 text-sm placeholder:text-faint focus:border-cyan/60 focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.length === 0 && (
          <p className="px-4 py-3 text-sm text-faint">No files match “{query}”.</p>
        )}
        {groups.map((group) => (
          <section key={group.id} className="mb-3">
            <h3 className="flex items-center gap-2 px-4 py-1 font-mono text-[11px] text-faint">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: group.color }}
              />
              <span className="truncate">{group.label}</span>
            </h3>
            <ul>
              {group.buildings.map((building) => {
                const active = building.id === selectedId;
                return (
                  <li key={building.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => select(active ? null : building.id)}
                      onPointerEnter={() => hover(building.id)}
                      onPointerLeave={() => hover(null)}
                      className={`block w-full truncate px-4 py-1 pl-8 text-left text-[13px] transition-colors ${
                        active
                          ? "bg-raised text-cyan"
                          : "text-muted hover:bg-panel hover:text-text"
                      }`}
                    >
                      {building.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
