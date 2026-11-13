import type { FileNode } from "./schema";

export interface SearchFilters {
  /** A folder path. Files anywhere inside it match. */
  folder: string | null;
  language: string | null;
  minLoc: number;
  minComplexity: number;
  minIncoming: number;
}

export const NO_FILTERS: SearchFilters = {
  folder: null,
  language: null,
  minLoc: 0,
  minComplexity: 0,
  minIncoming: 0,
};

export function isSearching(query: string, filters: SearchFilters): boolean {
  return (
    query.trim() !== "" ||
    filters.folder !== null ||
    filters.language !== null ||
    filters.minLoc > 0 ||
    filters.minComplexity > 0 ||
    filters.minIncoming > 0
  );
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Lower is better: exact name, then name prefix, then anywhere in the name, then in the path. */
function rank(file: FileNode, needle: string): number | null {
  if (!needle) return 0;
  const name = fileName(file.path).toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (file.path.toLowerCase().includes(needle)) return 3;
  return null;
}

function inFolder(path: string, folder: string): boolean {
  if (folder === "") return !path.includes("/");
  return path.startsWith(`${folder}/`);
}

/** Files matching the query and every filter, best matches first. */
export function searchFiles(
  files: readonly FileNode[],
  incoming: ReadonlyMap<string, readonly string[]>,
  query: string,
  filters: SearchFilters,
): FileNode[] {
  const needle = query.trim().toLowerCase();
  const ranked: { file: FileNode; score: number }[] = [];
  for (const file of files) {
    if (filters.folder !== null && !inFolder(file.path, filters.folder)) continue;
    if (filters.language !== null && file.language !== filters.language) continue;
    if (file.loc < filters.minLoc || file.complexity < filters.minComplexity) continue;
    if ((incoming.get(file.id)?.length ?? 0) < filters.minIncoming) continue;
    const score = rank(file, needle);
    if (score !== null) ranked.push({ file, score });
  }
  return ranked
    .sort((a, b) => a.score - b.score || (a.file.path < b.file.path ? -1 : 1))
    .map((entry) => entry.file);
}

export interface FilterOptions {
  folders: { path: string; files: number }[];
  languages: { language: string; files: number }[];
}

/** Every folder that holds files, at any depth, and every language present. */
export function filterOptions(files: readonly FileNode[]): FilterOptions {
  const folders = new Map<string, number>();
  const languages = new Map<string, number>();
  for (const file of files) {
    languages.set(file.language, (languages.get(file.language) ?? 0) + 1);
    const parts = file.path.split("/").slice(0, -1);
    if (parts.length === 0) folders.set("", (folders.get("") ?? 0) + 1);
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
  }
  return {
    folders: [...folders.entries()]
      .map(([path, n]) => ({ path, files: n }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
    languages: [...languages.entries()]
      .map(([language, n]) => ({ language, files: n }))
      .sort((a, b) => b.files - a.files || (a.language < b.language ? -1 : 1)),
  };
}
