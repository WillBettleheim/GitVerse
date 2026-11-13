"use client";

import { SnapshotPanel } from "@/features/timetravel/SnapshotPanel";
import { useExplorerData } from "./explorer-data";
import { FileInspector } from "./panel/FileInspector";
import { InsightsDashboard } from "./panel/InsightsDashboard";
import { useExplorerStore } from "./store";

/** The contextual side panel: insights with nothing selected, the file inspector otherwise. */
export function Inspector() {
  const { files } = useExplorerData();
  const selectedId = useExplorerStore((s) => s.selectedId);
  const file = selectedId ? files.get(selectedId) : undefined;
  if (file) return <FileInspector key={file.id} file={file} />;
  return (
    <>
      <SnapshotPanel />
      <InsightsDashboard />
    </>
  );
}
