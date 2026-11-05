import { loadDemoGraph } from "@/features/demo/load-demo-graph";
import { LandingPage } from "@/features/landing/LandingPage";

export default function Home() {
  return <LandingPage graph={loadDemoGraph()} />;
}
