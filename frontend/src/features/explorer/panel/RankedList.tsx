"use client";

import type { RankedFile } from "@/lib/graph/insights";
import { countFormat, fileName } from "../explorer-data";
import { useExplorerStore } from "../store";

/** A clickable ranking with a bar scaled to the top value. */
export function RankedList({
  items,
  unit,
  barClass,
}: {
  items: readonly RankedFile[];
  unit: string;
  barClass: string;
}) {
  const select = useExplorerStore((s) => s.select);
  const max = items[0]?.value ?? 1;
  return (
    <ol className="space-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => select(item.id)}
            title={item.id}
            className="group block w-full rounded px-1 py-1 text-left transition-colors hover:bg-raised"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] text-text group-hover:text-cyan">
                {fileName(item.id)}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                {countFormat.format(item.value)} {unit}
              </span>
            </span>
            {/* The folder, so files sharing a name (index.ts in every package) can be told apart. */}
            <span className="block truncate font-mono text-[10px] text-faint">
              {item.id.includes("/") ? item.id.slice(0, item.id.lastIndexOf("/")) : "(root)"}
            </span>
            <span className="mt-1 block h-0.5 rounded bg-line" aria-hidden="true">
              <span
                className={`block h-full rounded ${barClass}`}
                style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
              />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
