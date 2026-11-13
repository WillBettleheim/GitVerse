"use client";

import { useId, useMemo, useState } from "react";
import { filterOptions } from "@/lib/graph/search";
import { countFormat, useExplorerData } from "./explorer-data";
import { useExplorerStore } from "./store";

const field =
  "h-8 w-full rounded border border-line bg-void px-2 text-xs text-text focus:border-cyan/60 focus:outline-none";

function NumberFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[11px] text-faint">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={value || ""}
        placeholder="0"
        onChange={(event) => onChange(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
        className={`${field} mt-0.5 font-mono`}
      />
    </div>
  );
}

/** Folder, language and metric filters. Their options come from the graph itself. */
export function SearchFilters() {
  const { graph } = useExplorerData();
  const filters = useExplorerStore((s) => s.filters);
  const setFilters = useExplorerStore((s) => s.setFilters);
  const options = useMemo(() => filterOptions(graph.files), [graph.files]);
  const [open, setOpen] = useState(false);
  const folderId = useId();
  const languageId = useId();

  const activeCount =
    (filters.folder !== null ? 1 : 0) +
    (filters.language !== null ? 1 : 0) +
    (filters.minLoc > 0 ? 1 : 0) +
    (filters.minComplexity > 0 ? 1 : 0) +
    (filters.minIncoming > 0 ? 1 : 0);

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[11px] text-muted hover:text-text"
      >
        Filters{activeCount > 0 ? ` (${activeCount})` : ""} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <label htmlFor={folderId} className="text-[11px] text-faint">
              Folder
            </label>
            <select
              id={folderId}
              value={filters.folder ?? "__all"}
              onChange={(e) =>
                setFilters({ folder: e.target.value === "__all" ? null : e.target.value })
              }
              className={`${field} mt-0.5`}
            >
              <option value="__all">All folders</option>
              {options.folders.map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {folder.path || "(root)"} · {countFormat.format(folder.files)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={languageId} className="text-[11px] text-faint">
              Language
            </label>
            <select
              id={languageId}
              value={filters.language ?? "__all"}
              onChange={(e) =>
                setFilters({ language: e.target.value === "__all" ? null : e.target.value })
              }
              className={`${field} mt-0.5`}
            >
              <option value="__all">All languages</option>
              {options.languages.map((language) => (
                <option key={language.language} value={language.language}>
                  {language.language} · {countFormat.format(language.files)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumberFilter
              label="Min lines"
              value={filters.minLoc}
              onChange={(minLoc) => setFilters({ minLoc })}
            />
            <NumberFilter
              label="Min complexity"
              value={filters.minComplexity}
              onChange={(minComplexity) => setFilters({ minComplexity })}
            />
            <NumberFilter
              label="Min importers"
              value={filters.minIncoming}
              onChange={(minIncoming) => setFilters({ minIncoming })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
