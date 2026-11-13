/**
 * Which commits to analyze and play. Pure functions, so playback order is testable.
 * Commits arrive newest first, as GitHub lists them.
 */

export const REPRESENTATIVE_SNAPSHOTS = 6;

/**
 * Evenly spaced commits from a newest-first list, always including the newest and the oldest.
 * A sample of the history, not every commit, so the first view is quick and cheap.
 */
export function pickRepresentative<T>(
  commits: readonly T[],
  count = REPRESENTATIVE_SNAPSHOTS,
): T[] {
  if (commits.length <= count) return [...commits];
  const picked = new Set<number>();
  for (let i = 0; i < count; i++) {
    picked.add(Math.round((i * (commits.length - 1)) / (count - 1)));
  }
  return [...picked].sort((a, b) => a - b).map((index) => commits[index]);
}

/**
 * The next analyzed commit forward in time, or null at the end. `newestFirst` is the timeline;
 * a null `current` means the view is at the newest commit already.
 */
export function nextPlayable(
  newestFirst: readonly string[],
  ready: ReadonlySet<string>,
  current: string | null,
): string | null {
  const index = current === null ? 0 : newestFirst.indexOf(current);
  for (let i = index - 1; i >= 0; i--) {
    if (ready.has(newestFirst[i])) return newestFirst[i];
  }
  return null;
}

/** Where playback starts: the oldest analyzed commit. */
export function playbackStart(
  newestFirst: readonly string[],
  ready: ReadonlySet<string>,
): string | null {
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    if (ready.has(newestFirst[i])) return newestFirst[i];
  }
  return null;
}

/** The neighbouring commit on the timeline, for keyboard and step buttons. */
export function stepCommit(
  newestFirst: readonly string[],
  current: string | null,
  direction: "older" | "newer",
): string | null {
  const index = current === null ? 0 : newestFirst.indexOf(current);
  if (index === -1) return null;
  const next = direction === "older" ? index + 1 : index - 1;
  return next >= 0 && next < newestFirst.length ? newestFirst[next] : null;
}
