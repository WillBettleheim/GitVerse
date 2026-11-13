const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" });

export const shortSha = (sha: string) => sha.slice(0, 7);

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown date" : dateFormat.format(date);
}

export function monthLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : monthFormat.format(date);
}
