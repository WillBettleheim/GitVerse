import type { CodeGraph } from "@/lib/graph/schema";
import { parseRepoInput } from "./repo-input";

const SHA = /^[0-9a-f]{40}$/;

/**
 * A GitHub link to a file at the exact commit that was analyzed, or null when one can't be
 * vouched for: demo data, an unknown file, or repository details that don't validate. Pinning the
 * commit means the link shows the same code the metrics came from, even after the branch moves.
 */
export function sourceUrl(graph: CodeGraph, fileId: string): string | null {
  const repository = graph.analysis?.repository;
  if (graph.provenance.kind !== "analysis" || !repository) return null;
  if (!SHA.test(repository.commitSha)) return null;
  const parsed = parseRepoInput(repository.fullName);
  if (!parsed.ok) return null;
  const file = graph.files.find((f) => f.id === fileId);
  if (!file) return null;

  const path = file.path.split("/").map(encodeURIComponent).join("/");
  const { owner, name } = parsed.repo;
  return `https://github.com/${owner}/${name}/blob/${repository.commitSha}/${path}`;
}
