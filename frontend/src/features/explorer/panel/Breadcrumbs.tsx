"use client";

import { useExplorerStore } from "../store";

/**
 * Repository › folder › folder › file. A folder narrows the search to that folder and returns to
 * the overview. The repository clears both.
 */
export function Breadcrumbs({ repository, path }: { repository: string; path: string | null }) {
  const showFolder = useExplorerStore((s) => s.showFolder);
  const clearSearch = useExplorerStore((s) => s.clearSearch);
  const select = useExplorerStore((s) => s.select);
  const parts = path ? path.split("/") : [];

  const crumb = "truncate transition-colors hover:text-text";
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 font-mono text-[11px] text-faint">
        <li className="min-w-0">
          <button
            type="button"
            className={crumb}
            onClick={() => {
              select(null);
              clearSearch();
            }}
          >
            {repository}
          </button>
        </li>
        {parts.map((part, index) => {
          const last = index === parts.length - 1;
          const folder = parts.slice(0, index + 1).join("/");
          return (
            <li key={folder} className="flex min-w-0 items-center gap-1">
              <span aria-hidden="true">/</span>
              {last ? (
                <span aria-current="page" className="truncate text-muted">
                  {part}
                </span>
              ) : (
                <button
                  type="button"
                  className={crumb}
                  title={`Show only files in ${folder}`}
                  onClick={() => showFolder(folder)}
                >
                  {part}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
