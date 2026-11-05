import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StressExplorer } from "@/features/demo/StressExplorer";
import { isSyntheticSize, SYNTHETIC_SIZES } from "@/features/demo/synthetic-graph";

export const metadata: Metadata = {
  title: "Stress test city | GitVerse",
  description: "Generated test data for exercising the city renderer at scale.",
};

export function generateStaticParams() {
  return SYNTHETIC_SIZES.map((size) => ({ size: String(size) }));
}

async function StressContent({ params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!isSyntheticSize(size)) notFound();
  return <StressExplorer size={size} />;
}

export default function StressTestPage({ params }: PageProps<"/explore/demo/stress/[size]">) {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-svh place-items-center font-mono text-xs text-faint">
          Generating test data…
        </div>
      }
    >
      <StressContent params={params} />
    </Suspense>
  );
}
