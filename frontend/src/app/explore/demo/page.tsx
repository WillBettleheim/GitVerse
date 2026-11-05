import type { Metadata } from "next";
import { loadDemoGraph } from "@/features/demo/load-demo-graph";
import { ExplorerShell } from "@/features/explorer/ExplorerShell";

export const metadata: Metadata = {
  title: "Demo city | GitVerse",
  description: "Explore a sample city built from hand-written demo data.",
};

export default function DemoExplorerPage() {
  return <ExplorerShell graph={loadDemoGraph()} />;
}
