import type { Provenance } from "@/lib/graph/schema";

/**
 * Driven by the data's own provenance rather than the route, so sample data can't be shown
 * without this label. It can't be dismissed.
 */
export function DemoBanner({ provenance }: { provenance: Provenance }) {
  if (provenance.kind !== "demo") return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-baseline gap-3 border-b border-amber/30 bg-amber/10 px-4 py-2 text-xs leading-relaxed text-amber"
    >
      <strong className="shrink-0 font-mono font-medium tracking-wide">DEMO MODE</strong>
      <span>{provenance.note}</span>
    </div>
  );
}
