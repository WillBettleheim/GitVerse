"use client";

import { useMemo } from "react";
import type { Building, CityLayout } from "@/lib/city/layout";
import type { Adjacency } from "@/lib/graph/queries";
import type { CodeGraph, FileNode } from "@/lib/graph/schema";
import { useExplorerStore } from "./store";

const countFormat = new Intl.NumberFormat("en-US");

interface InspectorProps {
  graph: CodeGraph;
  city: CityLayout;
  adjacency: Adjacency;
}

export function Inspector({ graph, city, adjacency }: InspectorProps) {
  const selectedId = useExplorerStore((s) => s.selectedId);
  const files = useMemo(() => new Map(graph.files.map((f) => [f.id, f])), [graph.files]);
  const buildings = useMemo(() => new Map(city.buildings.map((b) => [b.id, b])), [city.buildings]);
  const file = selectedId ? files.get(selectedId) : undefined;
  return file ? (
    <FileDetails file={file} building={buildings.get(file.id)} adjacency={adjacency} />
  ) : (
    <CityOverview graph={graph} city={city} />
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg tabular-nums">{value}</dd>
    </div>
  );
}

const TREATMENTS: { name: string; look: string }[] = [
  { name: "Source", look: "lit office windows" },
  { name: "Test", look: "horizontal scan bands" },
  { name: "Config", look: "plain monolith with seams" },
  { name: "Docs", look: "tall vertical ribbons" },
  { name: "Style", look: "diagonal lattice" },
  { name: "Data", look: "stacked slabs, rack lights" },
];

function CityOverview({ graph, city }: { graph: CodeGraph; city: CityLayout }) {
  const totalLoc = graph.files.reduce((sum, f) => sum + f.loc, 0);
  return (
    <div className="p-4">
      <h2 className="font-medium">City overview</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="Buildings (files)" value={countFormat.format(city.buildings.length)} />
        <Stat label="Districts (folders)" value={countFormat.format(city.districts.length)} />
        <Stat label="Connections (imports)" value={countFormat.format(city.connections.length)} />
        <Stat label="Lines of code" value={countFormat.format(totalLoc)} />
      </dl>

      <h3 className="mt-6 text-sm font-medium">How to read the city</h3>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-muted">
        <li>
          <span className="text-text">Footprint</span> grows with lines of code.
        </li>
        <li>
          <span className="text-text">Height</span> grows with complexity.
        </li>
        <li>
          <span className="text-text">Colour</span> shows the part of the system.
        </li>
        <li>
          <span className="text-text">Beacons</span> mark the most depended-on modules.
        </li>
      </ul>

      <h3 className="mt-6 text-sm font-medium">Building types</h3>
      <dl className="mt-2 space-y-1 text-sm">
        {TREATMENTS.map((treatment) => (
          <div key={treatment.name} className="flex justify-between gap-3">
            <dt className="text-text">{treatment.name}</dt>
            <dd className="text-right text-muted">{treatment.look}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-sm text-faint">Select a building to trace its imports.</p>
    </div>
  );
}

function FileDetails({
  file,
  building,
  adjacency,
}: {
  file: FileNode;
  building: Building | undefined;
  adjacency: Adjacency;
}) {
  const select = useExplorerStore((s) => s.select);
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 font-medium break-words">{file.path.split("/").pop()}</h2>
        <button
          type="button"
          onClick={() => select(null)}
          className="shrink-0 font-mono text-xs text-faint transition-colors hover:text-text"
        >
          Close
        </button>
      </div>
      <p className="mt-1 font-mono text-xs break-all text-faint">{file.path}</p>
      {building?.landmark && (
        <p className="mt-2 text-xs text-cyan">Key module: among the most depended on</p>
      )}
      {!building && (
        <p className="mt-2 text-xs text-amber">Not drawn in the city, because of the size limit.</p>
      )}
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Lines" value={file.loc} />
        <Stat label="Complexity" value={file.complexity} />
        <div>
          <dt className="text-xs text-faint">Type</dt>
          <dd className="mt-1.5 truncate font-mono text-sm">{building?.category ?? file.language}</dd>
        </div>
      </dl>
      <LinkList
        title="Imports"
        accent="bg-cyan"
        empty="Imports no other files."
        ids={adjacency.imports.get(file.id) ?? []}
      />
      <LinkList
        title="Imported by"
        accent="bg-violet"
        empty="No file imports this."
        ids={adjacency.importedBy.get(file.id) ?? []}
      />
    </div>
  );
}

function LinkList({
  title,
  accent,
  empty,
  ids,
}: {
  title: string;
  accent: string;
  empty: string;
  ids: readonly string[];
}) {
  const select = useExplorerStore((s) => s.select);
  return (
    <section className="mt-6">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <span aria-hidden="true" className={`h-px w-3 ${accent}`} />
        {title}
        <span className="font-mono text-xs text-faint">{ids.length}</span>
      </h3>
      {ids.length === 0 ? (
        <p className="mt-2 text-sm text-faint">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {ids.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => select(id)}
                className="w-full truncate rounded py-0.5 text-left font-mono text-xs text-muted transition-colors hover:text-cyan"
                title={id}
              >
                {id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
