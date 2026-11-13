import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalysisExplorer } from "@/features/analysis/AnalysisExplorer";
import { parseRepoInput } from "@/lib/analysis/repo-input";

export const metadata: Metadata = {
  title: "Repository city | GitVerse",
  description: "A 3D city generated from static analysis of a public GitHub repository.",
};

/** One known repository, so the route's shell is validated at build. Any other renders on demand. */
export function generateStaticParams() {
  return [{ owner: "sindresorhus", repo: "ky" }];
}

async function Content({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const result = parseRepoInput(`${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`);
  if (!result.ok) notFound();
  return <AnalysisExplorer owner={result.repo.owner} name={result.repo.name} />;
}

export default function RepositoryPage({ params }: PageProps<"/explore/gh/[owner]/[repo]">) {
  return (
    <Suspense
      fallback={<div className="min-h-svh bg-void" aria-busy="true" aria-label="Loading" />}
    >
      <Content params={params} />
    </Suspense>
  );
}
